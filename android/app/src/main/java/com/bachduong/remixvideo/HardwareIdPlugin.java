package com.bachduong.remixvideo;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.security.MessageDigest;
import java.util.Locale;

@CapacitorPlugin(name = "HardwareId")
public class HardwareIdPlugin extends Plugin {

    private static final String PREFS_NAME = "bach_hardware_prefs";
    private static final String KEY_PERSISTENT_DEVICE_ID = "persistent_device_id";
    private static final String KEY_PERSISTENT_MEMBER_CODE = "persistent_member_code";

    @PluginMethod
    public void getAndroidId(PluginCall call) {
        try {
            Context ctx = getContext();
            SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

            String savedDeviceId = prefs.getString(KEY_PERSISTENT_DEVICE_ID, null);
            String savedMemberCode = prefs.getString(KEY_PERSISTENT_MEMBER_CODE, null);

            String androidId = Settings.Secure.getString(
                ctx.getContentResolver(),
                Settings.Secure.ANDROID_ID
            );
            if (androidId == null) {
                androidId = "";
            } else {
                androidId = androidId.trim();
            }

            String model = Build.MODEL != null ? Build.MODEL.trim() : "";
            String manufacturer = Build.MANUFACTURER != null ? Build.MANUFACTURER.trim() : "";
            String brand = Build.BRAND != null ? Build.BRAND.trim() : "";
            String hardware = Build.HARDWARE != null ? Build.HARDWARE.trim() : "";
            String device = Build.DEVICE != null ? Build.DEVICE.trim() : "";
            String board = Build.BOARD != null ? Build.BOARD.trim() : "";

            // Calculate deterministic hardware seed if not already saved in SharedPreferences
            if (savedDeviceId == null || savedDeviceId.trim().isEmpty() || savedMemberCode == null || savedMemberCode.trim().isEmpty()) {
                String rawSeed;
                if (!androidId.isEmpty() && !androidId.equalsIgnoreCase("9774d56d682e549c")) {
                    rawSeed = "ANDROID_ID:" + androidId.toUpperCase(Locale.ROOT);
                } else {
                    rawSeed = "HW:" + manufacturer + "/" + brand + "/" + model + "/" + hardware + "/" + device + "/" + board;
                }

                String computedDeviceId = "DEV-" + sha256Hex(rawSeed).substring(0, 16).toUpperCase(Locale.ROOT);
                String computedMemberCode = generateMemberCodeFromSeed(computedDeviceId);

                savedDeviceId = computedDeviceId;
                savedMemberCode = computedMemberCode;

                prefs.edit()
                    .putString(KEY_PERSISTENT_DEVICE_ID, savedDeviceId)
                    .putString(KEY_PERSISTENT_MEMBER_CODE, savedMemberCode)
                    .apply();
            }

            JSObject ret = new JSObject();
            ret.put("androidId", androidId);
            ret.put("deviceId", savedDeviceId);
            ret.put("memberCode", savedMemberCode);
            ret.put("model", model);
            ret.put("manufacturer", manufacturer);
            ret.put("brand", brand);
            ret.put("hardware", hardware);
            ret.put("device", device);
            ret.put("board", board);
            ret.put("fingerprint", Build.FINGERPRINT != null ? Build.FINGERPRINT : "");
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("androidId", "");
            ret.put("error", e.getMessage() != null ? e.getMessage() : "Unknown error");
            call.resolve(ret);
        }
    }

    private static String sha256Hex(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(input.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (byte b : digest) {
                sb.append(String.format(Locale.ROOT, "%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            return Integer.toHexString(input.hashCode()) + "0000000000000000";
        }
    }

    private static String generateMemberCodeFromSeed(String seed) {
        int hash1 = 5381;
        int hash2 = 52711;
        String str = seed.toUpperCase(Locale.ROOT).trim();
        for (int i = 0; i < str.length(); i++) {
            char ch = str.charAt(i);
            hash1 = ((hash1 << 5) + hash1) ^ ch;
            hash2 = ((hash2 << 5) + hash2) ^ ch;
        }
        String hex1 = String.format(Locale.ROOT, "%04X", Math.abs(hash1) & 0xFFFF);
        String hex2 = String.format(Locale.ROOT, "%04X", Math.abs(hash2) & 0xFFFF);
        return "MEM-" + hex1 + "-" + hex2;
    }
}

