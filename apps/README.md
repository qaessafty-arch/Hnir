# Darwaza apps (Android, Windows, iPhone/iPad)

Each app is a small native window that opens the Darwaza school system (`https://darwaza-test.vercel.app/`).
No grades, codes or personal data are stored in the apps; everything stays on the school's server, so the
apps never need updating when the system changes. **When the school moves to its own domain, change the
address in each app and rebuild** (`SCHOOL_URL` in Android `MainActivity.java`, `SchoolURL` in Windows
`main.go`, `schoolURL` in iOS `DarwazaApp.swift`).

| Platform | Folder | Build | Output |
|---|---|---|---|
| Android 7+ | `android/` | `KEYSTORE=… KEYSTORE_PASS=… ./build.sh` (JDK 17, Android SDK platform 35 + build-tools 35) | `android/dist/Darwaza.apk` |
| Windows 10/11 (x64, ARM64) | `windows/` | `GOOS=windows GOARCH=amd64 go build -ldflags "-s -w -H windowsgui" -o dist/Darwaza.exe .` (Go 1.24; icon via `go-winres make`) | `windows/dist/Darwaza.exe` |
| iPhone / iPad (iOS 15+) | `ios/` | On a Mac: `brew install xcodegen && xcodegen`, open `Darwaza.xcodeproj`, choose your Apple team, Run / Archive | App Store / TestFlight |

## Android
- Install: copy `Darwaza.apk` to the phone and open it; allow "install unknown apps" for the browser or file manager once.
- Photo upload, printing / save as PDF (grade card), the back button and links to other sites (they open in the browser) work.
- **Signing key:** `darwaza-release.jks` and its password are **not** in this repository. Keep them safe: every future
  update must be signed with the same key, or phones will refuse to update (users would have to uninstall first).
- For Google Play, upload the same APK (or build an AAB) with this key.

## Windows
- `Darwaza.exe` is a single file (no installer). Copy it anywhere (e.g. the Desktop) and double-click.
- Uses Microsoft Edge WebView2, which is part of Windows 10/11. If it is missing, the app offers Microsoft's download page.
- The file is not code-signed, so Windows SmartScreen may show "Windows protected your PC": choose *More info → Run anyway*.
  A code-signing certificate removes this warning.

## iPhone / iPad
- iOS apps can only be built on a Mac with Xcode and installed through an Apple Developer account (TestFlight / App Store).
- Until then: open the system in **Safari → Share → Add to Home Screen**. It installs with the Darwaza icon and opens full screen.
