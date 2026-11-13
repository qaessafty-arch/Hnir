// Darwaza Private School — Windows desktop app.
// A small native window (Microsoft Edge WebView2, built into Windows 10/11) that opens the school system.
// It stores no grades or passwords itself; everything stays on the school's server.
package main

import (
	"os"
	"path/filepath"

	webview2 "github.com/jchv/go-webview2"
)

// SchoolURL is the address of the Darwaza server. Change it (or build with
// -ldflags "-X main.SchoolURL=https://your-school-domain") when the school moves to its own domain.
var SchoolURL = "https://darwaza-test.vercel.app/"

func main() {
	data := filepath.Join(os.Getenv("LOCALAPPDATA"), "Darwaza School")
	_ = os.MkdirAll(data, 0o700)
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false,
		AutoFocus: true,
		DataPath:  data,
		WindowOptions: webview2.WindowOptions{
			Title:  "Darwaza Private School",
			Width:  1280,
			Height: 820,
			IconId: 2,
			Center: true,
		},
	})
	if w == nil {
		showMissingRuntime()
		return
	}
	defer w.Destroy()
	w.SetSize(1280, 820, webview2.HintNone)
	w.Navigate(SchoolURL)
	w.Run()
}
