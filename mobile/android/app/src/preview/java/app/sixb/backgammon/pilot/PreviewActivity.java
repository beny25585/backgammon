package app.sixb.backgammon.pilot;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.BridgeWebViewClient;

public class PreviewActivity extends MainActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (bridge == null) return;

        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request.isForMainFrame()
                        && OnlineClubActivity.CLUB_URL.equals(request.getUrl().toString())) {
                    startActivity(new Intent(PreviewActivity.this, OnlineClubActivity.class));
                    return true;
                }
                return super.shouldOverrideUrlLoading(view, request);
            }
        });
    }
}
