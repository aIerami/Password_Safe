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
mkdir -p "$JAVADIR"
for f in MainActivity VaultBridge; do
  sed "s/__PACKAGE__/$APPID/g" "scripts/android/$f.java" > "$JAVADIR/$f.java"
done

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
