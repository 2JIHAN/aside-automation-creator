import AppKit

final class Installer: NSObject, NSApplicationDelegate {
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 430), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
    let button = NSButton(title: "설치", target: nil, action: nil)
    let status = NSTextField(labelWithString: "현재 사용자의 Aside 프로필에 설치합니다.")
    let progress = NSProgressIndicator()
    let log = NSTextView()
    var running = false
    func applicationDidFinishLaunching(_ notification: Notification) {
        window.title = "Aside Automation Creator 설치"
        window.center()
        let content = window.contentView!
        let heading = NSTextField(labelWithString: "Aside Automation Creator")
        heading.font = .boldSystemFont(ofSize: 23)
        heading.frame = NSRect(x: 24, y: 365, width: 550, height: 34)
        content.addSubview(heading)
        status.frame = NSRect(x: 24, y: 320, width: 550, height: 30)
        content.addSubview(status)
        progress.frame = NSRect(x: 24, y: 295, width: 552, height: 12)
        progress.style = .bar
        progress.isIndeterminate = true
        content.addSubview(progress)
        let scroll = NSScrollView(frame: NSRect(x: 24, y: 82, width: 552, height: 195))
        scroll.hasVerticalScroller = true
        log.isEditable = false
        log.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        log.autoresizingMask = [.width]
        scroll.documentView = log
        content.addSubview(scroll)
        button.frame = NSRect(x: 466, y: 24, width: 110, height: 34)
        button.bezelStyle = .rounded
        button.target = self
        button.action = #selector(install)
        content.addSubview(button)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        if CommandLine.arguments.contains("--smoke-test") {
            guard ProcessInfo.processInfo.environment["AAC_INSTALLER_FIXTURE"] == "1" else { NSApp.terminate(nil); return }
            install()
        }
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply { running ? .terminateCancel : .terminateNow }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    @objc func install() {
        guard !running else { return }
        if button.title == "닫기" { NSApp.terminate(nil); return }
        running = true
        button.isEnabled = false
        window.standardWindowButton(.closeButton)?.isEnabled = false
        status.stringValue = "설치 중입니다. 잠시 기다려 주세요."
        progress.startAnimation(nil)
        let resources = Bundle.main.resourceURL!
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [resources.appendingPathComponent("bootstrap.sh").path, resources.path]
        var environment = ProcessInfo.processInfo.environment
        if environment["AAC_INSTALLER_FIXTURE"] != "1" {
            environment["HOME"] = NSHomeDirectory()
            environment.removeValue(forKey: "ASIDE_HOME")
            environment.removeValue(forKey: "ASIDE_AUTOMATION_CREATOR_REPO")
        }
        process.environment = environment
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        DispatchQueue.global(qos: .userInitiated).async {
            var output = ""
            var code: Int32 = 1
            do {
                try process.run()
                while true {
                    let data = pipe.fileHandleForReading.availableData
                    if data.isEmpty { break }
                    let text = String(decoding: data, as: UTF8.self)
                    output += text
                    DispatchQueue.main.async { self.log.textStorage?.append(NSAttributedString(string: text)); self.log.scrollToEndOfDocument(nil) }
                }
                process.waitUntilExit()
                code = process.terminationStatus
            } catch { output += error.localizedDescription }
            let succeeded = code == 0 && output.components(separatedBy: .newlines).contains("AAC_INSTALL_COMPLETE")
            DispatchQueue.main.async {
                self.running = false
                self.progress.stopAnimation(nil)
                self.status.stringValue = succeeded ? "설치 완료. 새 Aside 채팅에서 사용하세요." : "설치하지 못했습니다. 아래 기록을 확인하세요."
                self.button.title = succeeded ? "닫기" : "설치"
                self.button.isEnabled = true
                self.window.standardWindowButton(.closeButton)?.isEnabled = true
                if CommandLine.arguments.contains("--smoke-test") { exit(succeeded ? 0 : 1) }
                let alert = NSAlert()
                alert.messageText = succeeded ? "설치 완료" : "설치 실패"
                alert.informativeText = succeeded ? "스킬과 공용 엔진 설치를 확인했습니다. 새 Aside 채팅을 열어 주세요." : "설치 기록을 확인하고 다시 시도하세요. 기존 로그인이나 예약 실행은 변경하지 않습니다."
                alert.alertStyle = succeeded ? .informational : .warning
                alert.beginSheetModal(for: self.window)
            }
        }
    }
}
let app = NSApplication.shared
let delegate = Installer()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
