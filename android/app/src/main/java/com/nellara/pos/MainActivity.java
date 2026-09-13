package com.nellara.pos;

import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BluetoothThermalPlugin.class);
        registerPlugin(SyncServerPlugin.class);
        super.onCreate(savedInstanceState);

        // Keep the POS layout stable regardless of the phone's font-size/display
        // setting: Android applies the system font scale to the WebView as
        // textZoom, which overflows the fixed-size POS layout. Pin it to 100%.
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.getSettings().setTextZoom(100);
            // The app is served from an https://localhost origin; allow the
            // LAN sync client to open ws:// connections to the hub.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                webView.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            }
        }
    }
}
