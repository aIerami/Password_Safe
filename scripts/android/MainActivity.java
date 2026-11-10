package __PACKAGE__;

import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private long stoppedAt = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Запрет скриншотов, записи экрана и показа содержимого в списке недавних приложений
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(0xFF050A16);
        getWindow().setNavigationBarColor(0xFF050A16);
        View decor = getWindow().getDecorView();
        int flags = decor.getSystemUiVisibility();
        if (Build.VERSION.SDK_INT >= 23) {
            flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        }
        if (Build.VERSION.SDK_INT >= 26) {
            flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            // Не предлагать сервисам автозаполнения запоминать пароли из этого приложения
            decor.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        }
        decor.setSystemUiVisibility(flags);

        getBridge().getWebView().addJavascriptInterface(new VaultBridge(getApplicationContext()), "VaultNative");
    }

    @Override
    public void onStop() {
        super.onStop();
        stoppedAt = SystemClock.elapsedRealtime();
    }

    @Override
    public void onStart() {
        super.onStart();
        if (stoppedAt > 0 && getBridge() != null && getBridge().getWebView() != null) {
            long elapsed = SystemClock.elapsedRealtime() - stoppedAt;
            stoppedAt = 0;
            // Сообщаем странице, сколько времени приложение было в фоне (для автоблокировки)
            getBridge().getWebView().evaluateJavascript("window.__resumed && window.__resumed(" + elapsed + ")", null);
        }
    }
}
