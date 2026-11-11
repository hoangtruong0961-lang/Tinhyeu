package com.bachduong.remixvideo;

import android.content.Context;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
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
    private final AtomicBoolean isDownloading = new AtomicBoolean(false);
    private final AtomicBoolean cancelRequested = new AtomicBoolean(false);
    private final AtomicBoolean cancelSynthesisRequested = new AtomicBoolean(false);

    private VieNeuEngine engineInstance;

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
                    if (f.isFile()) {
                        totalBytes += f.length();
                    }
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
                Log.d(TAG, "Starting download of VieNeu Turbo INT8 from HuggingFace...");
                emitProgress("downloading", 0, "Đang kết nối máy chủ HuggingFace...");

                boolean ok = downloadFileWithProgress(TURBO_INT8_URL, tempZip, 0, includeCloning ? 70 : 90);
                if (!ok || cancelRequested.get()) {
                    throw new Exception(cancelRequested.get() ? "Download canceled by user" : "Failed to download core model");
                }

                emitProgress("extracting", includeCloning ? 70 : 90, "Đang giải nén mô hình vào máy...");
                unzipAndFlatten(tempZip, modelsDir);
                tempZip.delete();

                if (includeCloning && !cancelRequested.get()) {
                    emitProgress("downloading", 70, "Đang tải gói nhân bản giọng nói (Cloning)...");
                    File cloneZip = new File(getContext().getCacheDir(), "cloning_download.zip");
                    boolean cloneOk = downloadFileWithProgress(CLONING_URL, cloneZip, 70, 95);
                    if (cloneOk && !cancelRequested.get()) {
                        emitProgress("extracting", 95, "Đang giải nén gói nhân bản...");
                        unzipAndFlatten(cloneZip, modelsDir);
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

                // Pre-initialize engine instance
                if (engineInstance == null) {
                    engineInstance = new VieNeuEngine(modelsDir);
                }
                engineInstance.initialize();

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

    @PluginMethod
    public void listVoices(PluginCall call) {
        try {
            File dir = getModelsDir();
            if (!verifyModelFiles(dir)) {
                call.reject("Mô hình VieNeu chưa được tải về máy.");
                return;
            }
            if (engineInstance == null) {
                engineInstance = new VieNeuEngine(dir);
            }
            engineInstance.initialize();
            List<String> voices = engineInstance.getAvailableVoices();

            JSArray arr = new JSArray();
            for (String v : voices) {
                arr.put(v);
            }

            JSObject res = new JSObject();
            res.put("success", true);
            res.put("voices", arr);
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "listVoices failed", e);
            call.reject("Failed to list voices: " + e.getMessage());
        }
    }

    @PluginMethod
    public void synthesize(PluginCall call) {
        JSArray tokenIdsArray = call.getArray("tokenIds");
        if (tokenIdsArray == null || tokenIdsArray.length() == 0) {
            call.reject("Argument 'tokenIds' must be a non-empty array of integers");
            return;
        }

        String voiceName = call.getString("voiceName", "Minh Đức");
        Double dTemp = call.getDouble("temperature", 0.8);
        float temperature = (dTemp != null) ? dTemp.floatValue() : 0.8f;
        int topK = call.getInt("topK", 25);
        Double dTopP = call.getDouble("topP", 0.95);
        float topP = (dTopP != null) ? dTopP.floatValue() : 0.95f;
        Double dRep = call.getDouble("repPenalty", 1.2);
        float repPenalty = (dRep != null) ? dRep.floatValue() : 1.2f;
        int repWindow = call.getInt("repWindow", 64);
        int maxFrames = call.getInt("maxFrames", 250);

        final Long finalSeed = (call.hasOption("seed") && !call.getData().isNull("seed"))
                ? call.getLong("seed")
                : null;

        int[] tokenIds = new int[tokenIdsArray.length()];
        try {
            for (int i = 0; i < tokenIdsArray.length(); i++) {
                tokenIds[i] = tokenIdsArray.getInt(i);
            }
        } catch (Exception e) {
            call.reject("Invalid tokenIds format: " + e.getMessage());
            return;
        }

        cancelSynthesisRequested.set(false);

        executor.execute(() -> {
            try {
                File dir = getModelsDir();
                if (!verifyModelFiles(dir)) {
                    throw new Exception("Chưa tải đủ file mô hình VieNeu-TTS.");
                }

                if (engineInstance == null) {
                    engineInstance = new VieNeuEngine(dir);
                }
                engineInstance.initialize();

                File cacheDir = getContext().getCacheDir();
                File outFile = new File(cacheDir, "vieneu_synth_" + System.currentTimeMillis() + ".wav");

                String wavPath = engineInstance.synthesize(
                    tokenIds,
                    voiceName,
                    outFile,
                    temperature,
                    topK,
                    topP,
                    repPenalty,
                    repWindow,
                    maxFrames,
                    finalSeed,
                    cancelSynthesisRequested
                );

                double duration = outFile.length() / (48000.0 * 2.0); // 16-bit mono = 2 bytes per sample

                JSObject res = new JSObject();
                res.put("success", true);
                res.put("audioPath", wavPath);
                res.put("duration", Math.round(duration * 100.0) / 100.0);
                call.resolve(res);

            } catch (Exception e) {
                Log.e(TAG, "Synthesis failed", e);
                call.reject("Synthesis failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void cancelSynthesis(PluginCall call) {
        cancelSynthesisRequested.set(true);
        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void releaseModels(PluginCall call) {
        try {
            if (engineInstance != null) {
                engineInstance.release();
                engineInstance = null;
            }
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to release models: " + e.getMessage());
        }
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
            releaseModelsInternal();
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

    private void releaseModelsInternal() {
        if (engineInstance != null) {
            engineInstance.release();
            engineInstance = null;
        }
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
                if (now - lastNotifyTime > 250) {
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

    private void unzipAndFlatten(File zipFile, File targetDir) throws Exception {
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
                // Strip parent directory prefix if zip contains a root folder
                int lastSlash = name.lastIndexOf('/');
                String fileName = (lastSlash >= 0) ? name.substring(lastSlash + 1) : name;

                if (fileName.isEmpty() || entry.isDirectory()) {
                    continue;
                }

                File target = new File(targetDir, fileName);
                // Zip-slip security check
                if (!target.getCanonicalPath().startsWith(targetDir.getCanonicalPath())) {
                    continue;
                }

                try (FileOutputStream fos = new FileOutputStream(target)) {
                    int len;
                    while ((len = zis.read(buffer)) > 0) {
                        fos.write(buffer, 0, len);
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
