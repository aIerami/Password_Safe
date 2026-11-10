#!/usr/bin/env bash
# Применяет к свежесозданному Android-проекту:
#  1) иконку, тёмный экран запуска, вертикальную ориентацию;
#  2) безопасность: убирает доступ в интернет, запрещает скриншоты (FLAG_SECURE),
#     отключает облачное резервное копирование Android;
#  3) постоянный ключ подписи из секретов GitHub и сборку release (не отладочную).
set -euo pipefail

RES=android/app/src/main/res
MAN=android/app/src/main/AndroidManifest.xml
GRADLE=android/app/build.gradle
APPID=$(node -p "require('./capacitor.config.json').appId")
JAVADIR="android/app/src/main/java/$(echo "$APPID" | tr . /)"

# 1. Нативный код: FLAG_SECURE, очистка буфера обмена, автоблокировка
#    (Java-файлы записываются прямо из этого скрипта, отдельные файлы не нужны)
mkdir -p "$JAVADIR"
cat > "$JAVADIR/MainActivity.java" <<'JAVA_EOF'
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
JAVA_EOF
cat > "$JAVADIR/VaultBridge.java" <<'JAVA_EOF'
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
JAVA_EOF
sed -i "s/__PACKAGE__/$APPID/g" "$JAVADIR/MainActivity.java" "$JAVADIR/VaultBridge.java"

# 2. AndroidManifest.xml
python3 - "$MAN" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
# убрать разрешение INTERNET, где бы оно ни стояло
s = re.sub(r'[ \t]*<uses-permission[^>]*android\.permission\.INTERNET[^>]*/>[ \t]*\n?', '', s)
# и запретить его на уровне итогового манифеста (даже если добавит библиотека)
if 'xmlns:tools' not in s:
    s = s.replace('<manifest ', '<manifest xmlns:tools="http://schemas.android.com/tools" ', 1)
s = s.replace('<application', '<uses-permission android:name="android.permission.INTERNET" tools:node="remove" />\n    <application', 1)
# без облачных/adb-копий данных приложения
s = s.replace('android:allowBackup="true"', 'android:allowBackup="false"')
if 'usesCleartextTraffic' not in s:
    s = s.replace('<application', '<application android:usesCleartextTraffic="false"', 1)
# вертикальная ориентация и подъём экрана над клавиатурой
if 'screenOrientation' not in s:
    s = s.replace('<activity', '<activity android:screenOrientation="portrait" android:windowSoftInputMode="adjustResize"', 1)
open(p, 'w', encoding='utf-8').write(s)
PY
echo "--- AndroidManifest.xml ---"; cat "$MAN"
if grep -v 'tools:node="remove"' "$MAN" | grep -q 'permission.INTERNET'; then
  echo "ОШИБКА: разрешение INTERNET осталось в манифесте"; exit 1
fi

# 3. Иконка приложения
for d in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
  mkdir -p "$RES/mipmap-$d"
  rm -f "$RES/mipmap-$d"/ic_launcher*.webp
  cp "icons/$d/ic_launcher.png"            "$RES/mipmap-$d/ic_launcher.png"
  cp "icons/$d/ic_launcher_round.png"      "$RES/mipmap-$d/ic_launcher_round.png"
  cp "icons/$d/ic_launcher_foreground.png" "$RES/mipmap-$d/ic_launcher_foreground.png"
done
mkdir -p "$RES/values"
cat > "$RES/values/ic_launcher_background.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#050A16</color>
</resources>
XML

# 4. Экран запуска: сплошной тёмный фон
find "$RES" -name 'splash.png' -exec cp icons/splash.png {} \;

# 5. Подпись постоянным ключом + номер версии (versionCode) растёт с каждой сборкой
python3 - "$GRADLE" <<'PY'
import os, re, sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
import time
run = str(int(time.time()))   # номер версии = текущее время: всегда растёт, даже если репозиторий пересоздан
s = re.sub(r'versionCode\s+\d+', 'versionCode ' + run, s, count=1)
s += '''

// --- Подпись постоянным ключом (данные берутся из секретов GitHub) ---
android {
    signingConfigs {
        release {
            storeFile file(System.getenv("KEYSTORE_PATH") ?: "missing.jks")
            storePassword System.getenv("KEYSTORE_PASSWORD")
            keyAlias System.getenv("KEY_ALIAS")
            keyPassword System.getenv("KEY_PASSWORD")
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            debuggable false
        }
    }
}
'''
open(p, 'w', encoding='utf-8').write(s)
PY

echo "Android-проект подготовлен"
