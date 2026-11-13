#!/usr/bin/env bash
# Build the Darwaza Android app (APK) without Gradle: aapt2 → javac → d8 → zipalign → apksigner.
# Needs: JDK 17+, Android SDK with platforms;android-35 and build-tools;35.0.0 (ANDROID_HOME).
# Signing key: KEYSTORE (default ./darwaza-release.jks), KEYSTORE_PASS. Keep the key safe: updates must use the same key.
set -euo pipefail
cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-/opt/android-sdk}"
BT="$SDK/build-tools/35.0.0"
JAR="$SDK/platforms/android-35/android.jar"
KEYSTORE="${KEYSTORE:-darwaza-release.jks}"
: "${KEYSTORE_PASS:?set KEYSTORE_PASS to the signing key password}"
OUT=build; rm -rf "$OUT"; mkdir -p "$OUT/compiled" "$OUT/gen" "$OUT/classes" "$OUT/dex"

"$BT/aapt2" compile --dir res -o "$OUT/compiled/res.zip"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$JAR" --manifest AndroidManifest.xml \
  --java "$OUT/gen" --min-sdk-version 24 --target-sdk-version 35 --version-code 1 --version-name 1.0.0 \
  "$OUT/compiled/res.zip"
javac --release 11 -classpath "$JAR" -d "$OUT/classes" $(find src "$OUT/gen" -name '*.java') -Xlint:-options
"$BT/d8" --release --min-api 24 --lib "$JAR" --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')
cp "$OUT/base.apk" "$OUT/unsigned.apk"
(cd "$OUT/dex" && zip -q -j ../unsigned.apk classes.dex)
"$BT/zipalign" -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-pass env:KEYSTORE_PASS --ks-key-alias darwaza \
  --out dist/Darwaza.apk "$OUT/aligned.apk"
"$BT/apksigner" verify --print-certs dist/Darwaza.apk | head -3
echo "Built dist/Darwaza.apk"
