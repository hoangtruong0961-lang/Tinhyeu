package com.bachduong.remixvideo;

import android.util.Log;

import ai.onnxruntime.NodeInfo;
import ai.onnxruntime.OnnxJavaType;
import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OnnxValue;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import ai.onnxruntime.TensorInfo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.nio.IntBuffer;
import java.nio.LongBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

public class VieNeuEngine {

    private static final String TAG = "VieNeuEngine";

    // Config parameters
    private static final int N_VQ = 16;
    private static final int HIDDEN_SIZE = 768;
    private static final int NUM_LAYERS = 12; // backbone Qwen3 layers
    private static final int NUM_KV_HEADS = 4; // backbone KV heads
    private static final int HEAD_DIM = 64; // 768 / 12 = 64 (KV head dim)

    private static final int LOCAL_LAYERS = 1;
    private static final int LOCAL_KV_HEADS = 8;
    private static final int LOCAL_HEAD_DIM = 96; // 768 / 8 = 96

    private static final int AUDIO_PAD_TOKEN_ID = 1024;
    private static final int TEXT_PROMPT_START_TOKEN_ID = 3;
    private static final int TEXT_PROMPT_END_TOKEN_ID = 4;
    private static final int SPEECH_GEN_START_TOKEN_ID = 5;
    private static final int SPEECH_GEN_END_TOKEN_ID = 6;
    private static final int AUDIO_REF_SLOT_TOKEN_ID = 7;
    private static final int DEFAULT_STYLE_TOKEN_ID = 16;
    private static final int SAMPLE_RATE = 48000;

    private final File modelsDir;
    private OrtEnvironment env;

    private OrtSession sessPrefill;
    private OrtSession sessDecodeStep;
    private OrtSession sessAcoustic;
    private OrtSession sessCodecDecode;

    // Weights from vieneu_v3_heads.npz
    private float[][] textEmb; // (419, 768)
    private float[][][] audioEmb; // (16, 1024, 768)
    private float[][] xvecW; // (768, 192)
    private float[] xvecB; // (768)
    private float[] xvecLnW; // (768)
    private float[] xvecLnB; // (768)
    private float xvecLnEps = 1e-5f;

    // Voices from voices_v3_turbo.json
    private JSONObject voicesJsonObject;
    private boolean isInitialized = false;

    public VieNeuEngine(File modelsDir) {
        this.modelsDir = modelsDir;
    }

    public synchronized void initialize() throws Exception {
        if (isInitialized) return;

        Log.d(TAG, "Initializing VieNeuEngine from " + modelsDir.getAbsolutePath());
        env = OrtEnvironment.getEnvironment();

        OrtSession.SessionOptions opts = new OrtSession.SessionOptions();
        opts.setInterOpNumThreads(1);
        int intraThreads = Math.min(Math.max((Runtime.getRuntime().availableProcessors()) / 2, 1), 4);
        opts.setIntraOpNumThreads(intraThreads);
        opts.addConfigEntry("session.intra_op.allow_spinning", "0");

        File prefillFile = new File(modelsDir, "vieneu_prefill.onnx");
        File decodeStepFile = new File(modelsDir, "vieneu_decode_step.onnx");
        File acousticFile = new File(modelsDir, "vieneu_acoustic_cached.onnx");
        File codecFile = new File(modelsDir, "moss_audio_tokenizer_decode_full.onnx");
        File headsNpzFile = new File(modelsDir, "vieneu_v3_heads.npz");
        File voicesJsonFile = new File(modelsDir, "voices_v3_turbo.json");

        Log.d(TAG, "Loading ONNX sessions...");
        sessPrefill = env.createSession(prefillFile.getAbsolutePath(), opts);
        sessDecodeStep = env.createSession(decodeStepFile.getAbsolutePath(), opts);
        sessAcoustic = env.createSession(acousticFile.getAbsolutePath(), opts);
        sessCodecDecode = env.createSession(codecFile.getAbsolutePath(), opts);

        Log.d(TAG, "Loading NPZ weights from " + headsNpzFile.getName());
        loadNpzWeights(headsNpzFile);

        Log.d(TAG, "Loading voices JSON from " + voicesJsonFile.getName());
        loadVoicesJson(voicesJsonFile);

        isInitialized = true;
        Log.d(TAG, "VieNeuEngine initialized successfully!");
    }

    public synchronized void release() {
        if (!isInitialized) return;
        Log.d(TAG, "Releasing VieNeuEngine ONNX sessions and memory...");
        try { if (sessPrefill != null) sessPrefill.close(); } catch (Exception ignored) {}
        try { if (sessDecodeStep != null) sessDecodeStep.close(); } catch (Exception ignored) {}
        try { if (sessAcoustic != null) sessAcoustic.close(); } catch (Exception ignored) {}
        try { if (sessCodecDecode != null) sessCodecDecode.close(); } catch (Exception ignored) {}

        sessPrefill = null;
        sessDecodeStep = null;
        sessAcoustic = null;
        sessCodecDecode = null;
        textEmb = null;
        audioEmb = null;
        xvecW = null;
        xvecB = null;
        xvecLnW = null;
        xvecLnB = null;
        voicesJsonObject = null;

        isInitialized = false;
        System.gc();
    }

    public boolean isInitialized() {
        return isInitialized;
    }

    public List<String> getAvailableVoices() {
        List<String> list = new ArrayList<>();
        if (voicesJsonObject != null && voicesJsonObject.has("presets")) {
            JSONObject presets = voicesJsonObject.optJSONObject("presets");
            if (presets != null) {
                JSONArray names = presets.names();
                if (names != null) {
                    for (int i = 0; i < names.length(); i++) {
                        list.add(names.optString(i));
                    }
                }
            }
        }
        return list;
    }

    /**
     * Synthesize audio from pre-tokenized BPE token IDs.
     */
    public synchronized String synthesize(
            int[] inputTokenIds,
            String voiceName,
            File outputFile,
            float temperature,
            int topK,
            float topP,
            float repPenalty,
            int repWindow,
            int maxFrames,
            Long seed,
            AtomicBoolean cancelFlag
    ) throws Exception {

        if (!isInitialized) {
            initialize();
        }

        long startTime = System.currentTimeMillis();
        Random rng = (seed != null) ? new Random(seed) : new Random();

        // Load voice preset (speaker_emb and ref_codes)
        JSONObject presets = voicesJsonObject.getJSONObject("presets");
        if (!presets.has(voiceName)) {
            voiceName = "Minh Đức"; // Fallback default
        }
        JSONObject voiceData = presets.getJSONObject(voiceName);

        JSONArray spkArr = voiceData.getJSONArray("speaker_emb");
        float[] speakerEmb = new float[spkArr.length()];
        for (int i = 0; i < spkArr.length(); i++) {
            speakerEmb[i] = (float) spkArr.getDouble(i);
        }

        JSONArray codesArr = voiceData.getJSONArray("codes");
        int numRefFrames = codesArr.length();
        int[][] refCodes = new int[numRefFrames][N_VQ];
        for (int f = 0; f < numRefFrames; f++) {
            JSONArray frameCodes = codesArr.getJSONArray(f);
            for (int c = 0; c < N_VQ; c++) {
                refCodes[f][c] = frameCodes.getInt(c);
            }
        }

        Log.d(TAG, String.format("Synthesizing voice '%s': %d ref frames, input tokens count: %d", voiceName, numRefFrames, inputTokenIds.length));

        // Step 1: Compute speaker anchor vector = LayerNorm(Linear(speaker_emb))
        float[] anchor = computeSpeakerAnchor(speakerEmb);

        // Step 2: Build prompt 2D matrix (Text Rows + Ref Audio Rows)
        // Text tokens: [style_id, tps] + inputTokenIds + [tpe]
        int tPromptText = 2 + inputTokenIds.length + 1;
        int[] textTokenIds = new int[tPromptText];
        textTokenIds[0] = DEFAULT_STYLE_TOKEN_ID;
        textTokenIds[1] = TEXT_PROMPT_START_TOKEN_ID;
        System.arraycopy(inputTokenIds, 0, textTokenIds, 2, inputTokenIds.length);
        textTokenIds[tPromptText - 1] = TEXT_PROMPT_END_TOKEN_ID;

        int totalPromptLength = tPromptText + numRefFrames;
        int[][] promptRows = new int[totalPromptLength][N_VQ + 1];

        // Fill pad tokens
        for (int i = 0; i < totalPromptLength; i++) {
            Arrays.fill(promptRows[i], AUDIO_PAD_TOKEN_ID);
        }

        // Fill text rows
        for (int i = 0; i < tPromptText; i++) {
            promptRows[i][0] = textTokenIds[i];
        }

        // Fill ref rows
        for (int i = 0; i < numRefFrames; i++) {
            int rowIdx = tPromptText + i;
            promptRows[rowIdx][0] = AUDIO_REF_SLOT_TOKEN_ID;
            System.arraycopy(refCodes[i], 0, promptRows[rowIdx], 1, N_VQ);
        }

        // Embed prompt rows: (1, totalPromptLength, 768)
        float[] promptEmbedsFlat = new float[totalPromptLength * HIDDEN_SIZE];
        for (int t = 0; t < totalPromptLength; t++) {
            int headTok = promptRows[t][0];
            float[] textVec = textEmb[headTok];
            int offset = t * HIDDEN_SIZE;

            for (int h = 0; h < HIDDEN_SIZE; h++) {
                promptEmbedsFlat[offset + h] = textVec[h];
            }

            for (int ch = 0; ch < N_VQ; ch++) {
                int codeId = promptRows[t][ch + 1];
                if (codeId != AUDIO_PAD_TOKEN_ID) {
                    float[] audioVec = audioEmb[ch][codeId];
                    for (int h = 0; h < HIDDEN_SIZE; h++) {
                        promptEmbedsFlat[offset + h] += audioVec[h];
                    }
                }
            }

            // Add speaker anchor
            for (int h = 0; h < HIDDEN_SIZE; h++) {
                promptEmbedsFlat[offset + h] += anchor[h];
            }
        }

        // Step 3: Run Prefill Session
        FloatBuffer prefillBuffer = FloatBuffer.wrap(promptEmbedsFlat);
        long[] prefillShape = new long[]{1, totalPromptLength, HIDDEN_SIZE};
        OnnxTensor prefillTensor = OnnxTensor.createTensor(env, prefillBuffer, prefillShape);

        Map<String, OnnxTensor> prefillInputs = new HashMap<>();
        prefillInputs.put("inputs_embeds", prefillTensor);

        Log.d(TAG, "Executing prefill session...");
        OrtSession.Result prefillResult = sessPrefill.run(prefillInputs);
        prefillTensor.close();

        // Extract last_hidden_state step vector h and past_kv
        float[][][] prefillHidden = (float[][][]) prefillResult.get("hidden").get().getValue();
        float[] currentH = new float[HIDDEN_SIZE];
        System.arraycopy(prefillHidden[0][totalPromptLength - 1], 0, currentH, 0, HIDDEN_SIZE);

        // Store past_kv for backbone (12 layers, k and v each: float[1][4][totalPromptLength][64])
        List<float[][][][]> pastKList = new ArrayList<>();
        List<float[][][][]> pastVList = new ArrayList<>();

        for (int l = 0; l < NUM_LAYERS; l++) {
            float[][][][] pk = (float[][][][]) prefillResult.get("present_k_" + l).get().getValue();
            float[][][][] pv = (float[][][][]) prefillResult.get("present_v_" + l).get().getValue();
            pastKList.add(pk);
            pastVList.add(pv);
        }
        prefillResult.close();

        // Step 4: Autoregressive Frame Generation Loop
        List<int[]> generatedFrames = new ArrayList<>();
        List<Deque<Integer>> repHistories = new ArrayList<>();
        for (int ch = 0; ch < N_VQ; ch++) {
            repHistories.add(new ArrayDeque<>(repWindow));
        }

        Log.d(TAG, "Starting autoregressive frame decoding...");

        for (int frameIdx = 0; frameIdx < maxFrames; frameIdx++) {
            if (cancelFlag != null && cancelFlag.get()) {
                throw new Exception("Synthesis cancelled by user");
            }

            // --- Acoustic Decoder for 16 RVQ codebooks ---
            // Slot 0: currentH (backbone hidden step), Slot 1: textEmb[SPEECH_GEN_START_TOKEN_ID]
            float[] tokStepFlat = new float[2 * HIDDEN_SIZE];
            System.arraycopy(currentH, 0, tokStepFlat, 0, HIDDEN_SIZE);
            System.arraycopy(textEmb[SPEECH_GEN_START_TOKEN_ID], 0, tokStepFlat, HIDDEN_SIZE, HIDDEN_SIZE);

            FloatBuffer acTokBuffer = FloatBuffer.wrap(tokStepFlat);
            OnnxTensor acTokTensor = OnnxTensor.createTensor(env, acTokBuffer, new long[]{1, 2, HIDDEN_SIZE});
            OnnxTensor acPosTensor = createIntTensorForSession(env, sessAcoustic, "position_ids", new long[]{0L, 1L}, new long[]{1, 2});

            // Initial empty past_k_0, past_v_0: shape [1, 8, 0, 96]
            FloatBuffer emptyBuffer = FloatBuffer.wrap(new float[0]);
            OnnxTensor emptyK0 = OnnxTensor.createTensor(env, emptyBuffer, new long[]{1, LOCAL_KV_HEADS, 0, LOCAL_HEAD_DIM});
            OnnxTensor emptyV0 = OnnxTensor.createTensor(env, emptyBuffer, new long[]{1, LOCAL_KV_HEADS, 0, LOCAL_HEAD_DIM});

            Map<String, OnnxTensor> acFeed = new HashMap<>();
            acFeed.put("token_emb", acTokTensor);
            acFeed.put("position_ids", acPosTensor);
            acFeed.put("past_k_0", emptyK0);
            acFeed.put("past_v_0", emptyV0);

            OrtSession.Result acRes = sessAcoustic.run(acFeed);
            acTokTensor.close();
            acPosTensor.close();
            emptyK0.close();
            emptyV0.close();

            float[][][] acHidden = (float[][][]) acRes.get("hidden").get().getValue();
            float[][][][] acPk = (float[][][][]) acRes.get("present_k_0").get().getValue();
            float[][][][] acPv = (float[][][][]) acRes.get("present_v_0").get().getValue();
            acRes.close();

            float[] slot0Hidden = acHidden[0][0]; // Used for EOS check

            // Sample Codebook 0 (from acHidden[0][1] @ audioEmb[0].T)
            int c0 = sampleToken(acHidden[0][1], audioEmb[0], temperature, topK, topP, repPenalty, repHistories.get(0), rng);
            addToHistory(repHistories.get(0), c0, repWindow);

            int[] currentFrameCodes = new int[N_VQ];
            currentFrameCodes[0] = c0;

            // Sample Codebooks 1..15 sequentially with cached acoustic steps
            for (int ch = 1; ch < N_VQ; ch++) {
                int prevCode = currentFrameCodes[ch - 1];
                float[] embCh = audioEmb[ch - 1][prevCode];

                FloatBuffer embBuffer = FloatBuffer.wrap(embCh);
                OnnxTensor embTensor = OnnxTensor.createTensor(env, embBuffer, new long[]{1, 1, HIDDEN_SIZE});
                OnnxTensor posTensor = createIntTensorForSession(env, sessAcoustic, "position_ids", new long[]{(long)(ch + 1)}, new long[]{1, 1});

                int acSeqLen = acPk[0][0].length;
                long[] acKvShape = new long[]{1, LOCAL_KV_HEADS, acSeqLen, LOCAL_HEAD_DIM};
                FloatBuffer pkBuf = flatten4D(acPk);
                FloatBuffer pvBuf = flatten4D(acPv);

                OnnxTensor pkTensor = OnnxTensor.createTensor(env, pkBuf, acKvShape);
                OnnxTensor pvTensor = OnnxTensor.createTensor(env, pvBuf, acKvShape);

                Map<String, OnnxTensor> acStepFeed = new HashMap<>();
                acStepFeed.put("token_emb", embTensor);
                acStepFeed.put("position_ids", posTensor);
                acStepFeed.put("past_k_0", pkTensor);
                acStepFeed.put("past_v_0", pvTensor);

                OrtSession.Result acStepRes = sessAcoustic.run(acStepFeed);
                embTensor.close();
                posTensor.close();
                pkTensor.close();
                pvTensor.close();

                float[][][] stepHidden = (float[][][]) acStepRes.get("hidden").get().getValue();
                acPk = (float[][][][]) acStepRes.get("present_k_0").get().getValue();
                acPv = (float[][][][]) acStepRes.get("present_v_0").get().getValue();
                acStepRes.close();

                int cCh = sampleToken(stepHidden[0][0], audioEmb[ch], temperature, topK, topP, repPenalty, repHistories.get(ch), rng);
                addToHistory(repHistories.get(ch), cCh, repWindow);
                currentFrameCodes[ch] = cCh;
            }

            generatedFrames.add(currentFrameCodes);

            // --- EOS Check: slot0 @ textEmb.T ---
            int argmaxTextToken = matmulArgmax(slot0Hidden, textEmb);
            if (argmaxTextToken == SPEECH_GEN_END_TOKEN_ID) {
                Log.d(TAG, "Reached SPEECH_GEN_END EOS token at frame " + (frameIdx + 1));
                break;
            }

            // --- Backbone Decode Step Session ---
            // Construct slot_emb = textEmb[sgs] + sum(audioEmb[ch][code[ch]]) + anchor
            float[] slotEmb = new float[HIDDEN_SIZE];
            System.arraycopy(textEmb[SPEECH_GEN_START_TOKEN_ID], 0, slotEmb, 0, HIDDEN_SIZE);

            for (int ch = 0; ch < N_VQ; ch++) {
                float[] aVec = audioEmb[ch][currentFrameCodes[ch]];
                for (int h = 0; h < HIDDEN_SIZE; h++) {
                    slotEmb[h] += aVec[h];
                }
            }
            for (int h = 0; h < HIDDEN_SIZE; h++) {
                slotEmb[h] += anchor[h];
            }

            FloatBuffer decEmbBuffer = FloatBuffer.wrap(slotEmb);
            OnnxTensor decEmbTensor = OnnxTensor.createTensor(env, decEmbBuffer, new long[]{1, 1, HIDDEN_SIZE});
            OnnxTensor decPosTensor = createIntTensorForSession(env, sessDecodeStep, "position_ids", new long[]{(long)(totalPromptLength + frameIdx)}, new long[]{1, 1});

            Map<String, OnnxTensor> decFeed = new HashMap<>();
            decFeed.put("inputs_embeds", decEmbTensor);
            decFeed.put("position_ids", decPosTensor);

            List<OnnxTensor> kvTensorsToClose = new ArrayList<>();
            int pastLen = pastKList.get(0)[0][0].length;
            long[] kvShape = new long[]{1, NUM_KV_HEADS, pastLen, HEAD_DIM};

            for (int l = 0; l < NUM_LAYERS; l++) {
                OnnxTensor kTen = OnnxTensor.createTensor(env, flatten4D(pastKList.get(l)), kvShape);
                OnnxTensor vTen = OnnxTensor.createTensor(env, flatten4D(pastVList.get(l)), kvShape);
                decFeed.put("past_k_" + l, kTen);
                decFeed.put("past_v_" + l, vTen);
                kvTensorsToClose.add(kTen);
                kvTensorsToClose.add(vTen);
            }

            OrtSession.Result decResult = sessDecodeStep.run(decFeed);
            decEmbTensor.close();
            decPosTensor.close();
            for (OnnxTensor t : kvTensorsToClose) {
                t.close();
            }

            float[][][] decHidden = (float[][][]) decResult.get("hidden").get().getValue();
            System.arraycopy(decHidden[0][0], 0, currentH, 0, HIDDEN_SIZE);

            for (int l = 0; l < NUM_LAYERS; l++) {
                float[][][][] pk = (float[][][][]) decResult.get("present_k_" + l).get().getValue();
                float[][][][] pv = (float[][][][]) decResult.get("present_v_" + l).get().getValue();
                pastKList.set(l, pk);
                pastVList.set(l, pv);
            }
            decResult.close();
        }

        int totalFrames = generatedFrames.size();
        if (totalFrames == 0) {
            throw new Exception("Synthesis produced 0 audio frames");
        }

        Log.d(TAG, String.format("Generated %d frames (~%.2fs). Running MOSS Codec decoder...", totalFrames, totalFrames / 25.0));

        // Step 5: Decode audio frames with MOSS Codec
        // Prepare audio_codes (int32 or int64): shape [1, totalFrames, 16]
        long[] flatCodes = new long[totalFrames * N_VQ];
        for (int f = 0; f < totalFrames; f++) {
            int[] frame = generatedFrames.get(f);
            for (int c = 0; c < N_VQ; c++) {
                flatCodes[f * N_VQ + c] = (long) frame[c];
            }
        }

        OnnxTensor codesTensor = createIntTensorForSession(env, sessCodecDecode, "audio_codes", flatCodes, new long[]{1, totalFrames, N_VQ});
        OnnxTensor lensTensor = createIntTensorForSession(env, sessCodecDecode, "audio_code_lengths", new long[]{(long) totalFrames}, new long[]{1});

        Map<String, OnnxTensor> codecFeed = new HashMap<>();
        codecFeed.put("audio_codes", codesTensor);
        codecFeed.put("audio_code_lengths", lensTensor);

        OrtSession.Result codecRes = sessCodecDecode.run(codecFeed);
        codesTensor.close();
        lensTensor.close();

        // MOSS output waveform array
        OnnxValue val = codecRes.get(0);
        float[] pcmAudio = extractPcmWaveform(val.getValue());
        codecRes.close();

        // Step 6: Save PCM float array to 16-bit 48kHz WAV file
        writeWavFile(outputFile, pcmAudio, SAMPLE_RATE);

        double durationSec = (double) pcmAudio.length / (double) SAMPLE_RATE;
        long elapsedMs = System.currentTimeMillis() - startTime;
        Log.d(TAG, String.format("SUCCESS: Saved audio WAV to %s (Duration: %.2fs, Elapsed: %d ms)", outputFile.getAbsolutePath(), durationSec, elapsedMs));

        return outputFile.getAbsolutePath();
    }

    private OnnxTensor createIntTensorForSession(
            OrtEnvironment env,
            OrtSession session,
            String inputName,
            long[] values,
            long[] shape
    ) throws Exception {
        OnnxJavaType expectedType = OnnxJavaType.INT64;
        try {
            Map<String, NodeInfo> inputInfo = session.getInputInfo();
            if (inputInfo != null && inputInfo.containsKey(inputName)) {
                NodeInfo nInfo = inputInfo.get(inputName);
                if (nInfo != null && nInfo.getInfo() instanceof TensorInfo) {
                    TensorInfo tInfo = (TensorInfo) nInfo.getInfo();
                    expectedType = tInfo.type;
                    Log.d(TAG, "ONNX Input '" + inputName + "' expected type: " + expectedType);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to inspect type for ONNX input '" + inputName + "': " + e.getMessage());
        }

        if (expectedType == OnnxJavaType.INT32) {
            int[] intVals = new int[values.length];
            for (int i = 0; i < values.length; i++) {
                intVals[i] = (int) values[i];
            }
            return OnnxTensor.createTensor(env, IntBuffer.wrap(intVals), shape);
        } else {
            return OnnxTensor.createTensor(env, LongBuffer.wrap(values), shape);
        }
    }

    private float[] computeSpeakerAnchor(float[] speakerEmb) {
        float[] v = new float[HIDDEN_SIZE];
        for (int i = 0; i < HIDDEN_SIZE; i++) {
            float sum = xvecB[i];
            float[] wRow = xvecW[i];
            for (int j = 0; j < speakerEmb.length; j++) {
                sum += wRow[j] * speakerEmb[j];
            }
            v[i] = sum;
        }

        // LayerNorm(v)
        float mean = 0f;
        for (float val : v) mean += val;
        mean /= HIDDEN_SIZE;

        float var = 0f;
        for (float val : v) {
            float diff = val - mean;
            var += diff * diff;
        }
        var /= HIDDEN_SIZE;

        float std = (float) Math.sqrt(var + xvecLnEps);
        float[] anchor = new float[HIDDEN_SIZE];
        for (int i = 0; i < HIDDEN_SIZE; i++) {
            anchor[i] = ((v[i] - mean) / std) * xvecLnW[i] + xvecLnB[i];
        }
        return anchor;
    }

    private int sampleToken(float[] hiddenVec, float[][] embVocab, float temperature, int topK, float topP, float repPenalty, Deque<Integer> history, Random rng) {
        int vocabSize = embVocab.length;
        float[] logits = new float[vocabSize];

        for (int v = 0; v < vocabSize; v++) {
            float sum = 0f;
            float[] emb = embVocab[v];
            for (int h = 0; h < HIDDEN_SIZE; h++) {
                sum += hiddenVec[h] * emb[h];
            }
            logits[v] = sum;
        }

        // Apply repetition penalty
        if (repPenalty > 1.0f && !history.isEmpty()) {
            for (int code : history) {
                if (code >= 0 && code < vocabSize) {
                    if (logits[code] < 0) {
                        logits[code] *= repPenalty;
                    } else {
                        logits[code] /= repPenalty;
                    }
                }
            }
        }

        if (temperature > 0) {
            for (int i = 0; i < vocabSize; i++) {
                logits[i] /= temperature;
            }
        }

        // Top-K filtering
        Integer[] indices = new Integer[vocabSize];
        for (int i = 0; i < vocabSize; i++) indices[i] = i;

        if (topK > 0 && topK < vocabSize) {
            Arrays.sort(indices, (a, b) -> Float.compare(logits[b], logits[a]));
            vocabSize = topK;
        } else {
            Arrays.sort(indices, (a, b) -> Float.compare(logits[b], logits[a]));
        }

        // Softmax over candidate logits
        float maxLogit = logits[indices[0]];
        float[] probs = new float[vocabSize];
        float sumProbs = 0f;

        for (int i = 0; i < vocabSize; i++) {
            float p = (float) Math.exp(logits[indices[i]] - maxLogit);
            probs[i] = p;
            sumProbs += p;
        }
        for (int i = 0; i < vocabSize; i++) {
            probs[i] /= sumProbs;
        }

        // Top-P (nucleus sampling)
        if (topP < 1.0f) {
            float cumsum = 0f;
            int cutoff = vocabSize;
            for (int i = 0; i < vocabSize; i++) {
                cumsum += probs[i];
                if (cumsum > topP && i > 0) {
                    cutoff = i + 1;
                    break;
                }
            }
            vocabSize = cutoff;
            sumProbs = 0f;
            for (int i = 0; i < vocabSize; i++) sumProbs += probs[i];
            for (int i = 0; i < vocabSize; i++) probs[i] /= sumProbs;
        }

        // Random choice from distribution
        float r = rng.nextFloat();
        float acc = 0f;
        for (int i = 0; i < vocabSize; i++) {
            acc += probs[i];
            if (r <= acc) {
                return indices[i];
            }
        }
        return indices[0];
    }

    private void addToHistory(Deque<Integer> history, int code, int windowSize) {
        history.addLast(code);
        while (history.size() > windowSize) {
            history.removeFirst();
        }
    }

    private int matmulArgmax(float[] vec, float[][] vocabEmb) {
        int bestIdx = 0;
        float maxVal = -Float.MAX_VALUE;
        for (int i = 0; i < vocabEmb.length; i++) {
            float sum = 0f;
            float[] emb = vocabEmb[i];
            for (int h = 0; h < HIDDEN_SIZE; h++) {
                sum += vec[h] * emb[h];
            }
            if (sum > maxVal) {
                maxVal = sum;
                bestIdx = i;
            }
        }
        return bestIdx;
    }

    private FloatBuffer flatten4D(float[][][][] array) {
        int dim0 = array.length;
        int dim1 = array[0].length;
        int dim2 = array[0][0].length;
        int dim3 = array[0][0][0].length;
        FloatBuffer buf = FloatBuffer.allocate(dim0 * dim1 * dim2 * dim3);
        for (int i = 0; i < dim0; i++) {
            for (int j = 0; j < dim1; j++) {
                for (int k = 0; k < dim2; k++) {
                    buf.put(array[i][j][k]);
                }
            }
        }
        buf.flip();
        return buf;
    }

    private float[] extractPcmWaveform(Object rawValue) {
        if (rawValue instanceof float[][][][]) {
            float[][][][] val = (float[][][][]) rawValue;
            return val[0][0][0];
        } else if (rawValue instanceof float[][][]) {
            float[][][] val = (float[][][]) rawValue;
            return val[0][0];
        } else if (rawValue instanceof float[][]) {
            float[][] val = (float[][]) rawValue;
            return val[0];
        } else if (rawValue instanceof float[]) {
            return (float[]) rawValue;
        }
        throw new IllegalArgumentException("Unexpected MOSS output tensor shape/type: " + rawValue.getClass());
    }

    private void writeWavFile(File outFile, float[] pcm, int sampleRate) throws Exception {
        int numSamples = pcm.length;
        int numChannels = 1;
        int bitsPerSample = 16;
        int byteRate = sampleRate * numChannels * (bitsPerSample / 8);
        int blockAlign = numChannels * (bitsPerSample / 8);
        int dataSize = numSamples * (bitsPerSample / 8);
        int chunkSize = 36 + dataSize;

        try (FileOutputStream out = new FileOutputStream(outFile)) {
            ByteBuffer buf = ByteBuffer.allocate(44 + dataSize);
            buf.order(ByteOrder.LITTLE_ENDIAN);

            // RIFF header
            buf.put("RIFF".getBytes(StandardCharsets.US_ASCII));
            buf.putInt(chunkSize);
            buf.put("WAVE".getBytes(StandardCharsets.US_ASCII));

            // fmt subchunk
            buf.put("fmt ".getBytes(StandardCharsets.US_ASCII));
            buf.putInt(16); // Subchunk1Size (16 for PCM)
            buf.putShort((short) 1); // AudioFormat (1 for PCM)
            buf.putShort((short) numChannels);
            buf.putInt(sampleRate);
            buf.putInt(byteRate);
            buf.putShort((short) blockAlign);
            buf.putShort((short) bitsPerSample);

            // data subchunk
            buf.put("data".getBytes(StandardCharsets.US_ASCII));
            buf.putInt(dataSize);

            for (float sample : pcm) {
                float clamped = Math.max(-1.0f, Math.min(1.0f, sample));
                short pcm16 = (short) (clamped * 32767.0f);
                buf.putShort(pcm16);
            }

            out.write(buf.array());
            out.flush();
        }
    }

    private void loadVoicesJson(File jsonFile) throws Exception {
        try (BufferedReader br = new BufferedReader(new InputStreamReader(new FileInputStream(jsonFile), StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) {
                sb.append(line);
            }
            voicesJsonObject = new JSONObject(sb.toString());
        }
    }

    private void loadNpzWeights(File npzFile) throws Exception {
        Map<String, byte[]> entries = new HashMap<>();
        try (ZipInputStream zis = new ZipInputStream(new BufferedInputStream(new FileInputStream(npzFile)))) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                String name = entry.getName();
                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                byte[] buffer = new byte[65536];
                int len;
                while ((len = zis.read(buffer)) > 0) {
                    baos.write(buffer, 0, len);
                }
                entries.put(name, baos.toByteArray());
                zis.closeEntry();
            }
        }

        // Parse NumPy arrays
        textEmb = parseNpyFloat2D(entries.get("text_emb.npy"), 419, 768);
        audioEmb = parseNpyFloat3D(entries.get("audio_emb.npy"), 16, 1024, 768);
        xvecW = parseNpyFloat2D(entries.get("xvec_w.npy"), 768, 192);
        xvecB = parseNpyFloat1D(entries.get("xvec_b.npy"), 768);
        xvecLnW = parseNpyFloat1D(entries.get("xvec_ln_w.npy"), 768);
        xvecLnB = parseNpyFloat1D(entries.get("xvec_ln_b.npy"), 768);

        if (entries.containsKey("xvec_ln_eps.npy")) {
            float[] epsArr = parseNpyFloat1D(entries.get("xvec_ln_eps.npy"), 1);
            if (epsArr.length > 0) xvecLnEps = epsArr[0];
        }
        Log.d(TAG, "Successfully parsed all NPZ weights arrays!");
    }

    private float[] parseNpyFloat1D(byte[] rawNpy, int expectedLen) {
        ByteBuffer bb = parseNpyHeaderAndGetBuffer(rawNpy);
        float[] arr = new float[expectedLen];
        bb.asFloatBuffer().get(arr);
        return arr;
    }

    private float[][] parseNpyFloat2D(byte[] rawNpy, int dim0, int dim1) {
        ByteBuffer bb = parseNpyHeaderAndGetBuffer(rawNpy);
        FloatBuffer fb = bb.asFloatBuffer();
        float[][] arr = new float[dim0][dim1];
        for (int i = 0; i < dim0; i++) {
            fb.get(arr[i]);
        }
        return arr;
    }

    private float[][][] parseNpyFloat3D(byte[] rawNpy, int dim0, int dim1, int dim2) {
        ByteBuffer bb = parseNpyHeaderAndGetBuffer(rawNpy);
        FloatBuffer fb = bb.asFloatBuffer();
        float[][][] arr = new float[dim0][dim1][dim2];
        for (int i = 0; i < dim0; i++) {
            for (int j = 0; j < dim1; j++) {
                fb.get(arr[i][j]);
            }
        }
        return arr;
    }

    private ByteBuffer parseNpyHeaderAndGetBuffer(byte[] bytes) {
        ByteBuffer headerLenBuf = ByteBuffer.wrap(bytes, 8, 2);
        headerLenBuf.order(ByteOrder.LITTLE_ENDIAN);
        int headerLen = headerLenBuf.getShort() & 0xFFFF;
        int dataOffset = 10 + headerLen;

        ByteBuffer dataBuf = ByteBuffer.wrap(bytes, dataOffset, bytes.length - dataOffset);
        dataBuf.order(ByteOrder.LITTLE_ENDIAN);
        return dataBuf;
    }
}
