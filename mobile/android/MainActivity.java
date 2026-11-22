package app.leafreader.mobile;

import android.app.Activity;
import android.app.Dialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.icu.text.Transliterator;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String ENTRY = "https://" + ASSET_HOST + "/index.html";
    private static final int PICK_BOOK = 4;
    private static final String TAG = "LeafReader";
    private static final int PAPER = Color.rgb(245, 239, 222);
    private FrameLayout frame;
    private WebView reader;
    private ValueCallback<Uri[]> fileSelection;
    private Dialog webSearchDialog;
    private boolean softwareLayer;
    private boolean resumed;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        frame = new FrameLayout(this);
        frame.setBackgroundColor(PAPER);
        setContentView(frame);
        startReader();
    }

    private void startReader() {
        frame.removeAllViews();
        try {
            reader = new WebView(this);
            if (softwareLayer) reader.setLayerType(View.LAYER_TYPE_SOFTWARE, null);
            configureReader(reader);
            frame.addView(reader, new FrameLayout.LayoutParams(-1, -1));
            reader.loadUrl(ENTRY);
            WebView starting = reader;
            frame.postDelayed(() -> {
                if (starting == null || reader != starting || isFinishing()) return;
                starting.evaluateJavascript("document.body && document.body.dataset.readerReady === 'true'", ready -> {
                    if (reader == starting && !isFinishing() && !"true".equals(ready)) {
                        Log.e(TAG, "Reader did not report readiness");
                        showError("本地书架未能启动。请更新 Android System WebView 后重试。");
                    }
                });
            }, 12000);
        } catch (RuntimeException | LinkageError error) {
            Log.e(TAG, "WebView initialization failed", error);
            showError("无法启动系统 WebView。请确认它已启用并更新。\n" + error.getClass().getSimpleName());
        }
    }

    private void configureReader(WebView webView) {
        webView.setBackgroundColor(PAPER);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(true);
        webView.getSettings().setBlockNetworkLoads(true);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (request.isForMainFrame() && "https".equals(uri.getScheme()) &&
                        ASSET_HOST.equals(uri.getHost()) && "/word-search".equals(uri.getPath())) {
                    String term = uri.getQueryParameter("term");
                    if (validLookupTerm(term)) showWebSearch(term);
                    return true;
                }
                return request.isForMainFrame() || !"blob".equals(uri.getScheme());
            }

            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!"https".equals(url.getScheme()) || !ASSET_HOST.equals(url.getHost())) return missing();
                String route = url.getPath();
                if ("/word-lookup".equals(route) && "GET".equals(request.getMethod())) {
                    return lookup(url.getQueryParameter("source"), url.getQueryParameter("term"));
                }
                if (route == null || !route.matches("/[a-zA-Z0-9_./-]+")
                        || route.contains("..") || !request.getMethod().equals("GET")) return missing();
                String asset = route.substring(1);
                String mime = mimeType(asset);
                try {
                    return new WebResourceResponse(mime, mime.startsWith("text/") ? "UTF-8" : null,
                        200, "OK", Collections.singletonMap("X-Content-Type-Options", "nosniff"),
                        getAssets().open(asset));
                } catch (IOException ex) {
                    return missing();
                }
            }

            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                Log.e(TAG, "WebView renderer stopped, crash=" + detail.didCrash());
                if (reader == view) {
                    softwareLayer = true;
                    showError("阅读页面意外停止。重新打开时将尝试兼容渲染。");
                }
                return true;
            }

            @Override public void onReceivedError(WebView view, WebResourceRequest request,
                    WebResourceError error) {
                if (!request.isForMainFrame() || reader != view) return;
                Log.e(TAG, "Local reader page failed: " + error.getErrorCode());
                showError("无法加载本地书架。错误代码 " + error.getErrorCode());
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                if (fileSelection != null) fileSelection.onReceiveValue(null);
                fileSelection = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                try {
                    startActivityForResult(intent, PICK_BOOK);
                } catch (ActivityNotFoundException ex) {
                    fileSelection.onReceiveValue(null);
                    fileSelection = null;
                }
                return true;
            }
        });
    }

    private void showError(String message) {
        disposeReader();
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        int padding = (int) (24 * getResources().getDisplayMetrics().density);
        panel.setPadding(padding, padding, padding, padding);
        TextView description = new TextView(this);
        description.setText(message);
        description.setTextSize(16);
        description.setGravity(Gravity.CENTER);
        panel.addView(description);
        Button retry = new Button(this);
        retry.setText("重新打开");
        retry.setOnClickListener(view -> startReader());
        panel.addView(retry);
        frame.addView(panel, new FrameLayout.LayoutParams(-1, -1));
    }

    private void disposeReader() {
        WebView view = reader;
        reader = null;
        if (view == null) return;
        if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
        view.destroy();
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_BOOK || fileSelection == null) return;
        ValueCallback<Uri[]> callback = fileSelection;
        fileSelection = null;
        Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
        callback.onReceiveValue(uri == null ? null : new Uri[] { uri });
    }

    @Override public void onBackPressed() {
        if (reader == null) {
            finish();
            return;
        }
        reader.evaluateJavascript("Boolean(window.leafBack && window.leafBack())", result -> {
            if (!"true".equals(result)) finish();
        });
    }

    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        updateReaderForeground();
    }

    @Override protected void onPause() {
        resumed = false;
        updateReaderForeground();
        super.onPause();
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        updateReaderForeground();
    }

    private void updateReaderForeground() {
        if (reader != null) {
            reader.evaluateJavascript("window.leafForeground && window.leafForeground("
                + (resumed && hasWindowFocus()) + ")", null);
        }
    }

    @Override protected void onDestroy() {
        if (fileSelection != null) fileSelection.onReceiveValue(null);
        if (webSearchDialog != null) webSearchDialog.dismiss();
        disposeReader();
        super.onDestroy();
    }

    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
            Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    private void showWebSearch(String term) {
        if (isFinishing() || isDestroyed() || webSearchDialog != null) return;
        Dialog dialog = new Dialog(this);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setBackgroundColor(PAPER);
        LinearLayout controls = new LinearLayout(this);
        Button baidu = new Button(this);
        Button bing = new Button(this);
        Button close = new Button(this);
        baidu.setText("百度");
        bing.setText("Bing");
        close.setText("返回阅读");
        for (Button button : new Button[] { baidu, bing, close }) {
            controls.addView(button, new LinearLayout.LayoutParams(0, -2, 1));
        }
        panel.addView(controls);
        WebView results = new WebView(this);
        results.getSettings().setAllowFileAccess(false);
        results.getSettings().setAllowContentAccess(false);
        results.getSettings().setJavaScriptEnabled(true);
        results.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return !"https".equals(uri.getScheme()) || ASSET_HOST.equals(uri.getHost());
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                dialog.dismiss();
                return true;
            }
        });
        panel.addView(results, new LinearLayout.LayoutParams(-1, 0, 1));
        dialog.setContentView(panel);
        String encoded = Uri.encode(term);
        baidu.setOnClickListener(button -> results.loadUrl("https://m.baidu.com/s?word=" + encoded));
        bing.setOnClickListener(button -> results.loadUrl("https://www.bing.com/search?q=" + encoded));
        close.setOnClickListener(button -> dialog.dismiss());
        dialog.setOnDismissListener(ignored -> {
            webSearchDialog = null;
            results.stopLoading();
            panel.removeView(results);
            results.destroy();
        });
        webSearchDialog = dialog;
        dialog.show();
        Window window = dialog.getWindow();
        if (window != null) window.setLayout(-1, (int) (getResources().getDisplayMetrics().heightPixels * .85));
        bing.performClick();
    }

    private static boolean validLookupTerm(String term) {
        return term != null && !term.trim().isEmpty() && term.length() <= 64 &&
            term.codePoints().noneMatch(Character::isISOControl);
    }

    private static WebResourceResponse lookup(String source, String term) {
        if (!validLookupTerm(term)) return missing();
        final String endpoint;
        if ("dictionary".equals(source)) {
            endpoint = "https://www.moedict.tw/a/" + Uri.encode(transliterate("Simplified-Traditional", term)) + ".json";
        } else if ("system-reading".equals(source)) {
            String reading = transliterate("Han-Latin", term);
            return lookupJson(("{\"reading\":" + JSONObject.quote(reading) + "}").getBytes(StandardCharsets.UTF_8));
        } else if ("encyclopedia".equals(source)) {
            endpoint = "https://zh.wikipedia.org/w/api.php?action=query&format=json&formatversion=2"
                + "&generator=search&gsrnamespace=0&gsrlimit=3&prop=extracts&exintro=1"
                + "&explaintext=1&exchars=420&exlimit=3&gsrsearch=" + Uri.encode(term);
        } else if ("pronunciation".equals(source)) {
            endpoint = "https://en.wiktionary.org/w/api.php?action=parse&format=json&formatversion=2"
                + "&prop=wikitext&redirects=1&page=" + Uri.encode(term);
        } else return missing();
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(endpoint).openConnection();
            connection.setConnectTimeout(3500);
            connection.setReadTimeout(3500);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("User-Agent", "LeafReader/0.1.9 (dictionary lookup; Android)");
            connection.setRequestProperty("Accept", "application/json");
            int status = connection.getResponseCode();
            if (status == 404) return lookupJson(new byte[] { '{', '}' });
            if (status != 200) {
                Log.w(TAG, "Dictionary source " + source + " returned HTTP " + status);
                return lookupFailure();
            }
            try (InputStream input = connection.getInputStream();
                 ByteArrayOutputStream body = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int size;
                while ((size = input.read(buffer)) != -1) {
                    if (body.size() + size > 1024 * 1024) return lookupFailure();
                    body.write(buffer, 0, size);
                }
                return lookupJson(body.toByteArray());
            }
        } catch (IOException error) {
            Log.w(TAG, "Online dictionary connection failed: " + error.getClass().getSimpleName());
            return lookupFailure();
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String transliterate(String id, String term) {
        try { return Transliterator.getInstance(id).transliterate(term); }
        catch (IllegalArgumentException unavailable) { return term; }
    }

    private static WebResourceResponse lookupJson(byte[] body) {
        return new WebResourceResponse("application/json", "UTF-8", 200, "OK",
            Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(body));
    }

    private static WebResourceResponse lookupFailure() {
        return new WebResourceResponse("application/json", "UTF-8", 502, "Bad Gateway",
            Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(new byte[0]));
    }

    private static String mimeType(String file) {
        if (file.endsWith(".html")) return "text/html";
        if (file.endsWith(".css")) return "text/css";
        if (file.endsWith(".js") || file.endsWith(".mjs")) return "text/javascript";
        if (file.endsWith(".svg")) return "image/svg+xml";
        if (file.endsWith(".gif")) return "image/gif";
        if (file.endsWith(".png")) return "image/png";
        if (file.endsWith(".wasm")) return "application/wasm";
        return "application/octet-stream";
    }
}
