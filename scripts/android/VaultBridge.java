package __PACKAGE__;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PersistableBundle;
import android.webkit.JavascriptInterface;

/**
 * Копирование в буфер обмена с гарантированной очисткой через N секунд,
 * даже если приложение ушло в фон (таймеры веб-страницы там могут стоять).
 */
public class VaultBridge {
    private static final String LABEL = "sejf-secret";

    private final Context ctx;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable pending;

    public VaultBridge(Context context) {
        this.ctx = context;
    }

    @JavascriptInterface
    public void copy(final String text, final int seconds) {
        handler.post(new Runnable() {
            @Override
            public void run() {
                ClipboardManager cm = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm == null) return;
                ClipData clip = ClipData.newPlainText(LABEL, text);
                if (Build.VERSION.SDK_INT >= 24) {
                    // Android 13+: не показывать содержимое в подсказке о копировании
                    PersistableBundle extras = new PersistableBundle();
                    extras.putBoolean("android.content.extra.IS_SENSITIVE", true);
                    clip.getDescription().setExtras(extras);
                }
                cm.setPrimaryClip(clip);
                if (pending != null) handler.removeCallbacks(pending);
                pending = new Runnable() {
                    @Override
                    public void run() {
                        pending = null;
                        clearIfOurs();
                    }
                };
                handler.postDelayed(pending, seconds * 1000L);
            }
        });
    }

    @JavascriptInterface
    public void clearNow() {
        handler.post(new Runnable() {
            @Override
            public void run() {
                if (pending != null) {
                    handler.removeCallbacks(pending);
                    pending = null;
                }
                clearIfOurs();
            }
        });
    }

    private void clearIfOurs() {
        ClipboardManager cm = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm == null) return;
        ClipDescription d = cm.getPrimaryClipDescription();
        boolean ours = (d == null) || (d.getLabel() != null && LABEL.contentEquals(d.getLabel()));
        if (!ours) return;
        if (Build.VERSION.SDK_INT >= 28) {
            cm.clearPrimaryClip();
        } else {
            cm.setPrimaryClip(ClipData.newPlainText("", ""));
        }
    }
}
