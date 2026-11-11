package com.bachduong.remixvideo;

import android.content.Context;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@CapacitorPlugin(name = "VieNeuNative")
public class VieNeuPlugin extends Plugin {

    private static final String TAG = "VieNeuNative";
    private static final String TURBO_INT8_URL = "https://huggingface.co/datasets/hongtuyen/vTranslate/resolve/main/vieneu_v3_turbo_int8.zip";
    private static final String CLONING_URL = "https://huggingface.co/datasets/hongtuyen/vTranslate/resolve/main/vieneu_v3_turbo_cloning.zip";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final ExecutorService ttsExecutor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean synthCancel = new AtomicBoolean(false);
    private VieNeuEngine engine;
    private final AtomicBoolean isDownloading = new AtomicBoolean(false);
    private final AtomicBoolean cancelRequested = new AtomicBoolean(false);

    private File getModelsDir() {
        Context ctx = getContext();
        File dir = new File(ctx.getFilesDir(), "vieneu_models");
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return dir;
    }

    private boolean verifyModelFiles(File dir) {
        String[] required = new String[] {
            "vieneu_prefill.onnx",
            "vieneu_decode_step.onnx",
            "vieneu_acoustic_cached.onnx",
            "vieneu_backbone_shared.data",
            "moss_audio_tokenizer_decode_full.onnx",
            "moss_audio_tokenizer_decode_shared.data",
            "vieneu_v3_heads.npz",
            "config.json",
            "tokenizer.json",
            "voices_v3_turbo.json",
            "vieneu_vi_g2p.json"
        };
        for (String req : required) {
            File f = new File(dir, req);
            if (!f.exists() || f.length() == 0) {
                return false;
            }
        }
        return true;
    }

    @PluginMethod
    public void checkStatus(PluginCall call) {
        try {
            File dir = getModelsDir();
            boolean ready = verifyModelFiles(dir);

            long totalBytes = 0;
            File[] files = dir.listFiles();
            if (files != null) {
                for (File f : files) {
                    totalBytes += f.length();
                }
            }

            JSObject ret = new JSObject();
            ret.put("isReady", ready);
            ret.put("isDownloading", isDownloading.get());
            ret.put("modelsPath", dir.getAbsolutePath());
            ret.put("totalSizeMB", Math.round((totalBytes / (1024.0 * 1024.0)) * 10.0) / 10.0);
            ret.put("platform", "android");
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "checkStatus failed", e);
            call.reject("Failed to check VieNeu status: " + e.getMessage());
        }
    }

    @PluginMethod
    public void downloadModels(PluginCall call) {
        if (isDownloading.get()) {
            call.reject("A download is already in progress");
            return;
        }

        boolean includeCloning = Boolean.TRUE.equals(call.getBoolean("includeCloning", false));
        isDownloading.set(true);
        cancelRequested.set(false);

        executor.execute(() -> {
            File modelsDir = getModelsDir();
            File tempZip = new File(getContext().getCacheDir(), "vieneu_download.zip");

            try {
                // Step 1: Download Core Turbo INT8
                Log.d(TAG, "Starting download of VieNeu Turbo INT8 from HuggingFace...");
                emitProgress("downloading", 0, "Đang kết nối máy chủ HuggingFace...");

                boolean ok = downloadFileWithProgress(TURBO_INT8_URL, tempZip, 0, includeCloning ? 70 : 100);
                if (!ok || cancelRequested.get()) {
                    throw new Exception(cancelRequested.get() ? "Download canceled by user" : "Failed to download core model");
                }

                // Step 2: Unzip Core Turbo INT8
                emitProgress("extracting", includeCloning ? 70 : 90, "Đang giải nén mô hình vào máy...");
                unzipFile(tempZip, modelsDir);
                flattenIfNested(modelsDir);
                tempZip.delete();

                // Step 3: Optional cloning bundle
                if (includeCloning && !cancelRequested.get()) {
                    emitProgress("downloading", 70, "Đang tải gói nhân bản giọng nói (Cloning)...");
                    File cloneZip = new File(getContext().getCacheDir(), "cloning_download.zip");
                    boolean cloneOk = downloadFileWithProgress(CLONING_URL, cloneZip, 70, 95);
                    if (cloneOk && !cancelRequested.get()) {
                        emitProgress("extracting", 95, "Đang giải nén gói nhân bản...");
                        unzipFile(cloneZip, modelsDir);
                        flattenIfNested(modelsDir);
                    }
                    cloneZip.delete();
                }

                if (cancelRequested.get()) {
                    throw new Exception("Download canceled by user");
                }

                boolean verified = verifyModelFiles(modelsDir);
                if (!verified) {
                    throw new Exception("Verification failed: Some model files are missing or incomplete.");
                }

                isDownloading.set(false);
                emitProgress("completed", 100, "Tải mô hình thành công! Đã sẵn sàng hoạt động 100% Offline.");

                JSObject res = new JSObject();
                res.put("success", true);
                res.put("modelsPath", modelsDir.getAbsolutePath());
                res.put("isReady", true);
                call.resolve(res);

            } catch (Exception e) {
                Log.e(TAG, "Download error", e);
                isDownloading.set(false);
                if (tempZip.exists()) tempZip.delete();

                emitProgress("error", 0, "Lỗi tải mô hình: " + e.getMessage());
                call.reject("Download error: " + e.getMessage());
            }
        });
    }

    private boolean downloadFileWithProgress(String downloadUrl, File destination, int percentStart, int percentEnd) {
        HttpURLConnection conn = null;
        InputStream in = null;
        OutputStream out = null;

        try {
            URL url = new URL(downloadUrl);
            conn = (HttpURLConnection) url.openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(25000);
            conn.setReadTimeout(30000);
            conn.connect();

            int code = conn.getResponseCode();
            if (code == HttpURLConnection.HTTP_MOVED_TEMP || code == HttpURLConnection.HTTP_MOVED_PERM || code == 307 || code == 308) {
                String newUrl = conn.getHeaderField("Location");
                conn.disconnect();
                url = new URL(newUrl);
                conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(25000);
                conn.setReadTimeout(30000);
                conn.connect();
            }

            long totalBytes = conn.getContentLength();
            if (totalBytes <= 0) {
                totalBytes = 154532969L; // fallback estimation (~147 MB)
            }

            in = new BufferedInputStream(conn.getInputStream());
            out = new FileOutputStream(destination);

            byte[] buffer = new byte[65536];
            long bytesReadTotal = 0;
            int count;
            long lastNotifyTime = System.currentTimeMillis();

            while ((count = in.read(buffer)) != -1) {
                if (cancelRequested.get()) {
                    return false;
                }
                out.write(buffer, 0, count);
                bytesReadTotal += count;

                long now = System.currentTimeMillis();
                if (now - lastNotifyTime > 250) { // Notify UI every 250ms
                    double fraction = (double) bytesReadTotal / (double) totalBytes;
                    int curPercent = (int) (percentStart + fraction * (percentEnd - percentStart));
                    curPercent = Math.min(percentEnd, Math.max(percentStart, curPercent));

                    double downloadedMB = Math.round((bytesReadTotal / (1024.0 * 1024.0)) * 10.0) / 10.0;
                    double totalMB = Math.round((totalBytes / (1024.0 * 1024.0)) * 10.0) / 10.0;
                    String msg = String.format("Đang tải: %.1f MB / %.1f MB (%d%%)", downloadedMB, totalMB, curPercent);

                    emitProgress("downloading", curPercent, msg);
                    lastNotifyTime = now;
                }
            }

            out.flush();
            return true;
        } catch (Exception e) {
            Log.e(TAG, "downloadFileWithProgress failed", e);
            return false;
        } finally {
            try { if (in != null) in.close(); } catch (Exception ignored) {}
            try { if (out != null) out.close(); } catch (Exception ignored) {}
            if (conn != null) conn.disconnect();
        }
    }

    private void unzipFile(File zipFile, File targetDir) throws Exception {
        if (!targetDir.exists()) {
            targetDir.mkdirs();
        }
        try (ZipInputStream zis = new ZipInputStream(new BufferedInputStream(new FileInputStream(zipFile)))) {
            ZipEntry entry;
            byte[] buffer = new byte[65536];
            while ((entry = zis.getNextEntry()) != null) {
                if (cancelRequested.get()) {
                    throw new Exception("Extraction canceled by user");
                }
                String name = entry.getName();
                // Avoid directory traversal vulnerability
                File target = new File(targetDir, name);
                if (!target.getCanonicalPath().startsWith(targetDir.getCanonicalPath() + File.separator)) {
                    continue;
                }
                if (entry.isDirectory()) {
                    target.mkdirs();
                } else {
                    File parent = target.getParentFile();
                    if (parent != null && !parent.exists()) parent.mkdirs();
                    try (FileOutputStream fos = new FileOutputStream(target)) {
                        int len;
                        while ((len = zis.read(buffer)) > 0) {
                            fos.write(buffer, 0, len);
                        }
                    }
                }
                zis.closeEntry();
            }
        }
    }

    private void emitProgress(String status, int percent, String message) {
        JSObject data = new JSObject();
        data.put("status", status);
        data.put("percent", percent);
        data.put("message", message);
        notifyListeners("vieneu_download_progress", data);
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        cancelRequested.set(true);
        isDownloading.set(false);
        emitProgress("cancelled", 0, "Đã hủy tải.");
        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void deleteModels(PluginCall call) {
        try {
            releaseEngine();
            File dir = getModelsDir();
            deleteRecursive(dir);
            dir.mkdirs();

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("message", "Đã xóa toàn bộ dữ liệu mô hình VieNeu-TTS để giải phóng bộ nhớ");
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to delete models: " + e.getMessage());
        }
    }

    // ------------------------------------------------------------------
    // TTS
    // ------------------------------------------------------------------

    /** Nếu zip giải nén ra thư mục con thì kéo file lên thư mục gốc. */
    private void flattenIfNested(File dir) {
        File[] subs = dir.listFiles(File::isDirectory);
        if (subs == null) return;
        for (File s : subs) {
            File[] kids = s.listFiles();
            if (kids != null) {
                for (File k : kids) k.renameTo(new File(dir, k.getName()));
            }
            s.delete();
        }
    }

    private synchronized VieNeuEngine getEngine() throws Exception {
        if (engine == null) {
            File dir = getModelsDir();
            if (!verifyModelFiles(dir)) {
                throw new IllegalStateException("MODELS_NOT_DOWNLOADED");
            }
            int threads = Math.max(2, Math.min(4, Runtime.getRuntime().availableProcessors() / 2));
            engine = new VieNeuEngine(dir, threads);
        }
        return engine;
    }

    private synchronized void releaseEngine() {
        if (engine != null) {
            engine.close();
            engine = null;
        }
    }

    /**
     * synthesize({ tokenIds:number[], voiceName?, temperature?, topK?, topP?,
     *              repPenalty?, maxFrames?, seed? })
     * -> { success, audioPath, duration, sampleRate }
     * tokenIds do TypeScript tạo (gồm cả style/TEXT_PROMPT_START/END như reference_tts.py).
     */
    @PluginMethod
    public void synthesize(PluginCall call) {
        JSArray arr = call.getArray("tokenIds");
        if (arr == null || arr.length() == 0) {
            call.reject("tokenIds is required");
            return;
        }
        final int[] ids = new int[arr.length()];
        try {
            for (int i = 0; i < ids.length; i++) ids[i] = arr.getInt(i);
        } catch (JSONException e) {
            call.reject("tokenIds must be an array of integers");
            return;
        }

        final String voiceName = call.getString("voiceName", null);
        final float temperature = call.getFloat("temperature", 0.8f);
        final int topK = call.getInt("topK", 25);
        final float topP = call.getFloat("topP", 0.95f);
        final float repPenalty = call.getFloat("repPenalty", 1.2f);
        final int maxFrames = call.getInt("maxFrames", 250);
        final Integer seed = call.getInt("seed");

        synthCancel.set(false);
        ttsExecutor.execute(() -> {
            try {
                VieNeuEngine eng = getEngine();
                long t0 = System.currentTimeMillis();
                float[] pcm = eng.synthesize(ids, voiceName, temperature, topK, topP, repPenalty,
                        maxFrames, seed,
                        (frame, max) -> {
                            JSObject p = new JSObject();
                            p.put("frame", frame);
                            p.put("maxFrames", max);
                            notifyListeners("vieneu_synth_progress", p);
                        },
                        synthCancel);

                File outFile = new File(getContext().getCacheDir(), "vieneu_" + t0 + ".wav");
                VieNeuEngine.writeWav(outFile, pcm, eng.getSampleRate());
                cleanOldWavs(outFile);

                JSObject res = new JSObject();
                res.put("success", true);
                res.put("audioPath", outFile.getAbsolutePath());
                res.put("sampleRate", eng.getSampleRate());
                res.put("duration", pcm.length / (double) eng.getSampleRate());
                res.put("elapsedMs", System.currentTimeMillis() - t0);
                call.resolve(res);
            } catch (IllegalStateException e) {
                call.reject("MODELS_NOT_DOWNLOADED", "MODELS_NOT_DOWNLOADED");
            } catch (Throwable t) {
                Log.e(TAG, "synthesize failed", t);
                call.reject("Synthesize error: " + t.getMessage());
            }
        });
    }

    @PluginMethod
    public void cancelSynthesis(PluginCall call) {
        synthCancel.set(true);
        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    /** Giải phóng RAM của model (khoảng 200MB+) khi không dùng nữa. */
    @PluginMethod
    public void releaseModels(PluginCall call) {
        releaseEngine();
        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void listVoices(PluginCall call) {
        ttsExecutor.execute(() -> {
            try {
                String[] names = getEngine().listVoices();
                JSArray a = new JSArray();
                for (String n : names) a.put(n);
                JSObject ret = new JSObject();
                ret.put("voices", a);
                call.resolve(ret);
            } catch (Throwable t) {
                call.reject("listVoices error: " + t.getMessage());
            }
        });
    }

    private void cleanOldWavs(File keep) {
        File[] files = getContext().getCacheDir().listFiles();
        if (files == null) return;
        long now = System.currentTimeMillis();
        for (File f : files) {
            if (!f.equals(keep) && f.getName().startsWith("vieneu_") && f.getName().endsWith(".wav")
                    && now - f.lastModified() > 10 * 60 * 1000L) {
                f.delete();
            }
        }
    }

    @Override
    protected void handleOnDestroy() {
        releaseEngine();
        super.handleOnDestroy();
    }

    private void deleteRecursive(File fileOrDirectory) {
        if (fileOrDirectory.isDirectory()) {
            File[] children = fileOrDirectory.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursive(child);
                }
            }
        }
        fileOrDirectory.delete();
    }
}
