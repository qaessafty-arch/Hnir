package main

import (
	"syscall"
	"unsafe"
)

// showMissingRuntime explains what to do when the WebView2 runtime is not installed (rare on Windows 10/11).
func showMissingRuntime() {
	user32 := syscall.NewLazyDLL("user32.dll")
	box := user32.NewProc("MessageBoxW")
	shell := syscall.NewLazyDLL("shell32.dll")
	open := shell.NewProc("ShellExecuteW")
	text, _ := syscall.UTF16PtrFromString("Darwaza needs the Microsoft Edge WebView2 Runtime, which is missing on this computer.\n\nPress OK to open the free download page from Microsoft, install it, then start Darwaza again.")
	title, _ := syscall.UTF16PtrFromString("Darwaza Private School")
	r, _, _ := box.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), 0x41) // MB_OKCANCEL | MB_ICONINFORMATION
	if r == 1 {
		verb, _ := syscall.UTF16PtrFromString("open")
		url, _ := syscall.UTF16PtrFromString("https://developer.microsoft.com/microsoft-edge/webview2/#download")
		open.Call(0, uintptr(unsafe.Pointer(verb)), uintptr(unsafe.Pointer(url)), 0, 0, 1)
	}
}
