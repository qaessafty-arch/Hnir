import SwiftUI
import WebKit

/// Darwaza Private School for iPhone and iPad: a full-screen window onto the school system.
/// Grades, codes and personal data stay on the school's server.
let schoolURL = URL(string: "https://darwaza-test.vercel.app/")! // change when the school has its own domain

@main
struct DarwazaApp: App {
    var body: some Scene {
        WindowGroup {
            SchoolView()
                .background(Color(red: 0.094, green: 0.169, blue: 0.325).ignoresSafeArea())
        }
    }
}

struct SchoolView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        // window.print() → the iOS print / save-as-PDF sheet.
        let script = WKUserScript(source: "window.print=function(){window.webkit.messageHandlers.print.postMessage(document.title||'Darwaza')};",
                                  injectionTime: .atDocumentEnd, forMainFrameOnly: true)
        config.userContentController.addUserScript(script)
        config.userContentController.add(context.coordinator, name: "print")
        let web = WKWebView(frame: .zero, configuration: config)
        web.allowsBackForwardNavigationGestures = true
        web.navigationDelegate = context.coordinator
        context.coordinator.web = web
        web.load(URLRequest(url: schoolURL))
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        weak var web: WKWebView?

        // Other websites open in Safari; only the school's own pages stay in the app.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if let url = action.request.url, url.host != schoolURL.host, url.scheme?.hasPrefix("http") == true {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "print", let web = web, web.url?.host == schoolURL.host else { return }
            let info = UIPrintInfo(dictionary: nil)
            info.jobName = (message.body as? String) ?? "Darwaza"
            info.outputType = .general
            let pc = UIPrintInteractionController.shared
            pc.printInfo = info
            pc.printFormatter = web.viewPrintFormatter()
            pc.present(animated: true)
        }
    }
}
