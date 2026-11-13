package com.bachduong.remixvideo;

import android.os.Bundle;
import android.util.Log;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "MainActivity";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HardwareIdPlugin.class);
        registerPlugin(GeminiWebViewPlugin.class);
        registerPlugin(FFmpegKitPlugin.class);
        registerPlugin(VieNeuPlugin.class);
        super.onCreate(savedInstanceState);

        try {
            getWindow().getDecorView().setBackgroundColor(0xFF08080C);
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            if (controller != null) {
                controller.setAppearanceLightStatusBars(false);
                controller.setAppearanceLightNavigationBars(false);
            }
        } catch (Exception e) {
            Log.w(TAG, "System bars appearance setup warning", e);
        }
    }
}
