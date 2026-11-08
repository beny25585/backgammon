package app.sixb.backgammon.pilot;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import java.io.ByteArrayInputStream;
import java.util.Collections;

public final class OnlineClubActivity extends AppCompatActivity {
    private static final String CLUB_HOST = "38.247.146.17.nip.io";
    public static final String CLUB_URL = "https://" + CLUB_HOST + "/6b/tournaments/";

    private WebView webView;
    private AlertDialog connectionDialog;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        int background = getColor(R.color.sixb_background);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(background);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets padding = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime()
            );
            view.setPadding(padding.left, padding.top, padding.right, padding.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        webView = new WebView(this);
        webView.setBackgroundColor(background);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new ClubNavigation());

        root.addView(webView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), root);
        bars.setAppearanceLightStatusBars(false);
        bars.setAppearanceLightNavigationBars(false);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    finish();
                }
            }
        });
        webView.loadUrl(CLUB_URL);
    }

    private static boolean isClubOrigin(Uri uri) {
        String authority = uri.getEncodedAuthority();
        return "https".equalsIgnoreCase(uri.getScheme())
            && (CLUB_HOST.equalsIgnoreCase(authority) || (CLUB_HOST + ":443").equalsIgnoreCase(authority));
    }

    private void openExternalLink(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException | SecurityException error) {
            Toast.makeText(this, R.string.preview_club_external_unavailable, Toast.LENGTH_SHORT).show();
        }
    }

    private static String retryUrl(WebResourceRequest request) {
        Uri url = request.getUrl();
        String path = url.getPath();
        // The game-entry redirect consumes a ticket. Retry a safe page, never a form or ticket exchange.
        if ("GET".equals(request.getMethod()) && isClubOrigin(url) && path != null
                && (path.startsWith("/6b/tournaments/") || path.startsWith("/6b/backgammon/game/"))) {
            return url.buildUpon().fragment(null).build().toString();
        }
        return CLUB_URL;
    }

    private void showConnectionError(String retryUrl) {
        if (isFinishing() || isDestroyed() || (connectionDialog != null && connectionDialog.isShowing())) {
            return;
        }
        connectionDialog = new AlertDialog.Builder(this)
            .setTitle(R.string.preview_club_unavailable_title)
            .setMessage(R.string.preview_club_unavailable_message)
            .setPositiveButton(R.string.preview_club_retry, (dialog, which) -> webView.loadUrl(retryUrl))
            .setNegativeButton(R.string.preview_club_back, (dialog, which) -> finish())
            .setOnCancelListener(dialog -> finish())
            .show();
    }

    @Override
    protected void onDestroy() {
        if (connectionDialog != null) {
            connectionDialog.dismiss();
        }
        webView.stopLoading();
        if (webView.getParent() instanceof ViewGroup parent) {
            parent.removeView(webView);
        }
        webView.destroy();
        super.onDestroy();
    }

    private final class ClubNavigation extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (!request.isForMainFrame() || isClubOrigin(url)) {
                return false;
            }
            if (request.hasGesture() && "https".equalsIgnoreCase(url.getScheme())
                    && url.getHost() != null && url.getUserInfo() == null) {
                openExternalLink(url);
            }
            return true;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            if (request.isForMainFrame() && !isClubOrigin(request.getUrl())) {
                // shouldOverrideUrlLoading does not cover form POSTs.
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden",
                    Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
            return null;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            if (!isClubOrigin(Uri.parse(url))) {
                view.stopLoading();
                showConnectionError(CLUB_URL);
            }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) {
                showConnectionError(retryUrl(request));
            }
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (request.isForMainFrame() && response.getStatusCode() >= 500) {
                showConnectionError(retryUrl(request));
            }
        }
    }
}
