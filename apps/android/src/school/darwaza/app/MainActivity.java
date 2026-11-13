package school.darwaza.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

/**
 * Darwaza Private School app: a full-screen window onto the school system.
 * Grades, codes and personal data stay on the school's server; the app stores only the sign-in cookie.
 */
public class MainActivity extends Activity {
    // Address of the school server. Change it when the school moves to its own domain.
    static final String SCHOOL_URL = "https://darwaza-test.vercel.app/";
    static final String SCHOOL_HOST = Uri.parse(SCHOOL_URL).getHost();
    private static final int FILE_REQUEST = 41;

    private WebView web;
    private TextView offline;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));

        offline = new TextView(this);
        offline.setText(R.string.offline);
        offline.setGravity(Gravity.CENTER);
        offline.setTextSize(17);
        offline.setTextColor(Color.parseColor("#182B53"));
        offline.setBackgroundColor(Color.WHITE);
        offline.setPadding(48, 48, 48, 48);
        offline.setVisibility(View.GONE);
        offline.setOnClickListener(v -> { offline.setVisibility(View.GONE); web.reload(); });
        root.addView(offline, new FrameLayout.LayoutParams(-1, -1));

        // Keep content clear of the status and navigation bars (edge-to-edge on Android 15+).
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets b = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                v.setPadding(b.left, b.top, b.right, b.bottom);
            } else {
                v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        root.setBackgroundColor(Color.parseColor("#182B53"));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " DarwazaApp/1.0");
        CookieManager.getInstance().setAcceptCookie(true);
        web.setBackgroundColor(Color.WHITE);

        // window.print() → Android's print dialog (save as PDF or print). Only for the school's own pages.
        web.addJavascriptInterface(new Bridge(), "DarwazaAndroid");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("https".equals(u.getScheme()) && SCHOOL_HOST.equalsIgnoreCase(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (ActivityNotFoundException ignored) { }
                return true; // other sites open in the phone's browser
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (isSchool(url)) {
                    view.evaluateJavascript("window.print=function(){DarwazaAndroid.print(document.title||'Darwaza')};", null);
                }
                CookieManager.getInstance().flush();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame() && !isOnline()) offline.setVisibility(View.VISIBLE);
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            // Photo upload (student photos).
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                try {
                    startActivityForResult(params.createIntent(), FILE_REQUEST);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        if (saved != null) web.restoreState(saved); else web.loadUrl(SCHOOL_URL);
    }

    private boolean isSchool(String url) {
        Uri u = Uri.parse(url);
        return "https".equals(u.getScheme()) && SCHOOL_HOST.equalsIgnoreCase(u.getHost());
    }

    private boolean isOnline() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        NetworkInfo n = cm == null ? null : cm.getActiveNetworkInfo();
        return n != null && n.isConnected();
    }

    final class Bridge {
        @JavascriptInterface
        public void print(final String title) {
            runOnUiThread(() -> {
                if (!isSchool(web.getUrl())) return;
                PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                if (pm == null) return;
                String name = (title == null || title.isEmpty()) ? "Darwaza" : title;
                pm.print(name, web.createPrintDocumentAdapter(name),
                        new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
            });
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_REQUEST && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        CookieManager.getInstance().flush();
        super.onPause();
    }
}
