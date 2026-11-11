package com.bachduong.remixvideo;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.nio.IntBuffer;
import java.nio.LongBuffer;
import java.util.ArrayDeque;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * VieNeu-TTS v3 Turbo chạy bằng ONNX Runtime (không phụ thuộc Capacitor).
 * Port từ scripts/reference_tts.py. Mọi hằng số lấy từ config.json.
 *
 * Luồng: token ids -> prompt embeds -> prefill -> (mỗi frame: acoustic x16
 * codebook -> decode_step) -> codec -> PCM float mono 48kHz.
 */
public class VieNeuEngine implements AutoCloseable {

    public interface Progress {
        void onFrame(int frame, int maxFrames);
    }

    private static final int REP_WINDOW = 64;

    // ---- config ----
    private final int nVq, hidden, layers, audioVocab, audioPad;
    private final int sgs, eosSpeech, refSlot, textVocab, sampleRate;
    private final int locHeads, locHeadDim;

    // ---- ONNX ----
    private final OrtEnvironment env = OrtEnvironment.getEnvironment();
    private OrtSession prefill, decode, acoustic, codec;

    // ---- weights (heads.npz) ----
    private final float[] textEmb;          // [textVocab * hidden]
    private final FloatBuffer audioEmb;     // direct, [nVq * audioVocab * hidden] ~50MB, nằm ngoài Java heap
    private final FloatBuffer audioEmbRd;   // bản duplicate để đọc (chỉ dùng 1 luồng)
    private final float[] xvecW, xvecB, xvecLnW, xvecLnB;
    private final float xvecLnEps;
    private final float[] scratch;

    private final JSONObject voices;
    private final String[] pastK, pastV, presK, presV;

    public VieNeuEngine(File dir, int threads) throws Exception {
        JSONObject cfg = new JSONObject(readText(new File(dir, "config.json")));
        nVq = cfg.getInt("n_vq");
        hidden = cfg.getInt("hidden_size");
        layers = cfg.getInt("num_hidden_layers");
        audioVocab = cfg.getInt("audio_vocab_size");
        audioPad = cfg.getInt("audio_pad_token_id");
        sgs = cfg.getInt("speech_generation_start_token_id");
        eosSpeech = cfg.getInt("speech_generation_end_token_id");
        refSlot = cfg.getInt("audio_ref_slot_token_id");
        textVocab = cfg.getInt("text_vocab_size");
        sampleRate = cfg.getInt("audio_sample_rate");
        locHeads = cfg.optInt("local_num_attention_heads", 8);
        locHeadDim = hidden / locHeads;
        scratch = new float[hidden];

        pastK = new String[layers];
        pastV = new String[layers];
        presK = new String[layers];
        presV = new String[layers];
        for (int i = 0; i < layers; i++) {
            pastK[i] = "past_k_" + i;
            pastV[i] = "past_v_" + i;
            presK[i] = "present_k_" + i;
            presV[i] = "present_v_" + i;
        }

        // heads.npz = zip chứa các file .npy
        try (ZipFile zf = new ZipFile(new File(dir, "vieneu_v3_heads.npz"))) {
            textEmb = toArray(readNpy(zf, "text_emb"));
            audioEmb = readNpy(zf, "audio_emb");
            xvecW = toArray(readNpy(zf, "xvec_w"));
            xvecB = toArray(readNpy(zf, "xvec_b"));
            xvecLnW = toArray(readNpy(zf, "xvec_ln_w"));
            xvecLnB = toArray(readNpy(zf, "xvec_ln_b"));
            xvecLnEps = toArray(readNpy(zf, "xvec_ln_eps"))[0];
        }
        audioEmbRd = audioEmb.duplicate();

        if (textEmb.length != textVocab * hidden) {
            throw new IOException("text_emb sai kích thước: " + textEmb.length);
        }
        if (audioEmb.capacity() != nVq * audioVocab * hidden) {
            throw new IOException("audio_emb sai kích thước: " + audioEmb.capacity());
        }

        voices = new JSONObject(readText(new File(dir, "voices_v3_turbo.json")));

        // ONNX sessions: nạp bằng ĐƯỜNG DẪN file để ORT tự tìm file .data cạnh .onnx
        prefill = open(new File(dir, "vieneu_prefill.onnx"), threads);
        decode = open(new File(dir, "vieneu_decode_step.onnx"), threads);
        acoustic = open(new File(dir, "vieneu_acoustic_cached.onnx"), threads);
        codec = open(new File(dir, "moss_audio_tokenizer_decode_full.onnx"), threads);
    }

    public int getSampleRate() {
        return sampleRate;
    }

    public String[] listVoices() {
        JSONObject presets = voices.optJSONObject("presets");
        if (presets == null) return new String[0];
        JSONArray names = presets.names();
        String[] out = new String[names == null ? 0 : names.length()];
        for (int i = 0; i < out.length; i++) out[i] = names.optString(i);
        return out;
    }

    private OrtSession open(File f, int threads) throws OrtException {
        OrtSession.SessionOptions so = new OrtSession.SessionOptions();
        so.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
        so.setIntraOpNumThreads(threads);
        so.setInterOpNumThreads(1);
        try {
            so.addXnnpack(Collections.singletonMap("intra_op_num_threads", String.valueOf(threads)));
        } catch (Throwable ignored) {
            // không có XNNPACK thì dùng CPU mặc định
        }
        return env.createSession(f.getAbsolutePath(), so);
    }

    // =====================================================================
    // SYNTHESIZE
    // =====================================================================

    public synchronized float[] synthesize(
            int[] textIds,
            String voiceName,
            float temperature,
            int topK,
            float topP,
            float repPenalty,
            int maxFrames,
            Integer seed,
            Progress progress,
            AtomicBoolean cancel
    ) throws Exception {

        for (int id : textIds) {
            if (id < 0 || id >= textVocab) throw new IllegalArgumentException("token id ngoài vocab: " + id);
        }
        Random rnd = seed != null ? new Random(seed) : new Random();

        // ---- voice preset ----
        JSONObject presets = voices.getJSONObject("presets");
        String vn = voiceName;
        if (vn == null || !presets.has(vn)) {
            Object dv = voices.opt("default_voice");
            vn = (dv instanceof String && presets.has((String) dv)) ? (String) dv : presets.keys().next();
        }
        JSONObject preset = presets.getJSONObject(vn);
        JSONArray spJ = preset.getJSONArray("speaker_emb");
        float[] sp = new float[spJ.length()];
        for (int i = 0; i < sp.length; i++) sp[i] = (float) spJ.getDouble(i);
        JSONArray codesJ = preset.getJSONArray("codes");
        int R = codesJ.length();
        int[][] ref = new int[R][nVq];
        for (int r = 0; r < R; r++) {
            JSONArray row = codesJ.getJSONArray(r);
            for (int c = 0; c < nVq; c++) ref[r][c] = row.getInt(c);
        }

        float[] anchor = speakerAnchor(sp);

        // ---- prompt embeds: text rows + ref audio rows ----
        int T = textIds.length;
        int P = T + R;
        float[] prompt = new float[P * hidden];
        for (int i = 0; i < T; i++) {
            System.arraycopy(textEmb, textIds[i] * hidden, prompt, i * hidden, hidden);
        }
        for (int r = 0; r < R; r++) {
            int base = (T + r) * hidden;
            System.arraycopy(textEmb, refSlot * hidden, prompt, base, hidden);
            for (int ch = 0; ch < nVq; ch++) {
                int code = ref[r][ch];
                if (code == audioPad) continue;
                addAudioRow(prompt, base, ch, code);
            }
        }
        for (int i = 0; i < P; i++) {
            int base = i * hidden;
            for (int k = 0; k < hidden; k++) prompt[base + k] += anchor[k];
        }

        // ---- prefill ----
        OrtSession.Result kv = null;   // giữ KV-cache backbone
        OrtSession.Result ac = null;   // giữ KV-cache acoustic (1 frame)
        java.util.List<int[]> frames = new java.util.ArrayList<>();

        try {
            try (OnnxTensor in = f32(prompt, 1, P, hidden)) {
                kv = prefill.run(Collections.singletonMap("inputs_embeds", in));
            }
            float[] h = readRow(out(kv, "hidden"), P - 1);

            @SuppressWarnings("unchecked")
            ArrayDeque<Integer>[] hist = new ArrayDeque[nVq];
            for (int i = 0; i < nVq; i++) hist[i] = new ArrayDeque<>();

            float[] logits = new float[audioVocab];

            for (int t = 0; t < maxFrames; t++) {
                if (cancel != null && cancel.get()) throw new IOException("cancelled");

                // --- acoustic: 2 slot đầu (cond + sgs) ---
                float[] tokStep = new float[2 * hidden];
                System.arraycopy(h, 0, tokStep, 0, hidden);
                System.arraycopy(textEmb, sgs * hidden, tokStep, hidden, hidden);

                OnnxTensor e0 = f32(tokStep, 1, 2, hidden);
                OnnxTensor p0 = i64(new long[]{0, 1}, 1, 2);
                OnnxTensor emptyK = f32(new float[0], 1, locHeads, 0, locHeadDim);
                OnnxTensor emptyV = f32(new float[0], 1, locHeads, 0, locHeadDim);
                Map<String, OnnxTensor> feed0 = new HashMap<>();
                feed0.put("token_emb", e0);
                feed0.put("position_ids", p0);
                feed0.put("past_k_0", emptyK);
                feed0.put("past_v_0", emptyV);
                try {
                    ac = acoustic.run(feed0);
                } finally {
                    e0.close(); p0.close(); emptyK.close(); emptyV.close();
                }

                OnnxTensor hid0 = out(ac, "hidden");
                float[] slot0 = readRow(hid0, 0);
                float[] h1 = readRow(hid0, 1);

                int[] cur = new int[nVq];

                // codebook 0
                audioLogits(0, h1, logits);
                cur[0] = sampleCode(logits, hist[0], temperature, topK, topP, repPenalty, rnd);
                push(hist[0], cur[0]);

                // codebook 1..nVq-1
                for (int ch = 1; ch < nVq; ch++) {
                    float[] embPrev = new float[hidden];
                    copyAudioRow(embPrev, ch - 1, cur[ch - 1]);

                    OnnxTensor e = f32(embPrev, 1, 1, hidden);
                    OnnxTensor p = i64(new long[]{ch + 1}, 1, 1);
                    Map<String, OnnxTensor> feed = new HashMap<>();
                    feed.put("token_emb", e);
                    feed.put("position_ids", p);
                    feed.put("past_k_0", out(ac, "present_k_0"));
                    feed.put("past_v_0", out(ac, "present_v_0"));
                    OrtSession.Result next;
                    try {
                        next = acoustic.run(feed);
                    } finally {
                        e.close(); p.close();
                    }
                    ac.close();
                    ac = next;

                    float[] hc = readRow(out(ac, "hidden"), 0);
                    audioLogits(ch, hc, logits);
                    cur[ch] = sampleCode(logits, hist[ch], temperature, topK, topP, repPenalty, rnd);
                    push(hist[ch], cur[ch]);
                }
                ac.close();
                ac = null;

                frames.add(cur);
                if (progress != null && (t + 1) % 10 == 0) progress.onFrame(t + 1, maxFrames);

                // --- EOS: argmax(slot0 @ text_emb^T) == speech_generation_end ---
                if (argmaxText(slot0) == eosSpeech) break;

                // --- backbone decode step ---
                float[] slot = new float[hidden];
                System.arraycopy(textEmb, sgs * hidden, slot, 0, hidden);
                for (int ch = 0; ch < nVq; ch++) addAudioRow(slot, 0, ch, cur[ch]);
                for (int k = 0; k < hidden; k++) slot[k] += anchor[k];

                OnnxTensor se = f32(slot, 1, 1, hidden);
                OnnxTensor sp2 = i64(new long[]{P + t}, 1, 1);
                Map<String, OnnxTensor> df = new HashMap<>();
                df.put("inputs_embeds", se);
                df.put("position_ids", sp2);
                for (int i = 0; i < layers; i++) {
                    df.put(pastK[i], out(kv, presK[i]));
                    df.put(pastV[i], out(kv, presV[i]));
                }
                OrtSession.Result nextKv;
                try {
                    nextKv = decode.run(df);
                } finally {
                    se.close(); sp2.close();
                }
                kv.close();
                kv = nextKv;
                h = readRow(out(kv, "hidden"), 0);
            }
        } finally {
            if (ac != null) ac.close();
            if (kv != null) kv.close();
        }

        if (frames.isEmpty()) throw new IOException("Không sinh được frame nào");
        return decodeAudio(frames);
    }

    // =====================================================================
    // CODEC
    // =====================================================================

    private float[] decodeAudio(java.util.List<int[]> frames) throws OrtException {
        int F = frames.size();
        int[] flat = new int[F * nVq];
        for (int i = 0; i < F; i++) System.arraycopy(frames.get(i), 0, flat, i * nVq, nVq);

        try (OnnxTensor codes = OnnxTensor.createTensor(env, IntBuffer.wrap(flat), new long[]{1, F, nVq});
             OnnxTensor lens = OnnxTensor.createTensor(env, IntBuffer.wrap(new int[]{F}), new long[]{1})) {
            Map<String, OnnxTensor> feed = new HashMap<>();
            feed.put("audio_codes", codes);
            feed.put("audio_code_lengths", lens);
            try (OrtSession.Result r = codec.run(feed)) {
                OnnxTensor a = out(r, "audio");
                long[] shape = a.getInfo().getShape();          // [1, C, N]
                int C = (int) shape[1];
                int N = (int) shape[2];
                FloatBuffer fb = a.getFloatBuffer().duplicate();
                fb.rewind();
                float[] all = new float[C * N];
                fb.get(all);
                float[] pcm = new float[N];
                for (int i = 0; i < N; i++) {
                    float s = 0f;
                    for (int c = 0; c < C; c++) s += all[c * N + i];
                    pcm[i] = s / C;                              // trộn kênh -> mono (như reference)
                }
                return pcm;
            }
        }
    }

    public static void writeWav(File f, float[] pcm, int sampleRate) throws IOException {
        int dataLen = pcm.length * 2;
        ByteBuffer bb = ByteBuffer.allocate(44 + dataLen).order(ByteOrder.LITTLE_ENDIAN);
        bb.put(new byte[]{'R', 'I', 'F', 'F'}).putInt(36 + dataLen);
        bb.put(new byte[]{'W', 'A', 'V', 'E', 'f', 'm', 't', ' '}).putInt(16);
        bb.putShort((short) 1).putShort((short) 1).putInt(sampleRate).putInt(sampleRate * 2);
        bb.putShort((short) 2).putShort((short) 16);
        bb.put(new byte[]{'d', 'a', 't', 'a'}).putInt(dataLen);
        for (float v : pcm) {
            float c = Math.max(-1f, Math.min(1f, v));
            bb.putShort((short) Math.round(c * 32767f));
        }
        try (FileOutputStream fos = new FileOutputStream(f)) {
            fos.write(bb.array());
        }
    }

    // =====================================================================
    // MATH / SAMPLING
    // =====================================================================

    private float[] speakerAnchor(float[] sp) {
        int d = sp.length;                                       // 192
        float[] v = new float[hidden];
        for (int j = 0; j < hidden; j++) {
            float s = xvecB[j];
            int base = j * d;
            for (int k = 0; k < d; k++) s += xvecW[base + k] * sp[k];
            v[j] = s;
        }
        float mean = 0f;
        for (float x : v) mean += x;
        mean /= hidden;
        float var = 0f;
        for (float x : v) var += (x - mean) * (x - mean);
        var /= hidden;
        float inv = (float) (1.0 / Math.sqrt(var + xvecLnEps));
        float[] a = new float[hidden];
        for (int j = 0; j < hidden; j++) a[j] = (v[j] - mean) * inv * xvecLnW[j] + xvecLnB[j];
        return a;
    }

    private void addAudioRow(float[] dst, int dstOff, int ch, int code) {
        audioEmbRd.position((ch * audioVocab + code) * hidden);
        audioEmbRd.get(scratch, 0, hidden);
        for (int k = 0; k < hidden; k++) dst[dstOff + k] += scratch[k];
    }

    private void copyAudioRow(float[] dst, int ch, int code) {
        audioEmbRd.position((ch * audioVocab + code) * hidden);
        audioEmbRd.get(dst, 0, hidden);
    }

    /** logits[r] = audio_emb[ch][r] . vec  (r = 0..audioVocab-1) */
    private void audioLogits(int ch, float[] vec, float[] outLogits) {
        int base = ch * audioVocab * hidden;
        audioEmbRd.position(base);
        for (int r = 0; r < audioVocab; r++) {
            audioEmbRd.get(scratch, 0, hidden);
            float s = 0f;
            for (int k = 0; k < hidden; k++) s += scratch[k] * vec[k];
            outLogits[r] = s;
        }
    }

    private int argmaxText(float[] vec) {
        int best = 0;
        float bv = -Float.MAX_VALUE;
        for (int r = 0; r < textVocab; r++) {
            int base = r * hidden;
            float s = 0f;
            for (int k = 0; k < hidden; k++) s += textEmb[base + k] * vec[k];
            if (s > bv) {
                bv = s;
                best = r;
            }
        }
        return best;
    }

    private static void push(ArrayDeque<Integer> q, int v) {
        q.addLast(v);
        if (q.size() > REP_WINDOW) q.removeFirst();
    }

    private static int sampleCode(float[] src, ArrayDeque<Integer> hist, float temp,
                                  int topK, float topP, float rep, Random rnd) {
        int n = src.length;
        float[] l = src.clone();

        if (rep > 1f && !hist.isEmpty()) {
            Set<Integer> seen = new HashSet<>(hist);             // numpy chỉ phạt 1 lần cho mỗi index
            for (int idx : seen) l[idx] = l[idx] < 0 ? l[idx] * rep : l[idx] / rep;
        }
        if (temp > 0f) for (int i = 0; i < n; i++) l[i] /= temp;

        int k = (topK > 0 && topK < n) ? topK : n;
        int[] cand = new int[k];
        float[] cs = new float[k];
        float[] work = l.clone();
        for (int j = 0; j < k; j++) {                            // chọn top-k, giảm dần
            int bi = 0;
            float bv = -Float.MAX_VALUE;
            for (int i = 0; i < n; i++) {
                if (work[i] > bv) {
                    bv = work[i];
                    bi = i;
                }
            }
            cand[j] = bi;
            cs[j] = bv;
            work[bi] = -Float.MAX_VALUE;
        }

        float[] p = new float[k];
        float sum = 0f;
        for (int j = 0; j < k; j++) {
            p[j] = (float) Math.exp(cs[j] - cs[0]);
            sum += p[j];
        }
        for (int j = 0; j < k; j++) p[j] /= sum;

        if (topP < 1f) {
            float cum = 0f, s2 = 0f;
            for (int j = 0; j < k; j++) {
                float before = cum;
                cum += p[j];
                if (!(before < topP)) p[j] = 0f;
                s2 += p[j];
            }
            for (int j = 0; j < k; j++) p[j] /= s2;
        }

        float r = rnd.nextFloat();
        float acc = 0f;
        for (int j = 0; j < k; j++) {
            acc += p[j];
            if (r <= acc) return cand[j];
        }
        return cand[0];
    }

    // =====================================================================
    // ORT HELPERS
    // =====================================================================

    private OnnxTensor f32(float[] d, long... shape) throws OrtException {
        return OnnxTensor.createTensor(env, FloatBuffer.wrap(d), shape);
    }

    private OnnxTensor i64(long[] d, long... shape) throws OrtException {
        return OnnxTensor.createTensor(env, LongBuffer.wrap(d), shape);
    }

    private static OnnxTensor out(OrtSession.Result r, String name) {
        return (OnnxTensor) r.get(name).get();
    }

    private float[] readRow(OnnxTensor t, int row) {
        FloatBuffer d = t.getFloatBuffer().duplicate();
        d.position(row * hidden);
        float[] r = new float[hidden];
        d.get(r);
        return r;
    }

    // =====================================================================
    // FILE HELPERS
    // =====================================================================

    private static String readText(File f) throws IOException {
        try (InputStream in = new BufferedInputStream(new FileInputStream(f));
             ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return bos.toString("UTF-8");
        }
    }

    private static float[] toArray(FloatBuffer fb) {
        FloatBuffer d = fb.duplicate();
        d.rewind();
        float[] a = new float[d.remaining()];
        d.get(a);
        return a;
    }

    private static void readFully(InputStream in, byte[] b, int len) throws IOException {
        int off = 0;
        while (off < len) {
            int n = in.read(b, off, len - off);
            if (n < 0) throw new IOException("EOF sớm khi đọc .npy");
            off += n;
        }
    }

    /** Đọc 1 mảng float32 little-endian từ <name>.npy trong .npz vào direct FloatBuffer. */
    private static FloatBuffer readNpy(ZipFile zf, String name) throws IOException {
        ZipEntry e = zf.getEntry(name + ".npy");
        if (e == null) throw new IOException("vieneu_v3_heads.npz thiếu " + name);
        try (InputStream in = new BufferedInputStream(zf.getInputStream(e), 1 << 16)) {
            byte[] pre = new byte[10];
            readFully(in, pre, 10);
            if ((pre[0] & 0xff) != 0x93 || pre[1] != 'N') throw new IOException("Không phải .npy: " + name);
            int major = pre[6];
            int hlen;
            if (major == 1) {
                hlen = (pre[8] & 0xff) | ((pre[9] & 0xff) << 8);
            } else {
                byte[] more = new byte[2];
                readFully(in, more, 2);
                hlen = (pre[8] & 0xff) | ((pre[9] & 0xff) << 8)
                        | ((more[0] & 0xff) << 16) | ((more[1] & 0xff) << 24);
            }
            byte[] hb = new byte[hlen];
            readFully(in, hb, hlen);
            String header = new String(hb, "ISO-8859-1");
            if (!header.contains("<f4")) throw new IOException(name + ": chỉ hỗ trợ float32 (" + header.trim() + ")");
            if (header.contains("'fortran_order': True")) throw new IOException(name + ": fortran_order không hỗ trợ");

            int s = header.indexOf('(', header.indexOf("shape"));
            int en = header.indexOf(')', s);
            String inner = header.substring(s + 1, en).trim();
            long count = 1;
            if (!inner.isEmpty()) {
                for (String part : inner.split(",")) {
                    part = part.trim();
                    if (!part.isEmpty()) count *= Long.parseLong(part);
                }
            }
            if (count * 4 > Integer.MAX_VALUE) throw new IOException(name + " quá lớn");

            ByteBuffer direct = ByteBuffer.allocateDirect((int) (count * 4)).order(ByteOrder.LITTLE_ENDIAN);
            FloatBuffer dst = direct.asFloatBuffer();
            byte[] buf = new byte[1 << 16];
            long remaining = count * 4;
            while (remaining > 0) {
                int n = (int) Math.min(buf.length, remaining);
                readFully(in, buf, n);
                dst.put(ByteBuffer.wrap(buf, 0, n).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer());
                remaining -= n;
            }
            dst.rewind();
            return dst;
        }
    }

    @Override
    public synchronized void close() {
        try { if (prefill != null) prefill.close(); } catch (Exception ignored) { }
        try { if (decode != null) decode.close(); } catch (Exception ignored) { }
        try { if (acoustic != null) acoustic.close(); } catch (Exception ignored) { }
        try { if (codec != null) codec.close(); } catch (Exception ignored) { }
        prefill = decode = acoustic = codec = null;
    }
}
