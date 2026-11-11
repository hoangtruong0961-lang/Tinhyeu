package com.bachduong.remixvideo;

import android.os.Bundle;
import android.util.Log;
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
    }
}
