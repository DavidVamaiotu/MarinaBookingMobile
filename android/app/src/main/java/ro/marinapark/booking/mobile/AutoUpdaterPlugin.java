package ro.marinapark.booking.mobile;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.Toast;
import androidx.appcompat.app.AlertDialog;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "AutoUpdater")
public class AutoUpdaterPlugin extends Plugin {
    private static final String RELEASE_URL = "https://api.github.com/repos/DavidVamaiotu/MarinaBookingMobile/releases/latest";
    private static final String APK_NAME = "MarinaBookingMobile.apk";
    private static final String HASH_NAME = APK_NAME + ".sha256";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private volatile File pendingApk;

    @PluginMethod
    public void checkAndInstall(PluginCall call) {
        if (BuildConfig.DEBUG) {
            call.resolve(result(false, "debug-build"));
            return;
        }
        executor.execute(() -> checkRelease(call));
    }

    private void checkRelease(PluginCall call) {
        try {
            JSONObject release = new JSONObject(readText(RELEASE_URL));
            String tag = release.optString("tag_name", "").replaceFirst("^[vV]", "");
            if (compareVersions(tag, BuildConfig.VERSION_NAME) <= 0) {
                call.resolve(result(false, "up-to-date"));
                return;
            }
            JSONArray assets = release.getJSONArray("assets");
            String apkUrl = assetUrl(assets, APK_NAME);
            String hashUrl = assetUrl(assets, HASH_NAME);
            if (apkUrl.isEmpty() || hashUrl.isEmpty()) throw new IllegalStateException("Release assets are incomplete.");
            getActivity().runOnUiThread(() -> new AlertDialog.Builder(getActivity())
                .setTitle("Actualizare disponibilă")
                .setMessage("Marina Booking " + tag + " este disponibilă. Descarci și instalezi acum?")
                .setNegativeButton("Mai târziu", (dialog, which) -> call.resolve(result(false, "postponed")))
                .setPositiveButton("Actualizează", (dialog, which) -> downloadAndInstall(call, apkUrl, hashUrl, tag))
                .setCancelable(false)
                .show());
        } catch (Exception error) {
            call.reject("Update check failed", error);
        }
    }

    private void downloadAndInstall(PluginCall call, String apkUrl, String hashUrl, String version) {
        Toast.makeText(getContext(), "Se descarcă actualizarea…", Toast.LENGTH_SHORT).show();
        executor.execute(() -> {
            try {
                String expected = readText(hashUrl).trim().split("\\s+")[0].toLowerCase(Locale.ROOT);
                File directory = new File(getContext().getCacheDir(), "updates");
                if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("Cannot create update directory.");
                File apk = new File(directory, APK_NAME);
                download(apkUrl, apk);
                String actual = sha256(apk);
                if (!actual.equals(expected)) {
                    apk.delete();
                    throw new SecurityException("Downloaded APK checksum does not match the release.");
                }
                pendingApk = apk;
                getActivity().runOnUiThread(() -> {
                    if (canInstallPackages()) openInstaller(apk);
                    else requestInstallPermission();
                    call.resolve(result(true, version));
                });
            } catch (Exception error) {
                getActivity().runOnUiThread(() -> Toast.makeText(getContext(), "Actualizarea nu a putut fi descărcată.", Toast.LENGTH_LONG).show());
                call.reject("Update download failed", error);
            }
        });
    }

    @Override
    protected void handleOnResume() {
        if (pendingApk != null && pendingApk.exists() && canInstallPackages()) openInstaller(pendingApk);
    }

    private boolean canInstallPackages() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
    }

    private void requestInstallPermission() {
        new AlertDialog.Builder(getActivity())
            .setTitle("Permite instalarea actualizării")
            .setMessage("Android trebuie să permită Marina Booking să instaleze actualizarea descărcată. Activează opțiunea, apoi revino în aplicație.")
            .setPositiveButton("Deschide setările", (dialog, which) -> {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
                getActivity().startActivity(intent);
            })
            .setNegativeButton("Anulează", null)
            .show();
    }

    private void openInstaller(File apk) {
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        getActivity().startActivity(intent);
        pendingApk = null;
    }

    private static JSObject result(boolean available, String status) {
        JSObject result = new JSObject();
        result.put("available", available);
        result.put("status", status);
        return result;
    }

    private static String assetUrl(JSONArray assets, String name) throws Exception {
        for (int index = 0; index < assets.length(); index++) {
            JSONObject asset = assets.getJSONObject(index);
            if (name.equals(asset.optString("name"))) return asset.optString("browser_download_url");
        }
        return "";
    }

    static int compareVersions(String left, String right) {
        String[] a = left.split("[-+.]", 4);
        String[] b = right.split("[-+.]", 4);
        for (int index = 0; index < 3; index++) {
            int av = index < a.length ? number(a[index]) : 0;
            int bv = index < b.length ? number(b[index]) : 0;
            if (av != bv) return Integer.compare(av, bv);
        }
        return 0;
    }

    private static int number(String value) {
        try { return Integer.parseInt(value.replaceAll("[^0-9].*$", "")); }
        catch (Exception ignored) { return 0; }
    }

    private static String readText(String address) throws Exception {
        HttpURLConnection connection = connection(address);
        try (InputStream input = new BufferedInputStream(connection.getInputStream()); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16 * 1024];
            int count;
            while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
            return output.toString(StandardCharsets.UTF_8.name());
        } finally {
            connection.disconnect();
        }
    }

    private static void download(String address, File destination) throws Exception {
        HttpURLConnection connection = connection(address);
        try (InputStream input = new BufferedInputStream(connection.getInputStream()); FileOutputStream output = new FileOutputStream(destination)) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
        } finally {
            connection.disconnect();
        }
    }

    private static HttpURLConnection connection(String address) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(60_000);
        connection.setRequestProperty("Accept", "application/vnd.github+json");
        connection.setRequestProperty("User-Agent", "MarinaBookingMobile-Updater");
        connection.setInstanceFollowRedirects(true);
        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) throw new IllegalStateException("Update server returned HTTP " + status + ".");
        return connection;
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) >= 0) digest.update(buffer, 0, count);
        }
        StringBuilder value = new StringBuilder();
        for (byte item : digest.digest()) value.append(String.format(Locale.ROOT, "%02x", item));
        return value.toString();
    }
}
