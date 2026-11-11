package com.bachduong.remixvideo;

import android.app.Dialog;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.json.JSONArray;
import org.json.JSONObject;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "GeminiWebView")
public class GeminiWebViewPlugin extends Plugin {

    private Dialog loginDialog;
    private WebView loginWebView;
    private PluginCall activeCall;
    private boolean isHandled = false;

    private static final String GEMINI_APP_URL = "https://gemini.google.com/app";

    @PluginMethod
    public void checkGeminiSession(PluginCall call) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                String cookies = CookieManager.getInstance().getCookie("https://gemini.google.com");
                boolean hasAuth = cookies != null && (
                    cookies.contains("__Secure-1PSID") ||
                    cookies.contains("__Secure-3PSID") ||
                    cookies.contains("SID")
                );

                JSObject ret = new JSObject();
                ret.put("cookies", cookies != null ? cookies : "");
                ret.put("hasAuth", hasAuth);
                ret.put("success", true);
                call.resolve(ret);
            } catch (Exception e) {
                JSObject ret = new JSObject();
                ret.put("cookies", "");
                ret.put("hasAuth", false);
                ret.put("success", false);
                ret.put("error", e.getMessage());
                call.resolve(ret);
            }
        });
    }

    @PluginMethod
    public void fetchGeminiSession(PluginCall call) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                String cookies = CookieManager.getInstance().getCookie("https://gemini.google.com");
                boolean hasAuth = cookies != null && (
                    cookies.contains("__Secure-1PSID") ||
                    cookies.contains("__Secure-3PSID") ||
                    cookies.contains("SID")
                );

                if (hasAuth) {
                    JSObject ret = new JSObject();
                    ret.put("cookies", cookies);
                    ret.put("currentUrl", GEMINI_APP_URL);
                    ret.put("success", true);
                    call.resolve(ret);
                } else {
                    // Tự động mở cửa sổ đăng nhập Google/Gemini Web để người dùng đăng nhập ngay
                    openGeminiLogin(call);
                }
            } catch (Exception e) {
                JSObject ret = new JSObject();
                ret.put("cookies", "");
                ret.put("currentUrl", "");
                ret.put("success", false);
                ret.put("error", e.getMessage());
                call.resolve(ret);
            }
        });
    }

    @PluginMethod
    public void openGeminiLogin(PluginCall call) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                if (getActivity() == null || getActivity().isFinishing()) {
                    call.reject("Activity is not available");
                    return;
                }

                if (loginDialog != null && loginDialog.isShowing()) {
                    loginDialog.dismiss();
                }

                activeCall = call;
                isHandled = false;

                showLoginModal();
            } catch (Exception e) {
                call.reject("Lỗi khi mở giao diện đăng nhập: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void executeGeminiPrompt(PluginCall call) {
        String prompt = call.getString("prompt", "");
        if (prompt == null || prompt.trim().isEmpty()) {
            call.reject("Prompt cannot be empty");
            return;
        }

        String passedCookies = call.getString("cookies", "");
        String passedSnlm0e = call.getString("snlm0e", "");

        new Thread(() -> {
            try {
                String cookies = (passedCookies != null && !passedCookies.trim().isEmpty())
                    ? passedCookies.trim()
                    : CookieManager.getInstance().getCookie("https://gemini.google.com");

                if (cookies == null || (!cookies.contains("__Secure-1PSID") && !cookies.contains("SID"))) {
                    JSObject ret = new JSObject();
                    ret.put("success", false);
                    ret.put("error", "Chưa có Cookie Google (__Secure-1PSID). Vui lòng đăng nhập lại qua WebView.");
                    call.resolve(ret);
                    return;
                }

                String snlm0e = (passedSnlm0e != null && !passedSnlm0e.trim().isEmpty() && !passedSnlm0e.startsWith("token_"))
                    ? passedSnlm0e.trim()
                    : "";

                if (snlm0e.isEmpty()) {
                    snlm0e = extractSnlm0eFromWeb(cookies);
                }

                if (snlm0e.isEmpty()) {
                    JSObject ret = new JSObject();
                    ret.put("success", false);
                    ret.put("error", "Không thể trích xuất mã định danh SNlM0e từ trang Gemini. Vui lòng đăng nhập lại.");
                    call.resolve(ret);
                    return;
                }

                JSONArray promptInner = new JSONArray();
                JSONArray promptDetails = new JSONArray();
                promptDetails.put(prompt);
                promptDetails.put(0);
                promptDetails.put(JSONObject.NULL);
                promptDetails.put(JSONObject.NULL);
                promptDetails.put(JSONObject.NULL);
                promptDetails.put(JSONObject.NULL);
                promptDetails.put(0);

                JSONArray langArr = new JSONArray();
                langArr.put("vi");

                JSONArray dummyArr = new JSONArray();
                dummyArr.put("");
                dummyArr.put("");
                dummyArr.put("");

                JSONArray flagArr = new JSONArray();
                flagArr.put(1);

                promptInner.put(promptDetails);
                promptInner.put(langArr);
                promptInner.put(dummyArr);
                promptInner.put(JSONObject.NULL);
                promptInner.put(JSONObject.NULL);
                promptInner.put(JSONObject.NULL);
                promptInner.put(flagArr);

                JSONArray reqPayload = new JSONArray();
                reqPayload.put(JSONObject.NULL);
                reqPayload.put(promptInner.toString());

                String fReq = reqPayload.toString();
                String reqId = String.valueOf((int) (100000 + Math.random() * 900000));
                String targetUrl = "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=boq_assistant-bard-web-server_20240305.08_p0&_reqid=" + reqId + "&rt=c";

                URL url = new URL(targetUrl);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(30000);
                conn.setReadTimeout(45000);
                conn.setDoOutput(true);
                conn.setDoInput(true);

                conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36");
                conn.setRequestProperty("Cookie", cookies);
                conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8");
                conn.setRequestProperty("Origin", "https://gemini.google.com");
                conn.setRequestProperty("Referer", "https://gemini.google.com/");
                conn.setRequestProperty("X-Same-Domain", "1");

                String body = "f.req=" + URLEncoder.encode(fReq, "UTF-8") + "&at=" + URLEncoder.encode(snlm0e, "UTF-8");

                try (OutputStream os = conn.getOutputStream()) {
                    byte[] input = body.getBytes(StandardCharsets.UTF_8);
                    os.write(input, 0, input.length);
                }

                int respCode = conn.getResponseCode();
                if (respCode >= 200 && respCode < 300) {
                    StringBuilder response = new StringBuilder();
                    try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                        String line;
                        while ((line = br.readLine()) != null) {
                            response.append(line).append("\n");
                        }
                    }

                    String raw = response.toString();
                    String text = parseStreamResponse(raw);

                    if (text == null || text.trim().isEmpty()) {
                        Pattern p = Pattern.compile("\\\\n\\\\n([^\\\\]+)\\\\n");
                        Matcher m = p.matcher(raw);
                        String lastMatch = "";
                        while (m.find()) {
                            lastMatch = m.group(1);
                        }
                        if (lastMatch != null && lastMatch.length() > 5) {
                            text = lastMatch.replace("\\n", "\n").trim();
                        }
                    }

                    if (text != null && !text.trim().isEmpty()) {
                        JSObject ret = new JSObject();
                        ret.put("success", true);
                        ret.put("text", text);
                        ret.put("snlm0e", snlm0e);
                        call.resolve(ret);
                    } else {
                        JSObject ret = new JSObject();
                        ret.put("success", false);
                        ret.put("error", "Không thể phân tích phản hồi từ Gemini Web.");
                        call.resolve(ret);
                    }
                } else {
                    JSObject ret = new JSObject();
                    ret.put("success", false);
                    ret.put("error", "Google Gemini Web RPC phản hồi mã lỗi HTTP " + respCode);
                    call.resolve(ret);
                }
            } catch (Exception e) {
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", "Lỗi gửi prompt tới Gemini Web: " + e.getMessage());
                call.resolve(ret);
            }
        }).start();
    }

    private String extractSnlm0eFromWeb(String cookies) {
        try {
            URL url = new URL(GEMINI_APP_URL);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36");
            conn.setRequestProperty("Cookie", cookies);
            conn.setRequestProperty("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");

            int code = conn.getResponseCode();
            if (code == 200) {
                StringBuilder html = new StringBuilder();
                try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = br.readLine()) != null) {
                        html.append(line).append("\n");
                    }
                }
                String page = html.toString();
                Pattern p1 = Pattern.compile("\"SNlM0e\"\\s*:\\s*\"([^\"]+)\"");
                Matcher m1 = p1.matcher(page);
                if (m1.find()) {
                    return m1.group(1);
                }
                Pattern p2 = Pattern.compile("\\[\"SNlM0e\"\\s*,\\s*\"([^\"]+)\"\\]");
                Matcher m2 = p2.matcher(page);
                if (m2.find()) {
                    return m2.group(1);
                }
            }
        } catch (Exception ignored) {}
        return "";
    }

    private String parseStreamResponse(String responseText) {
        if (responseText == null || responseText.isEmpty()) return "";
        String[] lines = responseText.split("\n");
        String result = "";

        for (String line : lines) {
            String trimmed = line.trim();
            if (trimmed.isEmpty() || trimmed.startsWith(")]}'")) continue;
            try {
                JSONArray parsed = new JSONArray(trimmed);
                for (int i = 0; i < parsed.length(); i++) {
                    Object itemObj = parsed.get(i);
                    if (itemObj instanceof JSONArray) {
                        JSONArray item = (JSONArray) itemObj;
                        if (item.length() >= 3 && "wrb.fr".equals(item.optString(0))) {
                            String dataStr = item.optString(2);
                            if (!dataStr.isEmpty()) {
                                try {
                                    JSONArray subData = new JSONArray(dataStr);
                                    if (subData.length() > 4) {
                                        JSONArray candidateList = subData.optJSONArray(4);
                                        if (candidateList != null && candidateList.length() > 0) {
                                            JSONArray cand0 = candidateList.optJSONArray(0);
                                            if (cand0 != null && cand0.length() > 1) {
                                                JSONArray textParts = cand0.optJSONArray(1);
                                                if (textParts != null && textParts.length() > 0) {
                                                    String t = textParts.optString(0);
                                                    if (t != null && !t.isEmpty()) {
                                                        result = t;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                } catch (Exception ignored) {}
                            }
                        }
                    }
                }
            } catch (Exception ignored) {}
        }
        return result.trim();
    }

    @PluginMethod
    public void clearGeminiSession(PluginCall call) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                CookieManager cookieManager = CookieManager.getInstance();
                cookieManager.removeAllCookies(null);
                cookieManager.flush();

                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("message", "Đã xóa toàn bộ cookie Google/Gemini");
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Lỗi khi xóa session: " + e.getMessage());
            }
        });
    }

    private void showLoginModal() {
        if (getActivity() == null) return;

        loginDialog = new Dialog(getActivity(), android.R.style.Theme_Black_NoTitleBar_Fullscreen);
        loginDialog.requestWindowFeature(Window.FEATURE_NO_TITLE);

        // Main Container
        LinearLayout rootLayout = new LinearLayout(getContext());
        rootLayout.setOrientation(LinearLayout.VERTICAL);
        rootLayout.setBackgroundColor(Color.parseColor("#0E0E12"));
        rootLayout.setLayoutParams(new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        // Top Header Bar
        LinearLayout headerBar = new LinearLayout(getContext());
        headerBar.setOrientation(LinearLayout.HORIZONTAL);
        headerBar.setGravity(Gravity.CENTER_VERTICAL);
        headerBar.setBackgroundColor(Color.parseColor("#181820"));
        int padPx = (int) (12 * getContext().getResources().getDisplayMetrics().density);
        headerBar.setPadding(padPx, padPx, padPx, padPx);

        // Header Title Layout
        LinearLayout titleBox = new LinearLayout(getContext());
        titleBox.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f);
        titleBox.setLayoutParams(titleParams);

        TextView titleText = new TextView(getContext());
        titleText.setText("Đăng Nhập Google / Gemini Web");
        titleText.setTextColor(Color.parseColor("#F8FAFC"));
        titleText.setTextSize(14.0f);
        titleText.setTypeface(null, android.graphics.Typeface.BOLD);

        TextView subtitleText = new TextView(getContext());
        subtitleText.setText("Đăng nhập tài khoản Google để dịch phụ đề 0đ Quota");
        subtitleText.setTextColor(Color.parseColor("#94A3B8"));
        subtitleText.setTextSize(11.0f);

        titleBox.addView(titleText);
        titleBox.addView(subtitleText);
        headerBar.addView(titleBox);

        // Reload Button
        Button reloadBtn = new Button(getContext());
        reloadBtn.setText("↻ Tải lại");
        reloadBtn.setTextColor(Color.parseColor("#E2E8F0"));
        reloadBtn.setTextSize(11.0f);
        reloadBtn.setBackgroundColor(Color.parseColor("#272732"));
        int btnPad = (int) (6 * getContext().getResources().getDisplayMetrics().density);
        reloadBtn.setPadding(btnPad * 2, btnPad, btnPad * 2, btnPad);
        LinearLayout.LayoutParams reloadParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        reloadParams.setMargins(0, 0, btnPad, 0);
        reloadBtn.setLayoutParams(reloadParams);
        headerBar.addView(reloadBtn);

        // Close Button
        Button closeBtn = new Button(getContext());
        closeBtn.setText("✕ Đóng");
        closeBtn.setTextColor(Color.parseColor("#FCA5A5"));
        closeBtn.setTextSize(11.0f);
        closeBtn.setBackgroundColor(Color.parseColor("#3F1D1D"));
        closeBtn.setPadding(btnPad * 2, btnPad, btnPad * 2, btnPad);
        headerBar.addView(closeBtn);

        rootLayout.addView(headerBar);

        // Progress Bar
        ProgressBar progressBar = new ProgressBar(getContext(), null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setLayoutParams(new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            (int) (4 * getContext().getResources().getDisplayMetrics().density)
        ));
        progressBar.setMax(100);
        progressBar.setProgress(0);
        rootLayout.addView(progressBar);

        // WebView Frame
        FrameLayout webFrame = new FrameLayout(getContext());
        webFrame.setLayoutParams(new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1.0f
        ));

        loginWebView = new WebView(getContext());
        loginWebView.setLayoutParams(new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        WebSettings settings = loginWebView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // Set clean Chrome UserAgent to prevent Google OAuth blocking
        String defaultUa = settings.getUserAgentString();
        String cleanUa = (defaultUa != null ? defaultUa.replace("; wv", "") : "");
        if (!cleanUa.contains("Chrome/")) {
            cleanUa = "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
        }
        settings.setUserAgentString(cleanUa);

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cookieManager.setAcceptThirdPartyCookies(loginWebView, true);
        }

        reloadBtn.setOnClickListener(v -> {
            if (loginWebView != null) {
                loginWebView.reload();
            }
        });

        closeBtn.setOnClickListener(v -> {
            if (loginDialog != null && loginDialog.isShowing()) {
                loginDialog.dismiss();
            }
        });

        loginWebView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (progressBar != null) {
                    progressBar.setProgress(newProgress);
                    if (newProgress >= 100) {
                        progressBar.setVisibility(View.GONE);
                    } else {
                        progressBar.setVisibility(View.VISIBLE);
                    }
                }
            }
        });

        loginWebView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                checkAndCaptureSession(url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false;
            }
        });

        webFrame.addView(loginWebView);
        rootLayout.addView(webFrame);

        loginDialog.setContentView(rootLayout);
        loginDialog.setOnDismissListener(dialog -> {
            if (!isHandled && activeCall != null) {
                String cookies = CookieManager.getInstance().getCookie("https://gemini.google.com");
                boolean hasAuth = cookies != null && (
                    cookies.contains("__Secure-1PSID") ||
                    cookies.contains("__Secure-3PSID") ||
                    cookies.contains("SID")
                );

                if (hasAuth) {
                    JSObject ret = new JSObject();
                    ret.put("cookies", cookies);
                    ret.put("currentUrl", GEMINI_APP_URL);
                    ret.put("success", true);
                    activeCall.resolve(ret);
                } else {
                    JSObject ret = new JSObject();
                    ret.put("cookies", "");
                    ret.put("success", false);
                    ret.put("cancelled", true);
                    ret.put("message", "Đã đóng cửa sổ đăng nhập mà chưa hoàn tất.");
                    activeCall.resolve(ret);
                }
                activeCall = null;
            }
        });

        loginDialog.show();
        loginWebView.loadUrl(GEMINI_APP_URL);
    }

    private void checkAndCaptureSession(String currentUrl) {
        if (isHandled || activeCall == null) return;

        try {
            String cookies = CookieManager.getInstance().getCookie("https://gemini.google.com");
            boolean hasAuth = cookies != null && (
                cookies.contains("__Secure-1PSID") ||
                cookies.contains("__Secure-3PSID") ||
                cookies.contains("SID")
            );

            // Kiểm tra xem đã hoàn tất đăng nhập và vào được trang gemini.google.com chưa
            if (hasAuth && currentUrl != null && currentUrl.contains("gemini.google.com") && !currentUrl.contains("accounts.google.com")) {
                isHandled = true;

                // Trích xuất SNlM0e nếu có
                if (loginWebView != null) {
                    loginWebView.evaluateJavascript(
                        "(function() { try { return (window.WIZ_global_data && window.WIZ_global_data.SNlM0e) ? window.WIZ_global_data.SNlM0e : ''; } catch(e) { return ''; } })()",
                        value -> {
                            String snlm0e = "";
                            if (value != null && !value.equals("null") && !value.equals("\"\"")) {
                                snlm0e = value.replace("\"", "").trim();
                            }

                            CookieManager.getInstance().flush();

                            if (getContext() != null) {
                                Toast.makeText(getContext(), "✓ Kết nối Gemini Web thành công!", Toast.LENGTH_SHORT).show();
                            }

                            JSObject ret = new JSObject();
                            ret.put("cookies", cookies);
                            ret.put("snlm0e", snlm0e);
                            ret.put("currentUrl", currentUrl);
                            ret.put("success", true);

                            if (activeCall != null) {
                                activeCall.resolve(ret);
                                activeCall = null;
                            }

                            if (loginDialog != null && loginDialog.isShowing()) {
                                loginDialog.dismiss();
                            }
                        }
                    );
                } else {
                    CookieManager.getInstance().flush();
                    JSObject ret = new JSObject();
                    ret.put("cookies", cookies);
                    ret.put("currentUrl", currentUrl);
                    ret.put("success", true);
                    activeCall.resolve(ret);
                    activeCall = null;

                    if (loginDialog != null && loginDialog.isShowing()) {
                        loginDialog.dismiss();
                    }
                }
            }
        } catch (Exception e) {
            // Tiếp tục chờ đăng nhập
        }
    }
}
