package com.bachduong.remixvideo;

import android.util.Log;

import ai.onnxruntime.NodeInfo;
import ai.onnxruntime.OnnxJavaType;
import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OnnxValue;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import ai.onnxruntime.TensorInfo;

import com.arthenica.ffmpegkit.FFmpegKit;
import com.arthenica.ffmpegkit.FFmpegSession;
import com.arthenica.ffmpegkit.ReturnCode;

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
        voiceName = resolvePresetName(presets, voiceName);
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
        // Frontend convertTextToTokenIds() already wraps as [style_id, 3, ...phoneIds, 4].
        // Only wrap if raw phone IDs were passed without TPS/TPE framing.
        int[] textTokenIds;
        if (inputTokenIds.length >= 3
                && inputTokenIds[1] == TEXT_PROMPT_START_TOKEN_ID
                && inputTokenIds[inputTokenIds.length - 1] == TEXT_PROMPT_END_TOKEN_ID) {
            textTokenIds = inputTokenIds;
        } else {
            textTokenIds = new int[2 + inputTokenIds.length + 1];
            textTokenIds[0] = DEFAULT_STYLE_TOKEN_ID;
            textTokenIds[1] = TEXT_PROMPT_START_TOKEN_ID;
            System.arraycopy(inputTokenIds, 0, textTokenIds, 2, inputTokenIds.length);
            textTokenIds[textTokenIds.length - 1] = TEXT_PROMPT_END_TOKEN_ID;
        }
        int tPromptText = textTokenIds.length;

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

        Log.d(TAG, String.format("Generated %d frames (~%.2fs). Running MOSS Codec decoder...", totalFrames, totalFrames / 12.5));

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

    private String resolvePresetName(JSONObject presets, String requested) {
        if (requested == null || requested.trim().isEmpty()) return "Minh Đức";
        String cleanReq = requested.trim();
        if (presets.has(cleanReq)) return cleanReq;

        JSONArray names = presets.names();
        if (names != null) {
            // Pass 1: exact case-insensitive match first (never lose to a shorter substring preset)
            for (int i = 0; i < names.length(); i++) {
                String candidate = names.optString(i, "");
                if (candidate.equalsIgnoreCase(cleanReq)) {
                    Log.d(TAG, "Resolved requested voice '" + requested + "' -> exact preset '" + candidate + "'");
                    return candidate;
                }
            }
            // Pass 2: substring fallback
            String reqLower = cleanReq.toLowerCase();
            for (int i = 0; i < names.length(); i++) {
                String candidate = names.optString(i, "");
                if (!candidate.isEmpty() && (candidate.toLowerCase().contains(reqLower) || reqLower.contains(candidate.toLowerCase()))) {
                    Log.d(TAG, "Resolved requested voice '" + requested + "' -> substring preset '" + candidate + "'");
                    return candidate;
                }
            }
        }

        Log.w(TAG, "Requested voice '" + requested + "' not found in presets, falling back to 'Minh Đức'");
        return "Minh Đức";
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
            if (val[0].length >= 2) {
                float[] ch0 = val[0][0];
                float[] ch1 = val[0][1];
                int len = Math.min(ch0.length, ch1.length);
                float[] mono = new float[len];
                for (int i = 0; i < len; i++) {
                    mono[i] = (ch0[i] + ch1[i]) * 0.5f;
                }
                return mono;
            }
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

        // Also merge any saved custom cloned voices from custom_voices.json
        try {
            File customFile = new File(modelsDir, "custom_voices.json");
            if (customFile.exists()) {
                try (BufferedReader cbr = new BufferedReader(new InputStreamReader(new FileInputStream(customFile), StandardCharsets.UTF_8))) {
                    StringBuilder csb = new StringBuilder();
                    String cline;
                    while ((cline = cbr.readLine()) != null) {
                        csb.append(cline);
                    }
                    JSONObject customObj = new JSONObject(csb.toString());
                    JSONObject presets = voicesJsonObject.optJSONObject("presets");
                    if (presets == null) {
                        presets = new JSONObject();
                        voicesJsonObject.put("presets", presets);
                    }
                    JSONArray cnames = customObj.names();
                    if (cnames != null) {
                        for (int i = 0; i < cnames.length(); i++) {
                            String k = cnames.getString(i);
                            presets.put(k, customObj.get(k));
                        }
                    }
                    Log.d(TAG, "Loaded custom cloned voices from " + customFile.getName());
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to load custom voices file: " + e.getMessage());
        }
    }

    public synchronized void updateCustomVoiceInMemory(String name, JSONObject voiceData) {
        if (voicesJsonObject == null || name == null || voiceData == null) return;
        try {
            JSONObject presets = voicesJsonObject.optJSONObject("presets");
            if (presets == null) {
                presets = new JSONObject();
                voicesJsonObject.put("presets", presets);
            }
            presets.put(name, voiceData);
            Log.d(TAG, "Updated in-memory custom voice preset: " + name);
        } catch (Exception e) {
            Log.w(TAG, "Failed to update in-memory custom voice: " + name, e);
        }
    }

    public synchronized void removeCustomVoiceInMemory(String name) {
        if (voicesJsonObject == null || name == null) return;
        try {
            JSONObject presets = voicesJsonObject.optJSONObject("presets");
            if (presets != null && presets.has(name)) {
                presets.remove(name);
                Log.d(TAG, "Removed in-memory custom voice preset: " + name);
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to remove in-memory custom voice: " + name, e);
        }
    }

    public void registerCustomVoice(String name, float[] speakerEmb, int[][] codes) {
        try {
            JSONObject voiceData = new JSONObject();
            JSONArray spkArr = new JSONArray();
            for (float f : speakerEmb) {
                spkArr.put((double) f);
            }
            voiceData.put("speaker_emb", spkArr);

            JSONArray codesArr = new JSONArray();
            for (int[] row : codes) {
                JSONArray rowArr = new JSONArray();
                for (int c : row) rowArr.put(c);
                codesArr.put(rowArr);
            }
            voiceData.put("codes", codesArr);

            updateCustomVoiceInMemory(name, voiceData);
            Log.d(TAG, "Registered custom voice: " + name + " with " + codes.length + " ref frames");

            // Persist to custom_voices.json in modelsDir
            File customFile = new File(modelsDir, "custom_voices.json");
            JSONObject customFileObj = new JSONObject();
            if (customFile.exists()) {
                try (BufferedReader cbr = new BufferedReader(new InputStreamReader(new FileInputStream(customFile), StandardCharsets.UTF_8))) {
                    StringBuilder csb = new StringBuilder();
                    String cline;
                    while ((cline = cbr.readLine()) != null) csb.append(cline);
                    customFileObj = new JSONObject(csb.toString());
                } catch (Exception ignored) {}
            }
            customFileObj.put(name, voiceData);
            try (FileOutputStream fos = new FileOutputStream(customFile)) {
                fos.write(customFileObj.toString().getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to register custom voice: " + name, e);
        }
    }

    // =========================================================================
    // REAL ONNX VOICE CLONING (speaker_encoder.onnx + moss_audio_tokenizer_encode.onnx)
    // =========================================================================

    private static final int CLONE_NUM_MELS = 80;
    private static final int CLONE_N_FFT = 512;
    private static final int CLONE_WIN_LEN = 400; // 25ms @ 16kHz
    private static final int CLONE_HOP_LEN = 160; // 10ms @ 16kHz
    private static final int CLONE_SPK_SR = 16000;
    private static final int CLONE_MOSS_SR = 48000;
    private static float[][] cachedMelFilterbank = null;

    private static final class DecodedWav {
        final float[] samples; // interleaved if stereo
        final int channels;
        final int sampleRate;
        DecodedWav(float[] samples, int channels, int sampleRate) {
            this.samples = samples;
            this.channels = channels;
            this.sampleRate = sampleRate;
        }
    }

    /**
     * Extracts real speaker_emb (192-dim) and RVQ audio codes ([T][16]) on-device
     * using FFmpeg decoding + silence trimming + speaker_encoder.onnx + moss_audio_tokenizer_encode.onnx.
     */
    public synchronized JSONObject cloneVoiceFromAudio(
            String voiceName,
            File inputAudioFile,
            File workDir
    ) throws Exception {
        long startMs = System.currentTimeMillis();
        if (env == null) {
            env = OrtEnvironment.getEnvironment();
        }

        File spkModelFile = new File(modelsDir, "speaker_encoder.onnx");
        File mossEncodeFile = new File(modelsDir, "moss_audio_tokenizer_encode.onnx");
        File mossEncodeDataFile = new File(modelsDir, "moss_audio_tokenizer_encode.data");

        if (!spkModelFile.exists() || spkModelFile.length() == 0
                || !mossEncodeFile.exists() || mossEncodeFile.length() == 0
                || !mossEncodeDataFile.exists() || mossEncodeDataFile.length() == 0) {
            throw new Exception("Thiếu tệp mô hình AI Clone Giọng (speaker_encoder.onnx hoặc moss_audio_tokenizer_encode). Vui lòng tải gói Clone giọng (~64 MB).");
        }

        String ts = String.valueOf(System.currentTimeMillis());
        File wav16kFile = new File(workDir, "clone_16k_" + ts + ".wav");
        File wav48kFile = new File(workDir, "clone_48k_" + ts + ".wav");

        try {
            // Step 1: Decode audio to clean 16kHz mono & 48kHz stereo WAV via FFmpegKit
            convertToCloneWav(inputAudioFile, wav16kFile, 1, CLONE_SPK_SR);
            convertToCloneWav(inputAudioFile, wav48kFile, 2, CLONE_MOSS_SR);

            DecodedWav wav16 = parseWavFile(wav16kFile);
            DecodedWav wav48 = parseWavFile(wav48kFile);

            float[] pcm16Raw = toMono(wav16.samples, wav16.channels);
            if (pcm16Raw.length < CLONE_SPK_SR / 2) {
                throw new Exception("Âm thanh quá ngắn (dưới 0.5 giây). Vui lòng cung cấp đoạn nói rõ ràng từ 3 đến 10 giây.");
            }

            // Step 2: Active-speech VAD silence trimming & loudness normalization
            // Frame size = 320 samples (20ms @ 16kHz)
            int frameLen = 320;
            int totalFrames = pcm16Raw.length / frameLen;
            float[] frameRms = new float[totalFrames];
            float peakRms = 0f;
            float overallPeakAmp = 0f;

            for (int f = 0; f < totalFrames; f++) {
                int off = f * frameLen;
                double sq = 0.0;
                for (int i = 0; i < frameLen; i++) {
                    float s = pcm16Raw[off + i];
                    sq += s * s;
                    float abs = Math.abs(s);
                    if (abs > overallPeakAmp) overallPeakAmp = abs;
                }
                float rms = (float) Math.sqrt(sq / frameLen);
                frameRms[f] = rms;
                if (rms > peakRms) peakRms = rms;
            }

            if (overallPeakAmp < 0.004f || peakRms < 0.002f) {
                throw new Exception("Âm thanh chỉ toàn im lặng hoặc âm lượng quá nhỏ. Vui lòng ghi âm lại gần micro hơn.");
            }

            float speechThresh = Math.max(0.005f, peakRms * 0.12f);
            int firstActive = -1;
            int lastActive = -1;
            for (int f = 0; f < totalFrames; f++) {
                if (frameRms[f] >= speechThresh) {
                    if (firstActive == -1) firstActive = f;
                    lastActive = f;
                }
            }
            if (firstActive == -1) {
                firstActive = 0;
                lastActive = totalFrames - 1;
            }

            int startFrame = Math.max(0, firstActive - 2); // 40ms pre-roll
            int endFrame = Math.min(totalFrames, lastActive + 4); // 60ms tail
            int startSample16 = startFrame * frameLen;
            int endSample16 = Math.min(pcm16Raw.length, endFrame * frameLen);
            int activeSamples16 = endSample16 - startSample16;

            double activeDurationSec = (double) activeSamples16 / (double) CLONE_SPK_SR;
            if (activeDurationSec < 0.8) {
                throw new Exception(String.format(
                        "Giọng nói thực tế quá ngắn (chỉ có %.1fs sau khi bỏ khoảng lặng). Vui lòng nói rõ câu dài từ 3 đến 8 giây.",
                        activeDurationSec
                ));
            }

            // Use up to 10s of active speech for speaker_encoder.onnx
            int spkSliceLen = Math.min(activeSamples16, CLONE_SPK_SR * 10);
            float[] pcm16Trimmed = Arrays.copyOfRange(pcm16Raw, startSample16, startSample16 + spkSliceLen);

            // Compute active speech RMS and gain so soft mic recordings match reference levels cleanly
            double sumSqActive = 0.0;
            float peakActive = 0f;
            for (float s : pcm16Trimmed) {
                sumSqActive += s * s;
                float a = Math.abs(s);
                if (a > peakActive) peakActive = a;
            }
            float activeRms = (float) Math.sqrt(sumSqActive / Math.max(1, pcm16Trimmed.length));
            float targetGain = Math.min(0.09f / Math.max(activeRms, 1e-5f), 0.90f / Math.max(peakActive, 1e-5f));
            targetGain = Math.max(0.4f, Math.min(8.0f, targetGain));
            if (targetGain * peakActive > 0.92f) {
                targetGain = 0.92f / Math.max(peakActive, 1e-5f);
            }
            for (int i = 0; i < pcm16Trimmed.length; i++) {
                pcm16Trimmed[i] = Math.max(-0.98f, Math.min(0.98f, pcm16Trimmed[i] * targetGain));
            }

            // Slice corresponding 48kHz stereo window: max 4.8s active speech (~60 MOSS RVQ frames @ 12.5 Hz)
            double startSec = (double) startSample16 / (double) CLONE_SPK_SR;
            int total48Frames = wav48.samples.length / Math.max(1, wav48.channels);
            int start48 = Math.max(0, Math.min(total48Frames - 1, (int) Math.round(startSec * CLONE_MOSS_SR)));
            int end48 = Math.min(total48Frames, (int) Math.round(((double) endSample16 / CLONE_SPK_SR) * CLONE_MOSS_SR));
            int avail48 = end48 - start48;
            if (avail48 < CLONE_MOSS_SR / 2) {
                start48 = 0;
                avail48 = total48Frames;
            }
            int mossFramesLen = Math.min(avail48, (int) (CLONE_MOSS_SR * 4.8));

            float[] planar48 = new float[2 * mossFramesLen];
            if (wav48.channels >= 2) {
                int chStride = wav48.channels;
                for (int i = 0; i < mossFramesLen; i++) {
                    int srcIdx = (start48 + i) * chStride;
                    float l = Math.max(-0.98f, Math.min(0.98f, wav48.samples[srcIdx] * targetGain));
                    float r = Math.max(-0.98f, Math.min(0.98f, wav48.samples[srcIdx + 1] * targetGain));
                    planar48[i] = l;
                    planar48[mossFramesLen + i] = r;
                }
            } else {
                for (int i = 0; i < mossFramesLen; i++) {
                    float m = Math.max(-0.98f, Math.min(0.98f, wav48.samples[start48 + i] * targetGain));
                    planar48[i] = m;
                    planar48[mossFramesLen + i] = m;
                }
            }

            // Step 3: Extract 192-dim Speaker Embedding using speaker_encoder.onnx
            float[] speakerEmb = runSpeakerEncoder(spkModelFile, pcm16Trimmed);

            // Step 4: Extract 16-channel RVQ audio codes using moss_audio_tokenizer_encode.onnx
            int[][] refCodes = runMossTokenizerEncode(mossEncodeFile, planar48, mossFramesLen);

            // Step 5: Persist to custom_voices.json & update in-memory presets immediately
            registerCustomVoice(voiceName, speakerEmb, refCodes);

            long elapsedMs = System.currentTimeMillis() - startMs;
            Log.d(TAG, String.format(
                    "REAL CLONE SUCCESS '%s': active=%.2fs, gain=%.2fx, refFrames=%d, elapsed=%dms",
                    voiceName, activeDurationSec, targetGain, refCodes.length, elapsedMs
            ));

            JSONObject result = new JSONObject();
            JSONArray spkArr = new JSONArray();
            for (float v : speakerEmb) spkArr.put((double) v);
            JSONArray codesArr = new JSONArray();
            for (int[] row : refCodes) {
                JSONArray rowArr = new JSONArray();
                for (int c : row) rowArr.put(c);
                codesArr.put(rowArr);
            }
            result.put("speaker_emb", spkArr);
            result.put("codes", codesArr);
            result.put("numFrames", refCodes.length);
            result.put("activeDurationSec", Math.round(activeDurationSec * 100.0) / 100.0);
            result.put("elapsedMs", elapsedMs);
            return result;
        } finally {
            try { if (wav16kFile.exists()) wav16kFile.delete(); } catch (Exception ignored) {}
            try { if (wav48kFile.exists()) wav48kFile.delete(); } catch (Exception ignored) {}
        }
    }

    private void convertToCloneWav(File inputFile, File outputWav, int channels, int sampleRate) throws Exception {
        String cmd = String.format(
                java.util.Locale.US,
                "-y -i \"%s\" -af \"highpass=f=75\" -ac %d -ar %d -t 15 -c:a pcm_s16le \"%s\"",
                inputFile.getAbsolutePath(), channels, sampleRate, outputWav.getAbsolutePath()
        );
        FFmpegSession session = FFmpegKit.execute(cmd);
        if (!ReturnCode.isSuccess(session.getReturnCode()) || !outputWav.exists() || outputWav.length() < 44) {
            // Retry without highpass audio filter just in case
            String fallbackCmd = String.format(
                    java.util.Locale.US,
                    "-y -i \"%s\" -ac %d -ar %d -t 15 -c:a pcm_s16le \"%s\"",
                    inputFile.getAbsolutePath(), channels, sampleRate, outputWav.getAbsolutePath()
            );
            session = FFmpegKit.execute(fallbackCmd);
            if (!ReturnCode.isSuccess(session.getReturnCode()) || !outputWav.exists() || outputWav.length() < 44) {
                String errOut = session.getFailStackTrace();
                if (errOut == null || errOut.trim().isEmpty()) {
                    errOut = session.getOutput();
                }
                if (errOut != null && errOut.length() > 300) {
                    errOut = errOut.substring(errOut.length() - 300);
                }
                throw new Exception("Không thể giải mã tệp âm thanh (" + sampleRate + "Hz). Chi tiết FFmpeg: " + errOut);
            }
        }
    }

    private float[] runSpeakerEncoder(File modelFile, float[] pcm16k) throws Exception {
        int numFrames = Math.max(1, (pcm16k.length - CLONE_WIN_LEN) / CLONE_HOP_LEN + 1);
        float[] fbank = computeFbank80(pcm16k);
        if (fbank.length != numFrames * CLONE_NUM_MELS) {
            numFrames = fbank.length / CLONE_NUM_MELS;
        }
        if (numFrames < 5) {
            throw new Exception("Độ dài phổ âm thanh không đủ khung hình cho Speaker Encoder.");
        }

        OrtSession.SessionOptions opts = new OrtSession.SessionOptions();
        opts.setInterOpNumThreads(1);
        opts.setIntraOpNumThreads(Math.min(Math.max(Runtime.getRuntime().availableProcessors() / 2, 1), 4));
        opts.addConfigEntry("session.intra_op.allow_spinning", "0");

        try (OrtSession spkSession = env.createSession(modelFile.getAbsolutePath(), opts);
             OnnxTensor inputTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(fbank), new long[]{1, numFrames, CLONE_NUM_MELS})) {

            Map<String, OnnxTensor> feed = Collections.singletonMap("input", inputTensor);
            try (OrtSession.Result res = spkSession.run(feed)) {
                Object raw = res.get("output").get().getValue();
                float[] emb;
                if (raw instanceof float[][]) {
                    emb = ((float[][]) raw)[0];
                } else if (raw instanceof float[]) {
                    emb = (float[]) raw;
                } else {
                    throw new Exception("Đầu ra speaker_encoder không hợp lệ: " + raw.getClass());
                }
                if (emb.length < 192) {
                    throw new Exception("Speaker embedding chỉ có " + emb.length + " chiều (yêu cầu 192).");
                }
                float[] out = Arrays.copyOf(emb, 192);
                for (float v : out) {
                    if (Float.isNaN(v) || Float.isInfinite(v)) {
                        throw new Exception("Speaker Encoder trả về giá trị NaN/Inf.");
                    }
                }
                return out;
            }
        }
    }

    private int[][] runMossTokenizerEncode(File modelFile, float[] planarStereoWave, int numSamplesPerCh) throws Exception {
        OrtSession.SessionOptions opts = new OrtSession.SessionOptions();
        opts.setInterOpNumThreads(1);
        opts.setIntraOpNumThreads(Math.min(Math.max(Runtime.getRuntime().availableProcessors() / 2, 1), 4));
        opts.addConfigEntry("session.intra_op.allow_spinning", "0");

        try (OrtSession mossSession = env.createSession(modelFile.getAbsolutePath(), opts);
             OnnxTensor waveTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(planarStereoWave), new long[]{1, 2, numSamplesPerCh});
             OnnxTensor lenTensor = createIntTensorForSession(env, mossSession, "input_lengths", new long[]{(long) numSamplesPerCh}, new long[]{1})) {

            Map<String, OnnxTensor> feed = new HashMap<>();
            feed.put("waveform", waveTensor);
            feed.put("input_lengths", lenTensor);

            try (OrtSession.Result res = mossSession.run(feed)) {
                Object codesRaw = res.get("audio_codes").get().getValue();
                int reportedLen = Integer.MAX_VALUE;
                if (res.get("audio_code_lengths").isPresent()) {
                    Object lenRaw = res.get("audio_code_lengths").get().getValue();
                    if (lenRaw instanceof int[]) {
                        reportedLen = ((int[]) lenRaw)[0];
                    } else if (lenRaw instanceof long[]) {
                        reportedLen = (int) ((long[]) lenRaw)[0];
                    }
                }

                int[][] extracted;
                if (codesRaw instanceof int[][][]) {
                    int[][][] arr = (int[][][]) codesRaw;
                    int rawFrames = arr[0].length;
                    int validFrames = Math.min(rawFrames, Math.min(reportedLen, 70));
                    if (validFrames < 5) {
                        throw new Exception("MOSS Tokenizer chỉ trích xuất được " + validFrames + " khung âm thanh.");
                    }
                    extracted = new int[validFrames][N_VQ];
                    for (int f = 0; f < validFrames; f++) {
                        for (int c = 0; c < N_VQ; c++) {
                            int code = arr[0][f][c];
                            if (code < 0) code = 0;
                            if (code >= 1024) code = 1023;
                            extracted[f][c] = code;
                        }
                    }
                } else if (codesRaw instanceof long[][][]) {
                    long[][][] arr = (long[][][]) codesRaw;
                    int rawFrames = arr[0].length;
                    int validFrames = Math.min(rawFrames, Math.min(reportedLen, 70));
                    if (validFrames < 5) {
                        throw new Exception("MOSS Tokenizer chỉ trích xuất được " + validFrames + " khung âm thanh.");
                    }
                    extracted = new int[validFrames][N_VQ];
                    for (int f = 0; f < validFrames; f++) {
                        for (int c = 0; c < N_VQ; c++) {
                            int code = (int) arr[0][f][c];
                            if (code < 0) code = 0;
                            if (code >= 1024) code = 1023;
                            extracted[f][c] = code;
                        }
                    }
                } else {
                    throw new Exception("Đầu ra audio_codes không hợp lệ: " + codesRaw.getClass());
                }
                return extracted;
            }
        }
    }

    private float[] computeFbank80(float[] samples16k) {
        if (cachedMelFilterbank == null) {
            cachedMelFilterbank = createMelFilterbank(CLONE_NUM_MELS, CLONE_N_FFT, CLONE_SPK_SR, 20.0, 8000.0);
        }
        float[] window = new float[CLONE_WIN_LEN];
        for (int i = 0; i < CLONE_WIN_LEN; i++) {
            window[i] = (float) (0.54 - 0.46 * Math.cos((2.0 * Math.PI * i) / (CLONE_WIN_LEN - 1)));
        }

        int numFrames = (samples16k.length - CLONE_WIN_LEN) / CLONE_HOP_LEN + 1;
        if (numFrames <= 0) {
            return new float[CLONE_NUM_MELS];
        }

        float[] fbank = new float[numFrames * CLONE_NUM_MELS];
        float[] real = new float[CLONE_N_FFT];
        float[] imag = new float[CLONE_N_FFT];
        int numBins = CLONE_N_FFT / 2 + 1; // 257
        float[] power = new float[numBins];

        for (int f = 0; f < numFrames; f++) {
            Arrays.fill(real, 0f);
            Arrays.fill(imag, 0f);
            int start = f * CLONE_HOP_LEN;
            for (int i = 0; i < CLONE_WIN_LEN; i++) {
                real[i] = samples16k[start + i] * window[i];
            }
            fft512(real, imag);
            for (int k = 0; k < numBins; k++) {
                power[k] = real[k] * real[k] + imag[k] * imag[k];
            }
            for (int m = 0; m < CLONE_NUM_MELS; m++) {
                float energy = 0f;
                float[] melRow = cachedMelFilterbank[m];
                for (int k = 0; k < numBins; k++) {
                    energy += melRow[k] * power[k];
                }
                fbank[f * CLONE_NUM_MELS + m] = (float) Math.log(Math.max(energy, 1e-5f));
            }
        }

        // Cepstral Mean Normalization (CMN) per Mel bin across time
        for (int m = 0; m < CLONE_NUM_MELS; m++) {
            double mean = 0.0;
            for (int f = 0; f < numFrames; f++) {
                mean += fbank[f * CLONE_NUM_MELS + m];
            }
            float fMean = (float) (mean / numFrames);
            for (int f = 0; f < numFrames; f++) {
                fbank[f * CLONE_NUM_MELS + m] -= fMean;
            }
        }
        return fbank;
    }

    private static float[][] createMelFilterbank(int numBands, int nFft, int sampleRate, double fMin, double fMax) {
        int numBins = nFft / 2 + 1;
        double minMel = 2595.0 * Math.log10(1.0 + fMin / 700.0);
        double maxMel = 2595.0 * Math.log10(1.0 + fMax / 700.0);
        int[] binPoints = new int[numBands + 2];
        for (int i = 0; i <= numBands + 1; i++) {
            double mel = minMel + ((double) i / (numBands + 1)) * (maxMel - minMel);
            double hz = 700.0 * (Math.pow(10.0, mel / 2595.0) - 1.0);
            binPoints[i] = (int) Math.floor(((nFft + 1) * hz) / sampleRate);
        }

        float[][] fb = new float[numBands][numBins];
        for (int m = 0; m < numBands; m++) {
            int start = Math.max(0, Math.min(numBins - 1, binPoints[m]));
            int center = Math.max(0, Math.min(numBins - 1, binPoints[m + 1]));
            int end = Math.max(0, Math.min(numBins, binPoints[m + 2]));
            for (int k = start; k < center; k++) {
                fb[m][k] = (float) (k - start) / Math.max(1, center - start);
            }
            for (int k = center; k < end; k++) {
                fb[m][k] = (float) (end - k) / Math.max(1, end - center);
            }
        }
        return fb;
    }

    private static void fft512(float[] real, float[] imag) {
        final int N = 512;
        int j = 0;
        for (int i = 0; i < N - 1; i++) {
            if (i < j) {
                float tr = real[i]; real[i] = real[j]; real[j] = tr;
                float ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
            }
            int k = N >> 1;
            while (k <= j) {
                j -= k;
                k >>= 1;
            }
            j += k;
        }
        for (int len = 2; len <= N; len <<= 1) {
            int half = len >> 1;
            double angle = (-2.0 * Math.PI) / len;
            float wStepR = (float) Math.cos(angle);
            float wStepI = (float) Math.sin(angle);
            for (int i = 0; i < N; i += len) {
                float wR = 1f;
                float wI = 0f;
                for (int k = 0; k < half; k++) {
                    float uR = real[i + k];
                    float uI = imag[i + k];
                    float vR = real[i + k + half] * wR - imag[i + k + half] * wI;
                    float vI = real[i + k + half] * wI + imag[i + k + half] * wR;
                    real[i + k] = uR + vR;
                    imag[i + k] = uI + vI;
                    real[i + k + half] = uR - vR;
                    imag[i + k + half] = uI - vI;
                    float nextWR = wR * wStepR - wI * wStepI;
                    float nextWI = wR * wStepI + wI * wStepR;
                    wR = nextWR;
                    wI = nextWI;
                }
            }
        }
    }

    private DecodedWav parseWavFile(File wavFile) throws Exception {
        byte[] bytes = java.nio.file.Files.readAllBytes(wavFile.toPath());
        if (bytes.length < 44) {
            throw new Exception("Tệp WAV giải mã không hợp lệ (< 44 bytes).");
        }
        ByteBuffer bb = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        int channels = 1;
        int sampleRate = 16000;
        int bitsPerSample = 16;
        int dataOffset = 44;
        int dataSize = bytes.length - 44;

        int offset = 12;
        while (offset + 8 <= bytes.length) {
            String chunkId = new String(bytes, offset, 4, StandardCharsets.US_ASCII);
            int chunkSize = bb.getInt(offset + 4);
            if ("fmt ".equals(chunkId) && offset + 24 <= bytes.length) {
                channels = bb.getShort(offset + 10) & 0xFFFF;
                sampleRate = bb.getInt(offset + 12);
                bitsPerSample = bb.getShort(offset + 22) & 0xFFFF;
            } else if ("data".equals(chunkId)) {
                dataOffset = offset + 8;
                dataSize = Math.min(chunkSize, bytes.length - dataOffset);
                break;
            }
            if (chunkSize < 0) break;
            offset += 8 + chunkSize + (chunkSize % 2);
        }

        int bytesPerSample = Math.max(1, bitsPerSample / 8);
        int numSamples = Math.max(0, dataSize / bytesPerSample);
        float[] samples = new float[numSamples];
        for (int i = 0; i < numSamples; i++) {
            int pos = dataOffset + i * bytesPerSample;
            if (pos + bytesPerSample > bytes.length) break;
            if (bitsPerSample == 16) {
                samples[i] = bb.getShort(pos) / 32768.0f;
            } else if (bitsPerSample == 32) {
                samples[i] = bb.getFloat(pos);
            }
        }
        return new DecodedWav(samples, channels, sampleRate);
    }

    private float[] toMono(float[] interleaved, int channels) {
        if (channels <= 1) return interleaved;
        int frames = interleaved.length / channels;
        float[] mono = new float[frames];
        for (int i = 0; i < frames; i++) {
            float sum = 0f;
            int base = i * channels;
            for (int c = 0; c < channels; c++) {
                sum += interleaved[base + c];
            }
            mono[i] = sum / channels;
        }
        return mono;
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
