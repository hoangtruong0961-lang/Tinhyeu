package com.bachduong.remixvideo;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;

import com.arthenica.ffmpegkit.FFmpegKit;
import com.arthenica.ffmpegkit.FFmpegSession;
import com.arthenica.ffmpegkit.ReturnCode;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.yausername.aria2c.Aria2c;
import com.yausername.youtubedl_android.YoutubeDL;
import com.yausername.youtubedl_android.YoutubeDLRequest;
import com.yausername.youtubedl_android.YoutubeDLResponse;

import org.json.JSONArray;
import org.json.JSONObject;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import java.io.BufferedInputStream;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicLong;
import java.util.zip.GZIPInputStream;
import java.util.zip.Inflater;
import java.util.zip.InflaterInputStream;

import javax.xml.parsers.DocumentBuilderFactory;

@CapacitorPlugin(name = "YoutubeDLNative")
public class YoutubeDLPlugin extends Plugin {

    private static final String TAG = "YoutubeDLNative";
    private static final String DEFAULT_MOBILE_UA =
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
    private static final String DEFAULT_DESKTOP_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private volatile boolean isInitialized = false;
    private volatile boolean aria2cReady = false;

    private synchronized void ensureInitialized() throws Exception {
        if (isInitialized) return;
        Context appCtx = getContext().getApplicationContext();
        YoutubeDL.getInstance().init(appCtx);
        try {
            Aria2c.getInstance().init(appCtx);
            aria2cReady = true;
        } catch (Throwable t) {
            Log.w(TAG, "Aria2c init warning (continuing with native HttpURLConnection): " + t.getMessage());
            aria2cReady = false;
        }
        isInitialized = true;
    }

    @PluginMethod
    public void checkStatus(PluginCall call) {
        boolean autoInit = Boolean.TRUE.equals(call.getBoolean("autoInit", false));
        executor.execute(() -> {
            try {
                Context appCtx = getContext().getApplicationContext();
                if (autoInit && !isInitialized) {
                    ensureInitialized();
                }
                String ver = null;
                try {
                    ver = YoutubeDL.getInstance().versionName(appCtx);
                    if (ver == null || ver.trim().isEmpty()) {
                        ver = YoutubeDL.getInstance().version(appCtx);
                    }
                } catch (Throwable ignored) {}

                JSObject res = new JSObject();
                res.put("success", true);
                res.put("platform", "android");
                res.put("isInitialized", isInitialized);
                res.put("aria2cReady", aria2cReady);
                res.put("ytdlpVersion", ver != null ? ver : "Bundled 0.18.1");
                call.resolve(res);
            } catch (Throwable t) {
                Log.e(TAG, "checkStatus error", t);
                call.reject("Không thể kiểm tra yt-dlp native: " + safeMsg(t), toException(t));
            }
        });
    }

    @PluginMethod
    public void initEngine(PluginCall call) {
        executor.execute(() -> {
            try {
                ensureInitialized();
                Context appCtx = getContext().getApplicationContext();
                String ver = YoutubeDL.getInstance().versionName(appCtx);
                if (ver == null || ver.trim().isEmpty()) {
                    ver = YoutubeDL.getInstance().version(appCtx);
                }
                JSObject res = new JSObject();
                res.put("success", true);
                res.put("isInitialized", true);
                res.put("aria2cReady", aria2cReady);
                res.put("ytdlpVersion", ver != null ? ver : "Bundled 0.18.1");
                call.resolve(res);
            } catch (Throwable t) {
                Log.e(TAG, "initEngine failed", t);
                call.reject("Lỗi khởi tạo yt-dlp Android: " + safeMsg(t), toException(t));
            }
        });
    }

    @PluginMethod
    public void updateYoutubeDL(PluginCall call) {
        String channelStr = call.getString("channel", "stable");
        executor.execute(() -> {
            try {
                emitProgress("updating", 15, "Đang khởi tạo trình cập nhật yt-dlp...");
                ensureInitialized();
                Context appCtx = getContext().getApplicationContext();

                YoutubeDL.UpdateChannel channel = YoutubeDL.UpdateChannel._STABLE;
                if ("nightly".equalsIgnoreCase(channelStr)) {
                    channel = YoutubeDL.UpdateChannel._NIGHTLY;
                } else if ("master".equalsIgnoreCase(channelStr)) {
                    channel = YoutubeDL.UpdateChannel._MASTER;
                }

                emitProgress("updating", 55, "Đang kiểm tra & tải bản yt-dlp mới nhất từ GitHub...");
                YoutubeDL.UpdateStatus status = YoutubeDL.getInstance().updateYoutubeDL(appCtx, channel);
                String ver = YoutubeDL.getInstance().versionName(appCtx);
                if (ver == null || ver.trim().isEmpty()) {
                    ver = YoutubeDL.getInstance().version(appCtx);
                }

                boolean updated = (status == YoutubeDL.UpdateStatus.DONE);
                String msg = updated
                        ? ("Đã cập nhật nhân yt-dlp mới nhất: " + (ver != null ? ver : "Latest"))
                        : ("Nhân yt-dlp đang ở phiên bản mới nhất (" + (ver != null ? ver : "Latest") + ")");
                emitProgress("completed", 100, msg);

                JSObject res = new JSObject();
                res.put("success", true);
                res.put("status", status != null ? status.name() : "DONE");
                res.put("updated", updated);
                res.put("ytdlpVersion", ver != null ? ver : "Latest");
                res.put("message", msg);
                call.resolve(res);
            } catch (Throwable t) {
                Log.e(TAG, "updateYoutubeDL failed", t);
                String msg = "Không thể cập nhật yt-dlp: " + safeMsg(t);
                emitProgress("error", 0, msg);
                call.reject(msg, toException(t));
            }
        });
    }

    @PluginMethod
    public void extractVideo(PluginCall call) {
        String rawUrl = call.getString("url", "").trim();
        if (rawUrl.isEmpty()) {
            call.reject("Vui lòng nhập đường dẫn (URL) video hợp lệ.");
            return;
        }
        String customCookies = call.getString("cookies", "");
        String customUserAgent = call.getString("userAgent", "");
        String customReferer = call.getString("referer", "");

        executor.execute(() -> {
            File tempCookieFile = null;
            try {
                emitProgress("extracting", 10, "Đang khởi động nhân yt-dlp trên điện thoại...");
                ensureInitialized();

                String targetUrl = resolveRedirectUrl(rawUrl);
                boolean isBilibili = targetUrl.contains("bilibili.com") || targetUrl.contains("b23.tv");
                boolean isDouyin = targetUrl.contains("douyin.com") || targetUrl.contains("iesdouyin.com") || targetUrl.contains("snssdk.com");
                boolean isTikTok = targetUrl.contains("tiktok.com");

                emitProgress("extracting", 35, "Đang phân tích luồng video 4K/1080p, audio & phụ đề...");

                YoutubeDLRequest request = new YoutubeDLRequest(targetUrl);
                request.addOption("--dump-json");
                request.addOption("--no-playlist");
                request.addOption("--no-warnings");
                request.addOption("--no-check-certificates");
                request.addOption("--write-subs");
                request.addOption("--write-auto-subs");
                request.addOption("--sub-langs", "all");
                request.addOption("--sub-format", "srt/vtt/json/best");

                if (customUserAgent != null && !customUserAgent.trim().isEmpty()) {
                    request.addOption("--user-agent", customUserAgent.trim());
                } else if (isBilibili) {
                    request.addOption("--user-agent", DEFAULT_DESKTOP_UA);
                } else if (isDouyin) {
                    request.addOption("--user-agent", DEFAULT_MOBILE_UA);
                }

                if (customReferer != null && !customReferer.trim().isEmpty()) {
                    request.addOption("--referer", customReferer.trim());
                } else if (isBilibili) {
                    request.addOption("--referer", "https://www.bilibili.com/");
                } else if (isDouyin) {
                    request.addOption("--referer", "https://www.douyin.com/");
                }

                if (customCookies != null && !customCookies.trim().isEmpty()) {
                    String trimmed = customCookies.trim();
                    if (trimmed.contains("\t") || trimmed.startsWith("# Netscape")) {
                        tempCookieFile = new File(getContext().getCacheDir(), "ytdlp_cookie_" + System.currentTimeMillis() + ".txt");
                        try (FileOutputStream fos = new FileOutputStream(tempCookieFile)) {
                            fos.write(trimmed.getBytes(StandardCharsets.UTF_8));
                        }
                        request.addOption("--cookies", tempCookieFile.getAbsolutePath());
                    } else {
                        request.addOption("--add-header", "Cookie:" + trimmed);
                    }
                }

                JSONObject data = null;
                String ytDlpErr = null;
                try {
                    YoutubeDLResponse dlRes = YoutubeDL.getInstance().execute(request);
                    String stdout = dlRes.getOut();
                    if (stdout != null && !stdout.trim().isEmpty()) {
                        String jsonStr = extractJsonLine(stdout);
                        if (jsonStr != null) {
                            data = new JSONObject(jsonStr);
                        }
                    }
                    if (data == null) {
                        ytDlpErr = dlRes.getErr();
                    }
                } catch (Throwable ytErr) {
                    ytDlpErr = safeMsg(ytErr);
                    Log.w(TAG, "Native yt-dlp execution warning for " + targetUrl + ": " + ytDlpErr);
                }

                // TikTok lightweight fallback if yt-dlp blocked by IP/challenge
                if (data == null && isTikTok) {
                    JSObject tikFallback = tryTikTokFallback(targetUrl);
                    if (tikFallback != null) {
                        emitProgress("completed", 100, "Đã bóc tách xong video TikTok!");
                        call.resolve(tikFallback);
                        return;
                    }
                }

                if (data == null) {
                    throw new Exception(
                        (ytDlpErr != null && !ytDlpErr.trim().isEmpty())
                            ? "yt-dlp không thể bóc tách video: " + cleanErrorTail(ytDlpErr)
                            : "yt-dlp không trả về dữ liệu định dạng cho liên kết này."
                    );
                }

                emitProgress("extracting", 85, "Đang tổng hợp các độ phân giải & phụ đề...");
                JSObject formatted = formatDumpJsonToResponse(data, targetUrl);
                emitProgress("completed", 100, "Bóc tách thành công!");
                call.resolve(formatted);
            } catch (Throwable t) {
                Log.e(TAG, "extractVideo error", t);
                String msg = safeMsg(t);
                emitProgress("error", 0, msg);
                call.reject(msg, toException(t));
            } finally {
                if (tempCookieFile != null && tempCookieFile.exists()) {
                    try { tempCookieFile.delete(); } catch (Exception ignored) {}
                }
            }
        });
    }

    @PluginMethod
    public void downloadMedia(PluginCall call) {
        String pageUrl = call.getString("pageUrl", "").trim();
        String videoUrl = call.getString("videoUrl", "").trim();
        String audioUrl = call.getString("audioUrl", "").trim();
        String title = call.getString("title", "video");
        String quality = call.getString("quality", "HD");
        String ext = call.getString("extension", "mp4");
        boolean isAudioOnly = Boolean.TRUE.equals(call.getBoolean("isAudioOnly", false));
        boolean hasAudio = Boolean.TRUE.equals(call.getBoolean("hasAudio", false));
        boolean saveToDownloads = Boolean.TRUE.equals(call.getBoolean("saveToDownloads", true));
        JSObject videoHeadersObj = call.getObject("httpHeaders");
        JSObject audioHeadersObj = call.getObject("audioHeaders");

        if (videoUrl.isEmpty() && pageUrl.isEmpty()) {
            call.reject("Thiếu đường dẫn luồng tải video/audio.");
            return;
        }

        executor.execute(() -> {
            File tempVideo = null;
            File tempAudio = null;
            try {
                File workDir = new File(getContext().getFilesDir(), "ytdlp_downloads");
                if (!workDir.exists()) workDir.mkdirs();
                cleanupOldWorkFiles(workDir, 6);

                String baseName = sanitizeFileName(title) + "_" + sanitizeFileName(quality);
                String finalExt = isAudioOnly ? (ext.isEmpty() ? "m4a" : ext) : "mp4";
                String finalFileName = baseName + "_" + (System.currentTimeMillis() % 100000) + "." + finalExt;
                File finalLocalFile = new File(workDir, finalFileName);

                Map<String, String> vHeaders = jsonToHeaderMap(videoHeadersObj, pageUrl);
                Map<String, String> aHeaders = jsonToHeaderMap(audioHeadersObj != null ? audioHeadersObj : videoHeadersObj, pageUrl);

                // Case 1: HLS (.m3u8) stream -> remux directly with FFmpegKit (or yt-dlp aria2c fallback)
                if (videoUrl.contains(".m3u8")) {
                    emitProgress("downloading", 20, "Đang tải & ghép luồng HLS (.m3u8)...");
                    boolean hlsOk = downloadHlsWithFFmpeg(videoUrl, vHeaders, finalLocalFile);
                    if (!hlsOk && !pageUrl.isEmpty()) {
                        ensureInitialized();
                        YoutubeDLRequest req = new YoutubeDLRequest(pageUrl);
                        req.addOption("-o", finalLocalFile.getAbsolutePath());
                        req.addOption("--no-playlist");
                        req.addOption("--no-check-certificates");
                        if (aria2cReady) {
                            req.addOption("--downloader", "libaria2c.so");
                        }
                        YoutubeDL.getInstance().execute(req);
                    }
                    if (!finalLocalFile.exists() || finalLocalFile.length() == 0) {
                        throw new Exception("Không thể tải hoàn chỉnh luồng HLS (.m3u8).");
                    }
                } else {
                    // Case 2: Standard / DASH streams -> parallel download via HttpURLConnection + FFmpegKit -c copy mux
                    boolean needSeparateAudio = !isAudioOnly && !hasAudio && !audioUrl.isEmpty() && !audioUrl.equals(videoUrl);

                    String vTempExt = isAudioOnly ? (ext.isEmpty() ? "m4a" : ext) : (ext.isEmpty() ? "mp4" : ext);
                    tempVideo = new File(getContext().getCacheDir(), "dl_v_" + System.currentTimeMillis() + "." + vTempExt);
                    if (needSeparateAudio) {
                        tempAudio = new File(getContext().getCacheDir(), "dl_a_" + System.currentTimeMillis() + ".m4a");
                    }

                    emitProgress("downloading", 5,
                            needSeparateAudio
                                    ? "Đang tải song song luồng Video & Audio..."
                                    : "Đang tải dữ liệu media trực tiếp...");

                    final AtomicLong vDone = new AtomicLong(0);
                    final AtomicLong vTotal = new AtomicLong(0);
                    final AtomicLong aDone = new AtomicLong(0);
                    final AtomicLong aTotal = new AtomicLong(0);
                    final long[] lastEmit = new long[]{0L};

                    final File fTempV = tempVideo;
                    final File fTempA = tempAudio;

                    Runnable progressUpdater = () -> {
                        long now = System.currentTimeMillis();
                        if (now - lastEmit[0] < 250) return;
                        lastEmit[0] = now;
                        long done = vDone.get() + aDone.get();
                        long total = vTotal.get() + aTotal.get();
                        int pct = (total > 0)
                                ? Math.min(88, Math.max(5, (int) ((done * 85L) / total) + 3))
                                : 35;
                        double doneMB = done / (1024.0 * 1024.0);
                        String msg = total > 0
                                ? String.format(Locale.US, "Đang tải: %.1f / %.1f MB (%d%%)", doneMB, total / (1024.0 * 1024.0), pct)
                                : String.format(Locale.US, "Đang tải: %.1f MB...", doneMB);
                        emitProgress("downloading", pct, msg);
                    };

                    if (needSeparateAudio) {
                        ExecutorService dlPool = Executors.newFixedThreadPool(2);
                        try {
                            Callable<Void> videoTask = () -> {
                                downloadFileHttp(videoUrl, vHeaders, fTempV, vDone, vTotal, progressUpdater);
                                return null;
                            };
                            Callable<Void> audioTask = () -> {
                                downloadFileHttp(audioUrl, aHeaders, fTempA, aDone, aTotal, progressUpdater);
                                return null;
                            };
                            Future<Void> vf = dlPool.submit(videoTask);
                            Future<Void> af = dlPool.submit(audioTask);
                            vf.get();
                            af.get();
                        } finally {
                            dlPool.shutdownNow();
                        }

                        emitProgress("merging", 90, "Đang ghép Video + Audio bằng FFmpegKit (-c copy)...");
                        muxVideoAndAudioSafely(tempVideo, tempAudio, finalLocalFile);
                    } else {
                        downloadFileHttp(videoUrl, vHeaders, tempVideo, vDone, vTotal, progressUpdater);
                        emitProgress("merging", 92, "Đang hoàn tất tệp media...");
                        if (!tempVideo.renameTo(finalLocalFile)) {
                            copyFile(tempVideo, finalLocalFile);
                        }
                    }
                }

                if (!finalLocalFile.exists() || finalLocalFile.length() == 0) {
                    throw new Exception("Tệp xuất ra trống sau khi tải/ghép.");
                }

                String publicSavedPath = null;
                if (saveToDownloads) {
                    emitProgress("saving", 96, "Đang lưu vào thư mục Download/BachTranlastor...");
                    publicSavedPath = exportToPublicDownloads(finalLocalFile, finalFileName, guessMimeType(finalExt, isAudioOnly));
                }

                double sizeMB = Math.round((finalLocalFile.length() / (1024.0 * 1024.0)) * 10.0) / 10.0;
                emitProgress("completed", 100, "Tải & xử lý hoàn tất (" + sizeMB + " MB)!");

                JSObject res = new JSObject();
                res.put("success", true);
                res.put("filePath", finalLocalFile.getAbsolutePath());
                res.put("fileName", finalFileName);
                res.put("sizeMB", sizeMB);
                res.put("savedPath", publicSavedPath != null ? publicSavedPath : finalLocalFile.getAbsolutePath());
                call.resolve(res);
            } catch (Throwable t) {
                Log.e(TAG, "downloadMedia error", t);
                String msg = "Lỗi tải media trên Android: " + safeMsg(t);
                emitProgress("error", 0, msg);
                call.reject(msg, toException(t));
            } finally {
                if (tempVideo != null && tempVideo.exists()) {
                    try { tempVideo.delete(); } catch (Exception ignored) {}
                }
                if (tempAudio != null && tempAudio.exists()) {
                    try { tempAudio.delete(); } catch (Exception ignored) {}
                }
            }
        });
    }

    @PluginMethod
    public void downloadSubtitle(PluginCall call) {
        String subUrl = call.getString("subUrl", "").trim();
        String lang = call.getString("lang", "sub");
        String ext = call.getString("ext", "vtt").toLowerCase(Locale.US);
        String type = call.getString("type", "official");
        String title = call.getString("title", "subtitle");
        boolean saveToDownloads = Boolean.TRUE.equals(call.getBoolean("saveToDownloads", true));
        JSObject headersObj = call.getObject("httpHeaders");

        if (subUrl.isEmpty()) {
            call.reject("Thiếu URL phụ đề.");
            return;
        }

        executor.execute(() -> {
            File tempSub = null;
            try {
                Map<String, String> headers = jsonToHeaderMap(headersObj, subUrl);
                byte[] rawBytes = fetchBytesHttp(subUrl, headers);
                String rawText = new String(rawBytes, StandardCharsets.UTF_8);

                String srtContent;
                if ("danmaku".equalsIgnoreCase(type) || ext.contains("xml") || rawText.trim().startsWith("<")) {
                    srtContent = convertBilibiliXmlToSrt(rawText);
                } else if (ext.contains("json") || rawText.trim().startsWith("{")) {
                    srtContent = convertJsonSubtitleToSrt(rawText);
                } else if (rawText.contains("WEBVTT")) {
                    srtContent = convertVttToSrt(rawText);
                } else {
                    srtContent = rawText;
                }

                String fileName = sanitizeFileName(title) + "_" + sanitizeFileName(lang) + ".srt";
                tempSub = new File(getContext().getCacheDir(), fileName);
                try (FileOutputStream fos = new FileOutputStream(tempSub)) {
                    fos.write(srtContent.getBytes(StandardCharsets.UTF_8));
                }

                String savedPath = null;
                if (saveToDownloads) {
                    savedPath = exportToPublicDownloads(tempSub, fileName, "application/x-subrip");
                }

                JSObject res = new JSObject();
                res.put("success", true);
                res.put("fileName", fileName);
                res.put("savedPath", savedPath != null ? savedPath : tempSub.getAbsolutePath());
                res.put("srtContent", srtContent);
                call.resolve(res);
            } catch (Throwable t) {
                Log.e(TAG, "downloadSubtitle failed", t);
                call.reject("Lỗi tải phụ đề: " + safeMsg(t), toException(t));
            } finally {
                if (tempSub != null && tempSub.exists()) {
                    try { tempSub.delete(); } catch (Exception ignored) {}
                }
            }
        });
    }

    // =========================================================================
    // DUMP-JSON -> APP RESPONSE MAPPER
    // =========================================================================

    private JSObject formatDumpJsonToResponse(JSONObject data, String pageUrl) throws Exception {
        JSONArray formatsRaw = data.optJSONArray("formats");
        if (formatsRaw == null) formatsRaw = new JSONArray();

        JSONObject globalHeaders = data.optJSONObject("http_headers");
        List<JSONObject> formatList = new ArrayList<>();
        for (int i = 0; i < formatsRaw.length(); i++) {
            JSONObject f = formatsRaw.optJSONObject(i);
            if (f != null && !f.optString("url", "").isEmpty()) {
                formatList.add(f);
            }
        }

        // Find best audio streams (prefer m4a/aac for lossless -c copy MP4 muxing)
        List<JSONObject> audioCandidates = new ArrayList<>();
        for (JSONObject f : formatList) {
            String vcodec = f.optString("vcodec", "none");
            String acodec = f.optString("acodec", "none");
            if (("none".equals(vcodec) || vcodec.isEmpty()) && !"none".equals(acodec) && !acodec.isEmpty()) {
                audioCandidates.add(f);
            }
        }
        Collections.sort(audioCandidates, (a, b) -> {
            int abrCmp = Double.compare(b.optDouble("abr", 0), a.optDouble("abr", 0));
            return abrCmp;
        });

        JSONObject preferredM4aAudio = null;
        JSONObject bestAnyAudio = audioCandidates.isEmpty() ? null : audioCandidates.get(0);
        for (JSONObject a : audioCandidates) {
            String ext = a.optString("ext", "");
            if ("m4a".equalsIgnoreCase(ext) || "mp4".equalsIgnoreCase(ext) || a.optString("acodec", "").contains("mp4a")) {
                preferredM4aAudio = a;
                break;
            }
        }
        JSONObject chosenAudio = preferredM4aAudio != null ? preferredM4aAudio : bestAnyAudio;
        String chosenAudioUrl = chosenAudio != null ? chosenAudio.optString("url", "") : "";
        JSONObject chosenAudioHeaders = chosenAudio != null
                ? mergeHeaders(globalHeaders, chosenAudio.optJSONObject("http_headers"))
                : toJSObject(globalHeaders);

        // Sort video candidates descending by height, preferring mp4 & muxed streams when equal height
        List<JSONObject> videoCandidates = new ArrayList<>();
        for (JSONObject f : formatList) {
            String vcodec = f.optString("vcodec", "none");
            if (!"none".equals(vcodec) && !vcodec.isEmpty()) {
                videoCandidates.add(f);
            }
        }
        Collections.sort(videoCandidates, (a, b) -> {
            int hCmp = Integer.compare(b.optInt("height", 0), a.optInt("height", 0));
            if (hCmp != 0) return hCmp;
            boolean aHasAudio = !"none".equals(a.optString("acodec", "none")) && !a.optString("acodec", "").isEmpty();
            boolean bHasAudio = !"none".equals(b.optString("acodec", "none")) && !b.optString("acodec", "").isEmpty();
            if (aHasAudio != bHasAudio) return bHasAudio ? 1 : -1;
            boolean aMp4 = "mp4".equalsIgnoreCase(a.optString("ext", ""));
            boolean bMp4 = "mp4".equalsIgnoreCase(b.optString("ext", ""));
            if (aMp4 != bMp4) return bMp4 ? 1 : -1;
            return Double.compare(b.optDouble("tbr", 0), a.optDouble("tbr", 0));
        });

        JSArray medias = new JSArray();
        Set<String> seenKeys = new HashSet<>();

        for (JSONObject f : videoCandidates) {
            int height = f.optInt("height", 0);
            String ext = f.optString("ext", "mp4");
            String acodec = f.optString("acodec", "none");
            boolean hasAudio = !"none".equals(acodec) && !acodec.isEmpty();

            String label = (height > 0) ? (height + "p") : "Video";
            if (height >= 2160) label = "4K (2160p)";
            else if (height >= 1440) label = "2K (1440p)";
            else if (height >= 1080) label = "Full HD (1080p)";
            else if (height >= 720) label = "HD (720p)";
            else if (height >= 480) label = "SD (480p)";
            else if (height >= 360) label = "360p";

            String key = label + "_" + ext;
            if (!seenKeys.contains(key)) {
                seenKeys.add(key);
                long bytes = f.optLong("filesize", 0);
                if (bytes <= 0) bytes = f.optLong("filesize_approx", 0);

                JSObject m = new JSObject();
                m.put("quality", label);
                m.put("extension", ext);
                m.put("url", f.optString("url"));
                m.put("directUrl", f.optString("url"));
                m.put("size", formatBytes(bytes));
                m.put("isAudioOnly", false);
                m.put("hasAudio", hasAudio);
                if (!hasAudio && !chosenAudioUrl.isEmpty()) {
                    m.put("audioUrl", chosenAudioUrl);
                    m.put("audioHeaders", chosenAudioHeaders);
                }
                m.put("resolution", f.optString("resolution", height > 0 ? (f.optInt("width", 0) + "x" + height) : ""));
                if (f.has("fps")) m.put("fps", f.optInt("fps"));
                m.put("formatId", f.optString("format_id", ""));
                m.put("httpHeaders", mergeHeaders(globalHeaders, f.optJSONObject("http_headers")));
                medias.put(m);
            }
        }

        // Top 3 audio tracks
        int audioCount = 0;
        for (JSONObject f : audioCandidates) {
            if (audioCount >= 3) break;
            long abr = Math.round(f.optDouble("abr", 128));
            String rawExt = f.optString("ext", "m4a");
            String ext = "webm".equalsIgnoreCase(rawExt) ? "opus" : rawExt;
            String key = "audio_" + ext + "_" + abr;
            if (!seenKeys.contains(key)) {
                seenKeys.add(key);
                audioCount++;
                long bytes = f.optLong("filesize", 0);
                if (bytes <= 0) bytes = f.optLong("filesize_approx", 0);

                JSObject m = new JSObject();
                m.put("quality", "Audio " + ext.toUpperCase(Locale.US) + " (" + abr + " kbps)");
                m.put("extension", ext);
                m.put("url", f.optString("url"));
                m.put("directUrl", f.optString("url"));
                m.put("size", formatBytes(bytes));
                m.put("isAudioOnly", true);
                m.put("hasAudio", true);
                m.put("formatId", f.optString("format_id", ""));
                m.put("httpHeaders", mergeHeaders(globalHeaders, f.optJSONObject("http_headers")));
                medias.put(m);
            }
        }

        // Single URL fallback (e.g. direct MP4 extractors or requested_formats)
        if (medias.length() == 0) {
            String primaryUrl = data.optString("url", "");
            if (primaryUrl.isEmpty()) {
                JSONArray reqFmts = data.optJSONArray("requested_formats");
                if (reqFmts != null && reqFmts.length() > 0) {
                    primaryUrl = reqFmts.optJSONObject(0).optString("url", "");
                }
            }
            if (!primaryUrl.isEmpty()) {
                JSObject m = new JSObject();
                m.put("quality", "Video Chuẩn (MP4)");
                m.put("extension", data.optString("ext", "mp4"));
                m.put("url", primaryUrl);
                m.put("directUrl", primaryUrl);
                m.put("isAudioOnly", false);
                m.put("hasAudio", true);
                m.put("httpHeaders", toJSObject(globalHeaders));
                medias.put(m);
            }
        }

        // Subtitles + Auto Captions + Danmaku
        JSArray subtitles = new JSArray();
        Set<String> seenSubs = new HashSet<>();

        collectSubtitleTracks(data.optJSONObject("subtitles"), "official", false, seenSubs, subtitles, globalHeaders);
        collectSubtitleTracks(data.optJSONObject("automatic_captions"), "auto", true, seenSubs, subtitles, globalHeaders);
        collectSubtitleTracks(data.optJSONObject("danmaku"), "danmaku", false, seenSubs, subtitles, globalHeaders);

        // Add Bilibili Danmaku track automatically if cid present and no danmaku added yet
        String extractor = data.optString("extractor", "");
        if ((pageUrl.contains("bilibili.com") || extractor.toLowerCase(Locale.US).contains("bili")) && !seenSubs.contains("danmaku_danmaku")) {
            long cid = data.optLong("cid", 0);
            if (cid > 0) {
                JSObject d = new JSObject();
                d.put("lang", "danmaku");
                d.put("name", "Bình luận bay Danmaku (Bilibili XML)");
                d.put("url", "https://comment.bilibili.com/" + cid + ".xml");
                d.put("ext", "xml");
                d.put("type", "danmaku");
                d.put("isAuto", false);
                d.put("isDanmaku", true);
                d.put("httpHeaders", toJSObject(globalHeaders));
                subtitles.put(d);
            }
        }

        String title = data.optString("title", "");
        if (title.isEmpty()) title = data.optString("fulltitle", "Video Tải Qua yt-dlp Android");

        String thumb = data.optString("thumbnail", "");
        if (thumb.isEmpty()) {
            JSONArray thumbs = data.optJSONArray("thumbnails");
            if (thumbs != null && thumbs.length() > 0) {
                JSONObject last = thumbs.optJSONObject(thumbs.length() - 1);
                if (last != null) thumb = last.optString("url", "");
            }
        }

        double durSec = data.optDouble("duration", 0);
        long viewsNum = data.optLong("view_count", -1);
        String author = data.optString("uploader", "");
        if (author.isEmpty()) author = data.optString("channel", "");
        if (author.isEmpty()) author = data.optString("creator", "");

        JSObject out = new JSObject();
        out.put("success", true);
        out.put("title", title);
        out.put("thumbnail", thumb);
        out.put("duration", formatDuration((long) Math.round(durSec)));
        out.put("source", !extractor.isEmpty() ? extractor : data.optString("extractor_key", "yt-dlp Android"));
        if (!author.isEmpty()) out.put("author", author);
        if (viewsNum >= 0) out.put("views", String.format(Locale.US, "%,d lượt xem", viewsNum));
        out.put("medias", medias);
        out.put("subtitles", subtitles);
        out.put("httpHeaders", toJSObject(globalHeaders));
        return out;
    }

    private void collectSubtitleTracks(
            JSONObject subMap,
            String defaultType,
            boolean isAutoDefault,
            Set<String> seenSubs,
            JSArray outArr,
            JSONObject globalHeaders
    ) {
        if (subMap == null) return;
        Iterator<String> keys = subMap.keys();
        while (keys.hasNext() && outArr.length() < 35) {
            String lang = keys.next();
            JSONArray tracks = subMap.optJSONArray(lang);
            if (tracks == null || tracks.length() == 0) continue;

            boolean isDanmaku = "danmaku".equals(defaultType) || lang.toLowerCase(Locale.US).contains("danmaku");
            JSONObject chosen = null;
            for (int i = 0; i < tracks.length(); i++) {
                JSONObject t = tracks.optJSONObject(i);
                if (t == null || t.optString("url", "").isEmpty()) continue;
                String tExt = t.optString("ext", "").toLowerCase(Locale.US);
                if ("srt".equals(tExt) || "vtt".equals(tExt) || "json3".equals(tExt) || "json".equals(tExt)) {
                    chosen = t;
                    break;
                }
                if (chosen == null) chosen = t;
            }
            if (chosen == null) continue;

            String key = (isDanmaku ? "danmaku_" : defaultType + "_") + lang;
            if ("auto".equals(defaultType) && seenSubs.contains("official_" + lang)) continue;
            if (seenSubs.contains(key)) continue;
            seenSubs.add(key);

            String label = formatLangLabel(lang, chosen.optString("name", ""));
            String finalName = isDanmaku
                    ? (label + " (Đạn mạc)")
                    : (isAutoDefault ? (label + " (AI Tự động)") : (label + " (Phụ đề chuẩn)"));

            JSObject subObj = new JSObject();
            subObj.put("lang", lang);
            subObj.put("name", finalName);
            subObj.put("url", chosen.optString("url"));
            subObj.put("ext", chosen.optString("ext", isDanmaku ? "xml" : "vtt"));
            subObj.put("type", isDanmaku ? "danmaku" : defaultType);
            subObj.put("isAuto", isAutoDefault);
            subObj.put("isDanmaku", isDanmaku);
            subObj.put("httpHeaders", toJSObject(globalHeaders));
            outArr.put(subObj);
        }
    }

    // =========================================================================
    // PARALLEL HTTP DOWNLOAD + FFMPEGKIT MUX (-c copy) + ANDROID MEDIAMUXER FALLBACK
    // =========================================================================

    private void downloadFileHttp(
            String rawUrl,
            Map<String, String> headers,
            File destination,
            AtomicLong doneCounter,
            AtomicLong totalCounter,
            Runnable progressCallback
    ) throws Exception {
        HttpURLConnection conn = openConnectionWithRedirects(rawUrl, headers, 6);
        try {
            int code = conn.getResponseCode();
            if (code >= 400) {
                throw new Exception("HTTP " + code + " khi tải luồng media.");
            }
            long len = conn.getContentLengthLong();
            if (len > 0) totalCounter.addAndGet(len);

            try (InputStream in = new BufferedInputStream(conn.getInputStream());
                 FileOutputStream out = new FileOutputStream(destination)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) != -1) {
                    out.write(buf, 0, n);
                    doneCounter.addAndGet(n);
                    progressCallback.run();
                }
                out.flush();
            }
        } finally {
            conn.disconnect();
        }
    }

    private void muxVideoAndAudioSafely(File videoFile, File audioFile, File outputFile) throws Exception {
        // 1. Try FFmpegKit -c copy (zero re-encoding, near-instant mux)
        try {
            String cmdCopy = String.format(
                    Locale.US,
                    "-y -i \"%s\" -i \"%s\" -c copy -movflags +faststart \"%s\"",
                    videoFile.getAbsolutePath(), audioFile.getAbsolutePath(), outputFile.getAbsolutePath()
            );
            FFmpegSession session = FFmpegKit.execute(cmdCopy);
            if (ReturnCode.isSuccess(session.getReturnCode()) && outputFile.exists() && outputFile.length() > 1024) {
                return;
            }
            // Retry converting incompatible audio stream (e.g. opus/webm audio into mp4) while keeping video lossless
            String cmdReencodeAudio = String.format(
                    Locale.US,
                    "-y -i \"%s\" -i \"%s\" -c:v copy -c:a aac -b:a 192k -movflags +faststart \"%s\"",
                    videoFile.getAbsolutePath(), audioFile.getAbsolutePath(), outputFile.getAbsolutePath()
            );
            FFmpegSession retry = FFmpegKit.execute(cmdReencodeAudio);
            if (ReturnCode.isSuccess(retry.getReturnCode()) && outputFile.exists() && outputFile.length() > 1024) {
                return;
            }
            Log.w(TAG, "FFmpegKit mux failed with code " + (retry.getReturnCode() != null ? retry.getReturnCode().getValue() : -1) + ", trying Android MediaMuxer fallback...");
        } catch (Throwable ffErr) {
            Log.w(TAG, "FFmpegKit unavailable/threw Throwable during mux (" + ffErr.getMessage() + "), using Android MediaMuxer fallback...");
        }

        // 2. Built-in Android MediaExtractor + MediaMuxer fallback (zero external .so, -c copy lossless)
        muxWithAndroidMediaMuxer(videoFile, audioFile, outputFile);
    }

    private boolean downloadHlsWithFFmpeg(String m3u8Url, Map<String, String> headers, File outFile) {
        try {
            StringBuilder hdrBuilder = new StringBuilder();
            for (Map.Entry<String, String> e : headers.entrySet()) {
                hdrBuilder.append(e.getKey()).append(": ").append(e.getValue()).append("\r\n");
            }
            String hdrArg = hdrBuilder.length() > 0 ? ("-headers \"" + hdrBuilder.toString().replace("\"", "\\\"") + "\" ") : "";
            String cmd = String.format(
                    Locale.US,
                    "-y %s-i \"%s\" -c copy -bsf:a aac_adtstoasc -movflags +faststart \"%s\"",
                    hdrArg, m3u8Url, outFile.getAbsolutePath()
            );
            FFmpegSession session = FFmpegKit.execute(cmd);
            return ReturnCode.isSuccess(session.getReturnCode()) && outFile.exists() && outFile.length() > 1024;
        } catch (Throwable t) {
            Log.w(TAG, "FFmpegKit HLS download failed: " + t.getMessage());
            return false;
        }
    }

    private void muxWithAndroidMediaMuxer(File videoFile, File audioFile, File outputFile) throws Exception {
        MediaExtractor vExtractor = new MediaExtractor();
        MediaExtractor aExtractor = new MediaExtractor();
        MediaMuxer muxer = null;
        try {
            vExtractor.setDataSource(videoFile.getAbsolutePath());
            aExtractor.setDataSource(audioFile.getAbsolutePath());

            int vTrackIdx = -1;
            MediaFormat vFmt = null;
            for (int i = 0; i < vExtractor.getTrackCount(); i++) {
                MediaFormat fmt = vExtractor.getTrackFormat(i);
                String mime = fmt.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("video/")) {
                    vTrackIdx = i;
                    vFmt = fmt;
                    break;
                }
            }

            int aTrackIdx = -1;
            MediaFormat aFmt = null;
            for (int i = 0; i < aExtractor.getTrackCount(); i++) {
                MediaFormat fmt = aExtractor.getTrackFormat(i);
                String mime = fmt.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) {
                    aTrackIdx = i;
                    aFmt = fmt;
                    break;
                }
            }

            if (vTrackIdx < 0 || vFmt == null) {
                throw new Exception("Không tìm thấy track video để ghép MP4.");
            }

            muxer = new MediaMuxer(outputFile.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            int muxVideoTrack = muxer.addTrack(vFmt);
            int muxAudioTrack = (aTrackIdx >= 0 && aFmt != null) ? muxer.addTrack(aFmt) : -1;
            muxer.start();

            ByteBuffer buffer = ByteBuffer.allocate(1024 * 1024);
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();

            vExtractor.selectTrack(vTrackIdx);
            while (true) {
                int sampleSize = vExtractor.readSampleData(buffer, 0);
                if (sampleSize < 0) break;
                info.offset = 0;
                info.size = sampleSize;
                info.presentationTimeUs = Math.max(0L, vExtractor.getSampleTime());
                info.flags = vExtractor.getSampleFlags();
                muxer.writeSampleData(muxVideoTrack, buffer, info);
                vExtractor.advance();
            }

            if (muxAudioTrack >= 0) {
                aExtractor.selectTrack(aTrackIdx);
                while (true) {
                    int sampleSize = aExtractor.readSampleData(buffer, 0);
                    if (sampleSize < 0) break;
                    info.offset = 0;
                    info.size = sampleSize;
                    info.presentationTimeUs = Math.max(0L, aExtractor.getSampleTime());
                    info.flags = aExtractor.getSampleFlags();
                    muxer.writeSampleData(muxAudioTrack, buffer, info);
                    aExtractor.advance();
                }
            }

            muxer.stop();
        } finally {
            if (muxer != null) {
                try { muxer.release(); } catch (Exception ignored) {}
            }
            try { vExtractor.release(); } catch (Exception ignored) {}
            try { aExtractor.release(); } catch (Exception ignored) {}
        }
    }

    // =========================================================================
    // SUBTITLE & TIKTOK & NETWORK HELPERS
    // =========================================================================

    private JSObject tryTikTokFallback(String targetUrl) {
        try {
            String api = "https://www.tikwm.com/api/?url=" + URLEncoder.encode(targetUrl, "UTF-8");
            Map<String, String> headers = new HashMap<>();
            headers.put("User-Agent", DEFAULT_DESKTOP_UA);
            byte[] raw = fetchBytesHttp(api, headers);
            JSONObject tik = new JSONObject(new String(raw, StandardCharsets.UTF_8));
            if (tik.optInt("code", -1) != 0) return null;
            JSONObject d = tik.optJSONObject("data");
            if (d == null) return null;

            String play = d.optString("play", "");
            if (play.isEmpty()) return null;
            if (!play.startsWith("http")) play = "https://www.tikwm.com" + play;
            String music = d.optString("music", "");
            if (!music.isEmpty() && !music.startsWith("http")) music = "https://www.tikwm.com" + music;

            JSArray medias = new JSArray();
            JSObject vm = new JSObject();
            vm.put("quality", "HD No Watermark (MP4)");
            vm.put("extension", "mp4");
            vm.put("url", play);
            vm.put("directUrl", play);
            vm.put("isAudioOnly", false);
            vm.put("hasAudio", true);
            medias.put(vm);

            if (!music.isEmpty()) {
                JSObject am = new JSObject();
                am.put("quality", "Audio Nhạc Nền (MP3)");
                am.put("extension", "mp3");
                am.put("url", music);
                am.put("directUrl", music);
                am.put("isAudioOnly", true);
                am.put("hasAudio", true);
                medias.put(am);
            }

            JSObject out = new JSObject();
            out.put("success", true);
            out.put("title", d.optString("title", "Video TikTok"));
            out.put("thumbnail", d.optString("cover", ""));
            out.put("duration", formatDuration(d.optLong("duration", 0)));
            out.put("source", "TikTok");
            JSONObject authorObj = d.optJSONObject("author");
            if (authorObj != null) out.put("author", authorObj.optString("nickname", ""));
            out.put("medias", medias);
            out.put("subtitles", new JSArray());
            return out;
        } catch (Throwable ignored) {
            return null;
        }
    }

    private String resolveRedirectUrl(String rawUrl) {
        if (!(rawUrl.contains("b23.tv") || rawUrl.contains("v.douyin.com")
                || rawUrl.contains("vm.tiktok.com") || rawUrl.contains("vt.tiktok.com")
                || rawUrl.contains("fb.watch"))) {
            return rawUrl;
        }
        try {
            Map<String, String> headers = new HashMap<>();
            headers.put("User-Agent", DEFAULT_MOBILE_UA);
            HttpURLConnection conn = openConnectionWithRedirects(rawUrl, headers, 5);
            String resolved = conn.getURL().toString();
            conn.disconnect();
            return (resolved != null && !resolved.isEmpty()) ? resolved : rawUrl;
        } catch (Throwable ignored) {
            return rawUrl;
        }
    }

    private HttpURLConnection openConnectionWithRedirects(String rawUrl, Map<String, String> headers, int maxRedirects) throws Exception {
        String current = rawUrl;
        for (int i = 0; i <= maxRedirects; i++) {
            HttpURLConnection conn = (HttpURLConnection) new URL(current).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(30000);
            for (Map.Entry<String, String> e : headers.entrySet()) {
                if (e.getKey() != null && e.getValue() != null && !e.getValue().isEmpty()) {
                    conn.setRequestProperty(e.getKey(), e.getValue());
                }
            }
            if (!headers.containsKey("User-Agent")) {
                conn.setRequestProperty("User-Agent", DEFAULT_DESKTOP_UA);
            }
            conn.connect();
            int code = conn.getResponseCode();
            if (code == HttpURLConnection.HTTP_MOVED_TEMP
                    || code == HttpURLConnection.HTTP_MOVED_PERM
                    || code == HttpURLConnection.HTTP_SEE_OTHER
                    || code == 307 || code == 308) {
                String loc = conn.getHeaderField("Location");
                if (loc == null || loc.isEmpty()) return conn;
                conn.disconnect();
                URL next = new URL(new URL(current), loc);
                current = next.toString();
                continue;
            }
            return conn;
        }
        throw new Exception("Quá nhiều lần chuyển hướng HTTP.");
    }

    private byte[] fetchBytesHttp(String url, Map<String, String> headers) throws Exception {
        HttpURLConnection conn = openConnectionWithRedirects(url, headers, 5);
        try {
            int code = conn.getResponseCode();
            if (code >= 400) throw new Exception("HTTP " + code);
            InputStream rawStream = conn.getInputStream();
            String enc = conn.getContentEncoding();
            if (enc != null) {
                if (enc.toLowerCase(Locale.US).contains("gzip")) {
                    rawStream = new GZIPInputStream(rawStream);
                } else if (enc.toLowerCase(Locale.US).contains("deflate")) {
                    rawStream = new InflaterInputStream(rawStream, new Inflater(true));
                }
            }
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = rawStream.read(buf)) != -1) {
                baos.write(buf, 0, n);
            }
            return baos.toByteArray();
        } finally {
            conn.disconnect();
        }
    }

    private String exportToPublicDownloads(File srcFile, String fileName, String mimeType) throws Exception {
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
        copyFile(srcFile, dst);
        return dst.getAbsolutePath();
    }

    private void copyFile(File src, File dst) throws Exception {
        try (InputStream in = new FileInputStream(src);
             OutputStream out = new FileOutputStream(dst)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            out.flush();
        }
    }

    private void cleanupOldWorkFiles(File dir, int keepLatest) {
        File[] files = dir.listFiles();
        if (files == null || files.length <= keepLatest) return;
        java.util.Arrays.sort(files, Comparator.comparingLong(File::lastModified));
        int toDelete = files.length - keepLatest;
        for (int i = 0; i < toDelete; i++) {
            try { files[i].delete(); } catch (Exception ignored) {}
        }
    }

    private Map<String, String> jsonToHeaderMap(JSObject obj, String pageUrl) {
        Map<String, String> map = new HashMap<>();
        if (obj != null) {
            Iterator<String> keys = obj.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                String v = obj.optString(k, "");
                if (!v.isEmpty()) map.put(k, v);
            }
        }
        if (!map.containsKey("Referer") && pageUrl != null && !pageUrl.isEmpty()) {
            if (pageUrl.contains("bilibili.com")) map.put("Referer", "https://www.bilibili.com/");
            else if (pageUrl.contains("douyin.com")) map.put("Referer", "https://www.douyin.com/");
        }
        if (!map.containsKey("User-Agent")) {
            map.put("User-Agent", DEFAULT_DESKTOP_UA);
        }
        return map;
    }

    private JSObject mergeHeaders(JSONObject base, JSONObject override) {
        JSObject res = toJSObject(base);
        if (override != null) {
            Iterator<String> keys = override.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                res.put(k, override.optString(k, ""));
            }
        }
        return res;
    }

    private JSObject toJSObject(JSONObject src) {
        JSObject dst = new JSObject();
        if (src == null) return dst;
        Iterator<String> keys = src.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            dst.put(k, src.optString(k, ""));
        }
        return dst;
    }

    private String convertVttToSrt(String vtt) {
        String clean = vtt.replace("\r\n", "\n").replaceFirst("(?s)^WEBVTT.*?\\n\\n", "");
        String[] blocks = clean.split("\\n{2,}");
        StringBuilder sb = new StringBuilder();
        int idx = 1;
        for (String b : blocks) {
            String[] lines = b.trim().split("\\n");
            if (lines.length == 0) continue;
            int timeLine = -1;
            for (int i = 0; i < lines.length; i++) {
                if (lines[i].contains("-->")) {
                    timeLine = i;
                    break;
                }
            }
            if (timeLine < 0) continue;
            String ts = lines[timeLine].replace('.', ',').replaceAll("\\s+align:.*$", "").replaceAll("\\s+position:.*$", "");
            StringBuilder text = new StringBuilder();
            for (int i = timeLine + 1; i < lines.length; i++) {
                String cleanLine = lines[i].replaceAll("<[^>]+>", "").trim();
                if (!cleanLine.isEmpty()) {
                    if (text.length() > 0) text.append("\n");
                    text.append(cleanLine);
                }
            }
            if (text.length() > 0) {
                sb.append(idx++).append("\n").append(ts).append("\n").append(text).append("\n\n");
            }
        }
        return sb.length() > 0 ? sb.toString() : vtt;
    }

    private String convertJsonSubtitleToSrt(String rawJson) {
        try {
            JSONObject obj = new JSONObject(rawJson);
            JSONArray body = obj.optJSONArray("body");
            if (body != null) {
                StringBuilder sb = new StringBuilder();
                int idx = 1;
                for (int i = 0; i < body.length(); i++) {
                    JSONObject item = body.optJSONObject(i);
                    if (item == null) continue;
                    double from = item.optDouble("from", 0);
                    double to = item.optDouble("to", from + 2.0);
                    String txt = item.optString("content", "").trim();
                    if (!txt.isEmpty()) {
                        sb.append(idx++).append("\n")
                          .append(formatSrtTimeMs((long) (from * 1000))).append(" --> ")
                          .append(formatSrtTimeMs((long) (to * 1000))).append("\n")
                          .append(txt).append("\n\n");
                    }
                }
                return sb.toString();
            }
            JSONArray events = obj.optJSONArray("events");
            if (events != null) {
                StringBuilder sb = new StringBuilder();
                int idx = 1;
                for (int i = 0; i < events.length(); i++) {
                    JSONObject ev = events.optJSONObject(i);
                    if (ev == null) continue;
                    JSONArray segs = ev.optJSONArray("segs");
                    if (segs == null) continue;
                    StringBuilder txt = new StringBuilder();
                    for (int s = 0; s < segs.length(); s++) {
                        JSONObject seg = segs.optJSONObject(s);
                        if (seg != null) txt.append(seg.optString("utf8", ""));
                    }
                    String clean = txt.toString().trim();
                    if (clean.isEmpty()) continue;
                    long startMs = ev.optLong("tStartMs", 0);
                    long durMs = ev.optLong("dDurationMs", 2500);
                    sb.append(idx++).append("\n")
                      .append(formatSrtTimeMs(startMs)).append(" --> ")
                      .append(formatSrtTimeMs(startMs + Math.max(500, durMs))).append("\n")
                      .append(clean).append("\n\n");
                }
                return sb.toString();
            }
        } catch (Throwable ignored) {}
        return rawJson;
    }

    private String convertBilibiliXmlToSrt(String xml) {
        try {
            Document doc = DocumentBuilderFactory.newInstance().newDocumentBuilder()
                    .parse(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)));
            NodeList nodes = doc.getElementsByTagName("d");
            List<long[]> times = new ArrayList<>();
            List<String> texts = new ArrayList<>();
            for (int i = 0; i < nodes.getLength(); i++) {
                Element el = (Element) nodes.item(i);
                String p = el.getAttribute("p");
                String txt = el.getTextContent() != null ? el.getTextContent().trim() : "";
                if (p.isEmpty() || txt.isEmpty()) continue;
                String[] parts = p.split(",");
                double sec = Double.parseDouble(parts[0]);
                long startMs = (long) (sec * 1000);
                times.add(new long[]{startMs, startMs + 3500, i});
                texts.add(txt);
            }
            Collections.sort(times, Comparator.comparingLong(a -> a[0]));
            StringBuilder sb = new StringBuilder();
            int idx = 1;
            for (long[] t : times) {
                sb.append(idx++).append("\n")
                  .append(formatSrtTimeMs(t[0])).append(" --> ")
                  .append(formatSrtTimeMs(t[1])).append("\n")
                  .append(texts.get((int) t[2])).append("\n\n");
            }
            return sb.length() > 0 ? sb.toString() : xml;
        } catch (Throwable ignored) {
            return xml;
        }
    }

    private String formatSrtTimeMs(long ms) {
        if (ms < 0) ms = 0;
        long h = ms / 3600000;
        long m = (ms % 3600000) / 60000;
        long s = (ms % 60000) / 1000;
        long rem = ms % 1000;
        return String.format(Locale.US, "%02d:%02d:%02d,%03d", h, m, s, rem);
    }

    private String extractJsonLine(String stdout) {
        String trimmed = stdout.trim();
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
        String[] lines = trimmed.split("\\r?\\n");
        for (int i = lines.length - 1; i >= 0; i--) {
            String l = lines[i].trim();
            if (l.startsWith("{") && l.endsWith("}")) return l;
        }
        return null;
    }

    private String formatLangLabel(String code, String rawName) {
        String c = code.toLowerCase(Locale.US);
        if (c.startsWith("zh-hans") || "zh-cn".equals(c) || "zh_cn".equals(c) || "ai-zh".equals(c)) return "Tiếng Trung (Giản thể)";
        if (c.startsWith("zh-hant") || "zh-tw".equals(c) || "zh-hk".equals(c)) return "Tiếng Trung (Phồn thể)";
        if (c.startsWith("zh")) return "Tiếng Trung";
        if (c.startsWith("vi")) return "Tiếng Việt";
        if (c.startsWith("en")) return "Tiếng Anh (English)";
        if (c.startsWith("ja")) return "Tiếng Nhật (Japanese)";
        if (c.startsWith("ko")) return "Tiếng Hàn (Korean)";
        if (c.startsWith("fr")) return "Tiếng Pháp (French)";
        if (c.startsWith("es")) return "Tiếng Tây Ban Nha (Spanish)";
        if (c.startsWith("th")) return "Tiếng Thái (Thai)";
        return (rawName != null && !rawName.isEmpty()) ? rawName : code;
    }

    private String formatBytes(long bytes) {
        if (bytes <= 0) return "";
        double mb = bytes / (1024.0 * 1024.0);
        if (mb >= 1024.0) return String.format(Locale.US, "%.2f GB", mb / 1024.0);
        if (mb >= 1.0) return String.format(Locale.US, "%.1f MB", mb);
        return String.format(Locale.US, "%d KB", Math.max(1, bytes / 1024));
    }

    private String formatDuration(long sec) {
        if (sec <= 0) return "";
        long h = sec / 3600;
        long m = (sec % 3600) / 60;
        long s = sec % 60;
        if (h > 0) return String.format(Locale.US, "%d:%02d:%02d", h, m, s);
        return String.format(Locale.US, "%02d:%02d", m, s);
    }

    private String sanitizeFileName(String raw) {
        if (raw == null || raw.trim().isEmpty()) return "video";
        String s = raw.trim().replaceAll("[\\\\/:*?\"<>|\\s]+", "_");
        if (s.length() > 48) s = s.substring(0, 48);
        return s.isEmpty() ? "video" : s;
    }

    private String cleanErrorTail(String s) {
        if (s == null) return "";
        String trimmed = s.trim();
        if (trimmed.length() > 260) {
            return trimmed.substring(trimmed.length() - 260);
        }
        return trimmed;
    }

    private String safeMsg(Throwable t) {
        if (t == null) return "Lỗi không xác định";
        String m = t.getMessage();
        return (m != null && !m.trim().isEmpty()) ? m : t.getClass().getSimpleName();
    }

    private String guessMimeType(String ext, boolean isAudioOnly) {
        String e = (ext == null) ? "" : ext.toLowerCase(Locale.US);
        if ("mp3".equals(e)) return "audio/mpeg";
        if ("opus".equals(e) || "ogg".equals(e)) return "audio/ogg";
        if ("wav".equals(e)) return "audio/wav";
        if ("m4a".equals(e) || "aac".equals(e)) return "audio/mp4";
        if ("webm".equals(e)) return isAudioOnly ? "audio/webm" : "video/webm";
        if ("mkv".equals(e)) return "video/x-matroska";
        return isAudioOnly ? "audio/mp4" : "video/mp4";
    }

    private Exception toException(Throwable t) {
        return (t instanceof Exception) ? (Exception) t : new Exception(safeMsg(t), t);
    }

    private void emitProgress(String status, int percent, String message) {
        JSObject data = new JSObject();
        data.put("status", status);
        data.put("percent", percent);
        data.put("message", message);
        notifyListeners("youtubedl_download_progress", data);
    }
}
