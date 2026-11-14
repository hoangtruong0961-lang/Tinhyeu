package com.bachduong.remixvideo;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;

import com.arthenica.ffmpegkit.FFmpegKit;
import com.arthenica.ffmpegkit.FFmpegKitConfig;
import com.arthenica.ffmpegkit.FFmpegSession;
import com.arthenica.ffmpegkit.ReturnCode;
import com.arthenica.ffmpegkit.SessionState;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "FFmpegKitNative")
public class FFmpegKitPlugin extends Plugin {

    private static final String TAG = "FFmpegKitNative";
    private final ExecutorService ioExecutor = Executors.newCachedThreadPool();
    private volatile boolean fontsConfigured = false;

    private synchronized void ensureFontsConfigured() {
        if (fontsConfigured) return;
        try {
            Map<String, String> fontMap = new HashMap<>();
            fontMap.put("Arial", "Roboto");
            fontMap.put("sans-serif", "Roboto");
            fontMap.put("Montserrat", "Roboto");
            fontMap.put("Inter", "Roboto");
            fontMap.put("Plus Jakarta Sans", "Roboto");
            fontMap.put("Be Vietnam Pro", "Roboto");
            fontMap.put("Roboto Condensed", "Roboto");
            fontMap.put("Playfair Display", "Noto Serif");
            FFmpegKitConfig.setFontDirectory(getContext().getApplicationContext(), "/system/fonts", fontMap);
            fontsConfigured = true;
        } catch (Throwable t) {
            Log.w(TAG, "setFontDirectory warning: " + t.getMessage());
        }
    }

    @PluginMethod
    public void getInfo(PluginCall call) {
        try {
            ensureFontsConfigured();
            JSObject ret = new JSObject();
            ret.put("isNative", true);
            ret.put("platform", "android");
            ret.put("version", FFmpegKitConfig.getVersion());
            ret.put("buildDate", FFmpegKitConfig.getBuildDate());
            ret.put("packageType", "ffmpeg-kit-full");
            call.resolve(ret);
        } catch (Throwable t) {
            Log.e(TAG, "FFmpegKit getInfo failed/unavailable on this device: " + t.getMessage(), t);
            JSObject fallback = new JSObject();
            fallback.put("isNative", false);
            fallback.put("platform", "android");
            fallback.put("version", "web-fallback");
            fallback.put("packageType", "none");
            fallback.put("error", t.getMessage() != null ? t.getMessage() : t.toString());
            call.resolve(fallback);
        }
    }

    @PluginMethod
    public void execute(PluginCall call) {
        String command = call.getString("command");
        if (command == null || command.trim().isEmpty()) {
            call.reject("Command argument cannot be empty");
            return;
        }

        try {
            ensureFontsConfigured();
            Log.d(TAG, "Executing FFmpeg command: " + command);

            FFmpegKit.executeAsync(
                command,
                session -> {
                    SessionState state = session.getState();
                    ReturnCode returnCode = session.getReturnCode();

                    JSObject result = new JSObject();
                    result.put("sessionId", session.getSessionId());
                    result.put("state", state != null ? state.name() : "UNKNOWN");
                    result.put("returnCode", returnCode != null ? returnCode.getValue() : -1);
                    result.put("isSuccess", ReturnCode.isSuccess(returnCode));
                    result.put("isCancel", ReturnCode.isCancel(returnCode));
                    result.put("duration", session.getDuration());
                    result.put("output", session.getOutput());

                    if (ReturnCode.isSuccess(returnCode)) {
                        call.resolve(result);
                    } else if (ReturnCode.isCancel(returnCode)) {
                        call.reject("FFmpeg command cancelled", "CANCELLED", result);
                    } else {
                        String failMsg = session.getFailStackTrace();
                        if (failMsg == null || failMsg.isEmpty()) {
                            failMsg = session.getOutput();
                        }
                        call.reject("FFmpeg execution failed with code " + (returnCode != null ? returnCode.getValue() : -1) + ": " + failMsg, "FAILED", result);
                    }
                },
                log -> {
                    JSObject logData = new JSObject();
                    logData.put("sessionId", log.getSessionId());
                    logData.put("level", log.getLevel() != null ? log.getLevel().name() : "INFO");
                    logData.put("message", log.getMessage());
                    notifyListeners("ffmpegLog", logData);
                },
                statistics -> {
                    JSObject statsData = new JSObject();
                    statsData.put("sessionId", statistics.getSessionId());
                    statsData.put("time", statistics.getTime());
                    statsData.put("size", statistics.getSize());
                    statsData.put("bitrate", statistics.getBitrate());
                    statsData.put("speed", statistics.getSpeed());
                    statsData.put("videoFps", statistics.getVideoFps());
                    statsData.put("videoQuality", statistics.getVideoQuality());
                    notifyListeners("ffmpegStatistics", statsData);
                }
            );

        } catch (Throwable e) {
            Log.e(TAG, "FFmpegKit execution error", e);
            Exception ex = e instanceof Exception ? (Exception) e : new Exception(e);
            call.reject("FFmpeg execution exception: " + e.getMessage(), ex);
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        Long sessionId = call.getLong("sessionId");
        try {
            if (sessionId != null && sessionId > 0) {
                FFmpegKit.cancel(sessionId);
            } else {
                FFmpegKit.cancel();
            }
            JSObject res = new JSObject();
            res.put("cancelled", true);
            call.resolve(res);
        } catch (Throwable e) {
            Exception ex = e instanceof Exception ? (Exception) e : new Exception(e);
            call.reject("Failed to cancel FFmpeg session: " + e.getMessage(), ex);
        }
    }

    // =========================================================================
    // NATIVE FILE BRIDGE & MEDIASTORE DOWNLOADS EXPORT (ZERO-OOM FOR ANDROID)
    // =========================================================================

    @PluginMethod
    public void resolveCapacitorUrl(PluginCall call) {
        String rawUrl = call.getString("url", "");
        ioExecutor.execute(() -> {
            try {
                String path = extractNativeFilePath(rawUrl);
                if (path != null) {
                    File f = new File(path);
                    if (f.exists() && f.isFile() && f.length() > 0) {
                        JSObject res = new JSObject();
                        res.put("exists", true);
                        res.put("filePath", f.getAbsolutePath());
                        res.put("sizeBytes", f.length());
                        call.resolve(res);
                        return;
                    }
                }
                JSObject res = new JSObject();
                res.put("exists", false);
                res.put("filePath", "");
                res.put("sizeBytes", 0);
                call.resolve(res);
            } catch (Throwable t) {
                JSObject res = new JSObject();
                res.put("exists", false);
                res.put("filePath", "");
                res.put("sizeBytes", 0);
                call.resolve(res);
            }
        });
    }

    @PluginMethod
    public void openTempFile(PluginCall call) {
        String requestedName = call.getString("fileName", "temp_" + System.currentTimeMillis() + ".bin");
        ioExecutor.execute(() -> {
            try {
                File tmpDir = getTempExportDir();
                cleanupOldFiles(tmpDir, 2L * 3600L * 1000L);
                String safeName = System.currentTimeMillis() + "_" + sanitizeFileName(requestedName);
                File f = new File(tmpDir, safeName);
                if (f.exists()) f.delete();
                if (!f.createNewFile()) {
                    throw new Exception("Không thể tạo tệp tạm trên bộ nhớ máy.");
                }
                JSObject res = new JSObject();
                res.put("success", true);
                res.put("filePath", f.getAbsolutePath());
                call.resolve(res);
            } catch (Throwable t) {
                call.reject("openTempFile failed: " + safeMsg(t), toException(t));
            }
        });
    }

    @PluginMethod
    public void appendFileChunk(PluginCall call) {
        String filePath = call.getString("filePath", "");
        String base64Chunk = call.getString("base64Chunk", "");
        String textContent = call.getString("textContent");
        if (filePath.isEmpty()) {
            call.reject("Missing filePath");
            return;
        }
        ioExecutor.execute(() -> {
            try {
                File target = validateAppOwnedPath(filePath);
                byte[] bytes;
                if (textContent != null) {
                    bytes = textContent.getBytes(StandardCharsets.UTF_8);
                } else if (!base64Chunk.isEmpty()) {
                    bytes = Base64.decode(base64Chunk, Base64.DEFAULT);
                } else {
                    bytes = new byte[0];
                }
                try (FileOutputStream fos = new FileOutputStream(target, true)) {
                    if (bytes.length > 0) {
                        fos.write(bytes);
                    }
                    fos.flush();
                }
                JSObject res = new JSObject();
                res.put("success", true);
                res.put("bytesWritten", bytes.length);
                res.put("totalSize", target.length());
                call.resolve(res);
            } catch (Throwable t) {
                call.reject("appendFileChunk failed: " + safeMsg(t), toException(t));
            }
        });
    }

    @PluginMethod
    public void prepareOutputPath(PluginCall call) {
        String baseName = call.getString("fileName", "video_export");
        String format = call.getString("format", "mp4").toLowerCase(Locale.US);
        ioExecutor.execute(() -> {
            try {
                File outDir = new File(getContext().getCacheDir(), "ffmpeg_outputs");
                if (!outDir.exists()) outDir.mkdirs();
                cleanupOldFiles(outDir, 2L * 3600L * 1000L);
                String safeBase = sanitizeFileName(baseName.replaceAll("\\.[^.]+$", ""));
                String safeExt = format.replaceAll("[^a-z0-9]", "");
                if (safeExt.isEmpty()) safeExt = "mp4";
                String fullName = safeBase + "_" + (System.currentTimeMillis() % 100000) + "." + safeExt;
                File outFile = new File(outDir, fullName);
                if (outFile.exists()) outFile.delete();
                JSObject res = new JSObject();
                res.put("success", true);
                res.put("filePath", outFile.getAbsolutePath());
                res.put("fileName", fullName);
                call.resolve(res);
            } catch (Throwable t) {
                call.reject("prepareOutputPath failed: " + safeMsg(t), toException(t));
            }
        });
    }

    @PluginMethod
    public void saveToPublicDownloads(PluginCall call) {
        String filePath = call.getString("filePath", "");
        String requestedName = call.getString("fileName", "");
        String mimeType = call.getString("mimeType", "");
        boolean deleteSource = Boolean.TRUE.equals(call.getBoolean("deleteSource", false));

        if (filePath.isEmpty()) {
            call.reject("Thiếu đường dẫn file nguồn để lưu vào Download.");
            return;
        }

        ioExecutor.execute(() -> {
            try {
                File src = new File(filePath);
                if (!src.exists() || src.length() == 0) {
                    throw new Exception("Tệp xuất không tồn tại hoặc có kích thước 0 byte.");
                }

                String finalName = sanitizeFileName(requestedName.isEmpty() ? src.getName() : requestedName);
                String resolvedMime = (mimeType != null && !mimeType.trim().isEmpty())
                        ? mimeType.trim()
                        : guessMimeType(finalName);

                String savedPath = writeToMediaStoreDownloads(src, finalName, resolvedMime);
                double sizeMB = Math.round((src.length() / (1024.0 * 1024.0)) * 100.0) / 100.0;

                if (deleteSource) {
                    try { src.delete(); } catch (Exception ignored) {}
                }

                JSObject res = new JSObject();
                res.put("success", true);
                res.put("savedPath", savedPath);
                res.put("fileName", finalName);
                res.put("sizeMB", sizeMB);
                call.resolve(res);
            } catch (Throwable t) {
                Log.e(TAG, "saveToPublicDownloads failed", t);
                call.reject("Không thể lưu tệp vào thư mục Download: " + safeMsg(t), toException(t));
            }
        });
    }

    @PluginMethod
    public void deleteTempFile(PluginCall call) {
        String filePath = call.getString("filePath", "");
        ioExecutor.execute(() -> {
            try {
                if (!filePath.isEmpty()) {
                    File f = validateAppOwnedPath(filePath);
                    if (f.exists()) f.delete();
                }
                JSObject res = new JSObject();
                res.put("success", true);
                call.resolve(res);
            } catch (Throwable ignored) {
                JSObject res = new JSObject();
                res.put("success", false);
                call.resolve(res);
            }
        });
    }

    private File getTempExportDir() {
        File dir = new File(getContext().getCacheDir(), "ffmpeg_tmp");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private File validateAppOwnedPath(String rawPath) throws Exception {
        File target = new File(rawPath).getCanonicalFile();
        String cacheRoot = getContext().getCacheDir().getCanonicalPath();
        String filesRoot = getContext().getFilesDir().getCanonicalPath();
        String canon = target.getCanonicalPath();
        if (!canon.startsWith(cacheRoot) && !canon.startsWith(filesRoot)) {
            throw new SecurityException("Đường dẫn nằm ngoài thư mục ứng dụng.");
        }
        return target;
    }

    private String extractNativeFilePath(String rawUrl) {
        if (rawUrl == null || rawUrl.trim().isEmpty()) return null;
        String u = rawUrl.trim();
        if (u.startsWith("/")) {
            return u;
        }
        if (u.startsWith("file://")) {
            try {
                return URLDecoder.decode(u.substring("file://".length()), "UTF-8");
            } catch (Exception e) {
                return u.substring("file://".length());
            }
        }
        int idx = u.indexOf("/_capacitor_file_");
        if (idx >= 0) {
            String pathPart = u.substring(idx + "/_capacitor_file_".length());
            int qIdx = pathPart.indexOf('?');
            if (qIdx >= 0) pathPart = pathPart.substring(0, qIdx);
            try {
                return URLDecoder.decode(pathPart, "UTF-8");
            } catch (Exception e) {
                return pathPart;
            }
        }
        return null;
    }

    private String writeToMediaStoreDownloads(File srcFile, String fileName, String mimeType) throws Exception {
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
            values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/BachTranlastor");
            values.put(MediaStore.Downloads.IS_PENDING, 1);

            ContentResolver resolver = ctx.getContentResolver();
            Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri != null) {
                try (InputStream in = new FileInputStream(srcFile);
                     OutputStream out = resolver.openOutputStream(uri)) {
                    if (out != null) {
                        byte[] buf = new byte[65536];
                        int n;
                        while ((n = in.read(buf)) != -1) {
                            out.write(buf, 0, n);
                        }
                        out.flush();
                    }
                }
                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                resolver.update(uri, values, null, null);
                return "Download/BachTranlastor/" + fileName;
            }
        }

        File dlDir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "BachTranlastor");
        if (!dlDir.exists()) dlDir.mkdirs();
        File dst = new File(dlDir, fileName);
        try (InputStream in = new FileInputStream(srcFile);
             OutputStream out = new FileOutputStream(dst)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            out.flush();
        }
        return "Download/BachTranlastor/" + fileName;
    }

    private void cleanupOldFiles(File dir, long maxAgeMs) {
        File[] files = dir.listFiles();
        if (files == null) return;
        long cutoff = System.currentTimeMillis() - maxAgeMs;
        for (File f : files) {
            if (f.lastModified() < cutoff) {
                try { f.delete(); } catch (Exception ignored) {}
            }
        }
    }

    private String sanitizeFileName(String raw) {
        if (raw == null || raw.trim().isEmpty()) return "file_" + System.currentTimeMillis();
        String s = raw.trim().replaceAll("[\\\\/:*?\"<>|\\s]+", "_");
        if (s.length() > 96) {
            int dot = s.lastIndexOf('.');
            if (dot > 0 && s.length() - dot <= 10) {
                String ext = s.substring(dot);
                s = s.substring(0, 96 - ext.length()) + ext;
            } else {
                s = s.substring(0, 96);
            }
        }
        return s.isEmpty() ? "file" : s;
    }

    private String guessMimeType(String fileName) {
        String lower = fileName.toLowerCase(Locale.US);
        if (lower.endsWith(".mp4")) return "video/mp4";
        if (lower.endsWith(".webm")) return "video/webm";
        if (lower.endsWith(".mov")) return "video/quicktime";
        if (lower.endsWith(".mkv")) return "video/x-matroska";
        if (lower.endsWith(".zip")) return "application/zip";
        if (lower.endsWith(".srt")) return "application/x-subrip";
        if (lower.endsWith(".ass") || lower.endsWith(".vtt") || lower.endsWith(".txt")) return "text/plain";
        if (lower.endsWith(".wav")) return "audio/wav";
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        return "application/octet-stream";
    }

    private String safeMsg(Throwable t) {
        if (t == null) return "Lỗi không xác định";
        String m = t.getMessage();
        return (m != null && !m.trim().isEmpty()) ? m : t.getClass().getSimpleName();
    }

    private Exception toException(Throwable t) {
        return (t instanceof Exception) ? (Exception) t : new Exception(safeMsg(t), t);
    }
}
