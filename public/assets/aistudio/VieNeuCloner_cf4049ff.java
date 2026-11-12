package com.bachduong.remixvideo;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.nio.IntBuffer;
import java.util.HashMap;
import java.util.Map;

/**
 * Clone giọng VieNeu v3 Turbo hoàn toàn offline trên Android.
 *
 * Đầu vào: 2 file WAV đã được FFmpeg chuyển sẵn
 *   - wav16k: 16kHz mono (tối đa 10s)  -> speaker_encoder.onnx  -> speaker_emb[192]
 *   - wav48k: 48kHz stereo (tối đa 5s) -> moss_audio_tokenizer_encode.onnx -> codes[F][16]
 *
 * Kết quả có cùng dạng với một preset trong voices_v3_turbo.json
 * ({ speaker_emb, codes }), nên lưu vào custom_voices.json là engine dùng được.
 */
public final class VieNeuCloner {

    private VieNeuCloner() { }

    public static final class Result {
        public float[] speakerEmb;
        public int[][] codes;
        public float embNorm;
        public int fbankFrames;
    }

    // ---- tham số fbank (kiểu Kaldi). CHƯA đối chiếu được với code chính thức của VieNeu ----
    private static final int NUM_MELS = 80;
    private static final int N_FFT = 512;
    private static final int WIN = 400;      // 25ms @16k
    private static final int HOP = 160;      // 10ms @16k
    private static final int SR = 16000;
    private static final float PREEMPH = 0.97f;
    private static final float LOW_FREQ = 20f;
    private static final float HIGH_FREQ = 8000f;
    private static final float LOG_FLOOR = 1.1920929e-7f;
    /** Trừ trung bình theo thời gian cho từng băng mel. Nếu giọng clone nghe lệch, thử đổi false. */
    private static final boolean APPLY_CMN = true;

    private static final int MAX_REF_FRAMES = 65;   // preset gốc có 13–76 khung (trung vị 57)
    private static final int MIN_FBANK_FRAMES = 100; // ~1 giây

    public static boolean modelsAvailable(File dir) {
        return new File(dir, "speaker_encoder.onnx").exists()
                && new File(dir, "moss_audio_tokenizer_encode.onnx").exists()
                && new File(dir, "moss_audio_tokenizer_encode.data").exists();
    }

    public static Result clone(File modelsDir, File wav16k, File wav48k, int threads) throws Exception {
        Wav w16 = readWav(wav16k);
        float[] mono16 = toMono(w16);
        if (w16.rate != SR) throw new IOException("WAV 16k có sample rate " + w16.rate);

        float[][] fb = fbank(mono16);
        if (fb.length < MIN_FBANK_FRAMES) {
            throw new IOException("Đoạn âm thanh quá ngắn (" + fb.length / 100f
                    + " giây). Cần tối thiểu khoảng 3 giây, tốt nhất 5–10 giây.");
        }

        OrtEnvironment env = OrtEnvironment.getEnvironment();
        Result res = new Result();
        res.fbankFrames = fb.length;

        // ---------- 1. speaker embedding ----------
        int T = fb.length;
        float[] flat = new float[T * NUM_MELS];
        for (int t = 0; t < T; t++) System.arraycopy(fb[t], 0, flat, t * NUM_MELS, NUM_MELS);

        try (OrtSession.SessionOptions so = new OrtSession.SessionOptions()) {
            so.setIntraOpNumThreads(threads);
            try (OrtSession s = env.createSession(new File(modelsDir, "speaker_encoder.onnx").getAbsolutePath(), so);
                 OnnxTensor in = OnnxTensor.createTensor(env, FloatBuffer.wrap(flat), new long[]{1, T, NUM_MELS});
                 OrtSession.Result r = s.run(java.util.Collections.singletonMap("input", in))) {
                OnnxTensor o = (OnnxTensor) r.get("output").get();
                FloatBuffer ob = o.getFloatBuffer().duplicate();
                ob.rewind();
                float[] emb = new float[ob.remaining()];
                ob.get(emb);
                if (emb.length != 192) throw new IOException("speaker_emb có " + emb.length + " chiều, cần 192");
                double n2 = 0;
                for (float v : emb) {
                    if (Float.isNaN(v) || Float.isInfinite(v)) throw new IOException("speaker_emb chứa NaN/Inf");
                    n2 += v * v;
                }
                res.speakerEmb = emb;
                res.embNorm = (float) Math.sqrt(n2);
            }
        }

        // ---------- 2. reference codes (MOSS encoder) ----------
        Wav w48 = readWav(wav48k);
        if (w48.rate != 48000) throw new IOException("WAV 48k có sample rate " + w48.rate);
        int L = w48.data.length / w48.channels;
        float[] planar = new float[2 * L];
        for (int i = 0; i < L; i++) {
            float l = w48.data[i * w48.channels];
            float r = w48.channels >= 2 ? w48.data[i * w48.channels + 1] : l;
            planar[i] = l;
            planar[L + i] = r;
        }

        try (OrtSession.SessionOptions so = new OrtSession.SessionOptions()) {
            so.setIntraOpNumThreads(threads);
            // nạp bằng đường dẫn để ORT tìm được moss_audio_tokenizer_encode.data cạnh file .onnx
            try (OrtSession s = env.createSession(new File(modelsDir, "moss_audio_tokenizer_encode.onnx").getAbsolutePath(), so);
                 OnnxTensor wave = OnnxTensor.createTensor(env, FloatBuffer.wrap(planar), new long[]{1, 2, L});
                 OnnxTensor lens = OnnxTensor.createTensor(env, IntBuffer.wrap(new int[]{L}), new long[]{1})) {
                Map<String, OnnxTensor> feed = new HashMap<>();
                feed.put("waveform", wave);
                feed.put("input_lengths", lens);
                try (OrtSession.Result r = s.run(feed)) {
                    OnnxTensor codes = (OnnxTensor) r.get("audio_codes").get();
                    long[] shape = codes.getInfo().getShape();          // [1, F, 16]
                    int F = (int) shape[1];
                    int C = (int) shape[2];
                    if (C != 16) throw new IOException("audio_codes có " + C + " codebook, cần 16");
                    IntBuffer ib = codes.getIntBuffer().duplicate();
                    ib.rewind();
                    int[] all = new int[F * C];
                    ib.get(all);
                    int keep = Math.min(F, MAX_REF_FRAMES);
                    if (keep < 10) throw new IOException("Mã tham chiếu quá ngắn (" + keep + " khung)");
                    int[][] out = new int[keep][C];
                    for (int f = 0; f < keep; f++) System.arraycopy(all, f * C, out[f], 0, C);
                    res.codes = out;
                }
            }
        }
        return res;
    }

    // =====================================================================
    // FBANK kiểu Kaldi: DC offset, pre-emphasis 0.97, cửa sổ Povey, FFT 512,
    // 80 mel (20–8000Hz, thang 1127*ln(1+f/700)), log, (tuỳ chọn) CMN
    // =====================================================================

    private static final double[] WINDOW = new double[WIN];
    private static final float[][] MEL = new float[NUM_MELS][N_FFT / 2];   // 80 x 256 (bỏ bin Nyquist như Kaldi)
    private static final double[] COS_T = new double[N_FFT / 2];
    private static final double[] SIN_T = new double[N_FFT / 2];

    static {
        for (int i = 0; i < WIN; i++) {
            WINDOW[i] = Math.pow(0.5 - 0.5 * Math.cos(2 * Math.PI * i / (WIN - 1)), 0.85);
        }
        for (int i = 0; i < N_FFT / 2; i++) {
            COS_T[i] = Math.cos(-2 * Math.PI * i / N_FFT);
            SIN_T[i] = Math.sin(-2 * Math.PI * i / N_FFT);
        }
        double binWidth = (double) SR / N_FFT;
        double melLow = mel(LOW_FREQ);
        double melHigh = mel(HIGH_FREQ);
        double delta = (melHigh - melLow) / (NUM_MELS + 1);
        for (int b = 0; b < NUM_MELS; b++) {
            double left = melLow + b * delta;
            double center = melLow + (b + 1) * delta;
            double right = melLow + (b + 2) * delta;
            for (int j = 0; j < N_FFT / 2; j++) {
                double m = mel(binWidth * j);
                if (m > left && m < right) {
                    double w = m <= center ? (m - left) / (center - left) : (right - m) / (right - center);
                    MEL[b][j] = (float) w;
                }
            }
        }
    }

    private static double mel(double hz) {
        return 1127.0 * Math.log(1.0 + hz / 700.0);
    }

    static float[][] fbank(float[] samples) throws IOException {
        int n = samples.length;
        if (n < WIN) throw new IOException("Âm thanh quá ngắn");
        int frames = 1 + (n - WIN) / HOP;
        float[][] out = new float[frames][NUM_MELS];

        double[] re = new double[N_FFT];
        double[] im = new double[N_FFT];
        double[] frame = new double[WIN];
        double[] power = new double[N_FFT / 2];

        for (int f = 0; f < frames; f++) {
            int start = f * HOP;
            double mean = 0;
            for (int i = 0; i < WIN; i++) {
                frame[i] = samples[start + i] * 32768.0;     // quy ước Kaldi (int16)
                mean += frame[i];
            }
            mean /= WIN;
            for (int i = 0; i < WIN; i++) frame[i] -= mean;
            for (int i = WIN - 1; i > 0; i--) frame[i] -= PREEMPH * frame[i - 1];
            frame[0] -= PREEMPH * frame[0];

            for (int i = 0; i < N_FFT; i++) {
                re[i] = i < WIN ? frame[i] * WINDOW[i] : 0.0;
                im[i] = 0.0;
            }
            fft(re, im);
            for (int k = 0; k < N_FFT / 2; k++) power[k] = re[k] * re[k] + im[k] * im[k];

            for (int b = 0; b < NUM_MELS; b++) {
                double e = 0;
                float[] row = MEL[b];
                for (int k = 0; k < N_FFT / 2; k++) e += row[k] * power[k];
                out[f][b] = (float) Math.log(Math.max(e, LOG_FLOOR));
            }
        }

        if (APPLY_CMN) {
            for (int b = 0; b < NUM_MELS; b++) {
                double m = 0;
                for (int f = 0; f < frames; f++) m += out[f][b];
                m /= frames;
                for (int f = 0; f < frames; f++) out[f][b] -= (float) m;
            }
        }
        return out;
    }

    private static void fft(double[] re, double[] im) {
        int n = re.length;
        for (int i = 1, j = 0; i < n; i++) {
            int bit = n >> 1;
            for (; (j & bit) != 0; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) {
                double tr = re[i]; re[i] = re[j]; re[j] = tr;
                double ti = im[i]; im[i] = im[j]; im[j] = ti;
            }
        }
        for (int len = 2; len <= n; len <<= 1) {
            int half = len >> 1;
            int step = n / len;
            for (int i = 0; i < n; i += len) {
                for (int k = 0; k < half; k++) {
                    double wr = COS_T[k * step];
                    double wi = SIN_T[k * step];
                    int a = i + k;
                    int b = a + half;
                    double vr = re[b] * wr - im[b] * wi;
                    double vi = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - vr;
                    im[b] = im[a] - vi;
                    re[a] += vr;
                    im[a] += vi;
                }
            }
        }
    }

    // =====================================================================
    // WAV
    // =====================================================================

    private static final class Wav {
        float[] data;      // xen kẽ các kênh
        int channels;
        int rate;
    }

    private static float[] toMono(Wav w) {
        if (w.channels == 1) return w.data;
        int n = w.data.length / w.channels;
        float[] m = new float[n];
        for (int i = 0; i < n; i++) {
            float s = 0;
            for (int c = 0; c < w.channels; c++) s += w.data[i * w.channels + c];
            m[i] = s / w.channels;
        }
        return m;
    }

    private static Wav readWav(File f) throws IOException {
        byte[] b;
        try (InputStream in = new FileInputStream(f); ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            b = bos.toByteArray();
        }
        if (b.length < 44 || b[0] != 'R' || b[1] != 'I' || b[2] != 'F' || b[3] != 'F') {
            throw new IOException("Không phải file WAV hợp lệ: " + f.getName());
        }
        ByteBuffer bb = ByteBuffer.wrap(b).order(ByteOrder.LITTLE_ENDIAN);
        int pos = 12;
        int fmtTag = 1, ch = 1, rate = 16000, bits = 16;
        int dataOff = -1;
        long dataLen = 0;
        while (pos + 8 <= b.length) {
            String id = new String(b, pos, 4, "US-ASCII");
            long sz = bb.getInt(pos + 4) & 0xffffffffL;
            if (id.equals("fmt ")) {
                fmtTag = bb.getShort(pos + 8) & 0xffff;
                ch = bb.getShort(pos + 10) & 0xffff;
                rate = bb.getInt(pos + 12);
                bits = bb.getShort(pos + 22) & 0xffff;
            } else if (id.equals("data")) {
                dataOff = pos + 8;
                dataLen = Math.min(sz, (long) b.length - dataOff);
                break;
            }
            pos += 8 + (int) Math.min(sz + (sz & 1), Integer.MAX_VALUE - 16);
        }
        if (dataOff < 0) throw new IOException("WAV không có chunk data");
        if (ch < 1) throw new IOException("WAV có 0 kênh");

        Wav w = new Wav();
        w.channels = ch;
        w.rate = rate;
        if (fmtTag == 1 && bits == 16) {
            int n = (int) (dataLen / 2);
            n -= n % ch;
            w.data = new float[n];
            for (int i = 0; i < n; i++) w.data[i] = bb.getShort(dataOff + i * 2) / 32768f;
        } else if (fmtTag == 3 && bits == 32) {
            int n = (int) (dataLen / 4);
            n -= n % ch;
            w.data = new float[n];
            for (int i = 0; i < n; i++) w.data[i] = bb.getFloat(dataOff + i * 4);
        } else {
            throw new IOException("WAV định dạng " + fmtTag + "/" + bits + " bit chưa hỗ trợ");
        }
        if (w.data.length == 0) throw new IOException("WAV không có mẫu âm thanh");
        return w;
    }
}
