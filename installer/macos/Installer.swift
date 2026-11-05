import AppKit
import ServiceManagement
import Sparkle

final class Installer: NSObject, NSApplicationDelegate, SPUUpdaterDelegate, SPUStandardUserDriverDelegate {
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 430), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
    let button = NSButton(title: "설치", target: nil, action: nil)
    let status = NSTextField(labelWithString: "현재 사용자의 Aside 프로필에 설치합니다.")
    let progress = NSProgressIndicator()
    let log = NSTextView()
    let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let showMenuOption = NSButton(checkboxWithTitle: "메뉴 막대에 표시", target: nil, action: nil)
    let automaticUpdateOption = NSButton(checkboxWithTitle: "자동 다운로드 및 설치", target: nil, action: nil)
    var launchUpdateCheck = LaunchUpdateCheck()
    let fixture = ProcessInfo.processInfo.environment["AAC_INSTALLER_FIXTURE"] == "1"
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0.0.0"
    var phase = AppPhase.needsInstall
    var controller: SPUStandardUpdaterController?
    var updateAvailable = false
    var resumeUpdate: (() -> Void)?
    var adopting = false
    var applying: Bool { phase == .applying }
    var home: URL {
        URL(fileURLWithPath: fixture ? (ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory()) : NSHomeDirectory())
    }
    var canonical: URL { home.appendingPathComponent("Applications/Aside Automation Creator.app") }
    var receiptURL: URL { home.appendingPathComponent("Library/Application Support/Aside Automation Creator/payload-receipt.json") }
    var isCanonical: Bool {
        guard Bundle.main.bundleURL.standardizedFileURL == canonical.standardizedFileURL else { return false }
        return (try? PayloadState.refuseSymlinks(at: canonical)) != nil
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        UserDefaults.standard.register(defaults: ["AACShowMenuBarIcon": true])
        window.title = "Aside Automation Creator"
        window.isReleasedWhenClosed = false
        window.center()
        let content = window.contentView!
        let heading = NSTextField(labelWithString: "Aside Automation Creator")
        heading.font = .boldSystemFont(ofSize: 23)
        heading.frame = NSRect(x: 24, y: 365, width: 550, height: 34)
        content.addSubview(heading)
        status.frame = NSRect(x: 24, y: 315, width: 550, height: 45)
        status.maximumNumberOfLines = 2
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
        button.frame = NSRect(x: 416, y: 24, width: 160, height: 34)
        button.bezelStyle = .rounded
        button.target = self
        button.action = #selector(install)
        content.addSubview(button)
        showMenuOption.frame = NSRect(x: 24, y: 50, width: 210, height: 24)
        showMenuOption.target = self
        showMenuOption.action = #selector(toggleMenuVisibility)
        content.addSubview(showMenuOption)
        automaticUpdateOption.frame = NSRect(x: 24, y: 22, width: 260, height: 24)
        automaticUpdateOption.target = self
        automaticUpdateOption.action = #selector(toggleDownloads)
        content.addSubview(automaticUpdateOption)
        refresh()
        if CommandLine.arguments.contains("--smoke-test") && !fixture { NSApp.terminate(nil); return }
        if fixture { applyPayload(); return }
        guard isCanonical else {
            button.title = FileManager.default.fileExists(atPath: canonical.path) ? "기존 앱 열기" : "앱 설치"
            showLog()
            return
        }
        do {
            if try PayloadState.isCurrent(PayloadState.read(from: receiptURL), desired: desiredReceipt()) {
                phase = .ready
                becameReady()
            } else { applyPayload() }
        } catch { fail(error) }
    }

    func desiredReceipt() throws -> PayloadReceipt {
        guard let resources = Bundle.main.resourceURL else { throw PayloadState.failure("앱 리소스가 없습니다.") }
        let manifest = resources.appendingPathComponent("payload-fingerprint.txt")
        let fingerprint: String
        if fixture && !FileManager.default.fileExists(atPath: manifest.path) { fingerprint = "fixture" }
        else { fingerprint = try String(contentsOf: manifest, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines) }
        guard !fingerprint.isEmpty else { throw PayloadState.failure("페이로드 지문이 없습니다.") }
        return try PayloadReceipt(version: version, fingerprint: fingerprint, profiles: PayloadState.numericProfiles(at: home.appendingPathComponent(".aside/u")))
    }

    func refresh() {
        let text: String
        switch phase {
        case .needsInstall: text = "앱 설치 필요"
        case .applying: text = "변경 파일 확인 및 적용 중"
        case .ready: text = "엔진과 제작 스킬 최신 상태"
        case .failed(let message): text = "오류: \(message)"
        }
        status.stringValue = text
        statusItem.button?.image = NSImage(systemSymbolName: updateAvailable ? "arrow.down.circle.fill" : "gearshape", accessibilityDescription: updateAvailable ? "업데이트 있음" : "Aside Automation Creator")
        statusItem.button?.title = updateAvailable ? " 업데이트 있음" : ""
        statusItem.button?.toolTip = text
        statusItem.isVisible = UserDefaults.standard.bool(forKey: "AACShowMenuBarIcon")
        showMenuOption.state = statusItem.isVisible ? .on : .off
        automaticUpdateOption.state = controller?.updater.automaticallyDownloadsUpdates == true ? .on : .off
        automaticUpdateOption.isEnabled = controller != nil
        let menu = NSMenu()
        menu.autoenablesItems = false
        func add(_ title: String, _ action: Selector?, enabled: Bool = true, checked: Bool = false) {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
            item.target = self
            item.isEnabled = enabled
            item.state = checked ? .on : .off
            menu.addItem(item)
        }
        add("Aside Automation Creator \(version)", nil, enabled: false)
        add(text, #selector(showLog))
        menu.addItem(.separator())
        add(updateAvailable ? "업데이트 있음" : "업데이트 확인…", #selector(checkUpdates), enabled: controller != nil && !applying && !adopting)
        add("자동 업데이트 확인", #selector(toggleChecks), enabled: controller != nil, checked: controller?.updater.automaticallyChecksForUpdates ?? true)
        add("자동 다운로드 및 설치", #selector(toggleDownloads), enabled: controller != nil, checked: controller?.updater.automaticallyDownloadsUpdates ?? false)
        add("로그인 시 실행", #selector(toggleLogin), enabled: !fixture && isCanonical && phase == .ready, checked: !fixture && SMAppService.mainApp.status == .enabled)
        menu.addItem(.separator())
        add(isCanonical ? "엔진과 스킬 다시 확인 / 복구" : "앱 설치 / 기존 앱 열기", #selector(install), enabled: !applying && !adopting)
        add("메뉴 막대에 표시", #selector(toggleMenuVisibility), checked: statusItem.isVisible)
        add("설정과 설치 기록 보기", #selector(showLog))
        add("종료", #selector(quit), enabled: !applying && !adopting)
        statusItem.menu = menu
    }

    @objc func showLog() { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    @objc func quit() { NSApp.terminate(nil) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply { applying || adopting ? .terminateCancel : .terminateNow }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showLog(); return true }
    @objc func install() {
        guard !applying && !adopting else { return }
        if phase == .ready { applyPayload(); return }
        if fixture || isCanonical { applyPayload() } else { adoptApp() }
    }

    func applyPayload() {
        guard !applying && (fixture || isCanonical) else { return }
        do {
            let desired = try desiredReceipt()
            _ = try PayloadState.isCurrent(PayloadState.read(from: receiptURL), desired: desired)
            phase = .applying
            button.isEnabled = false
            progress.startAnimation(nil)
            refresh()
            let resources = Bundle.main.resourceURL!
            runScript(resources.appendingPathComponent("bootstrap.sh"), arguments: [resources.path]) { code, output in
                do {
                    guard try self.desiredReceipt() == desired else { throw PayloadState.failure("설치 중 프로필이나 페이로드가 변경되었습니다. 다시 적용하세요.") }
                    try PayloadState.recordSuccess(desired, at: self.receiptURL, exitCode: code, output: output)
                    self.phase = .ready
                    self.becameReady()
                } catch { self.fail(error) }
                self.progress.stopAnimation(nil)
                self.button.isEnabled = true
                self.button.title = self.phase == .ready ? "다시 적용" : "다시 시도"
                if self.fixture && CommandLine.arguments.contains("--smoke-test") { exit(self.phase == .ready ? 0 : 1) }
                let resume = self.resumeUpdate
                self.resumeUpdate = nil
                resume?()
            }
        } catch {
            fail(error)
            if fixture && CommandLine.arguments.contains("--smoke-test") { exit(1) }
        }
    }

    func runScript(_ script: URL, arguments: [String], completion: @escaping (Int32, String) -> Void) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [script.path] + arguments
        var environment = ProcessInfo.processInfo.environment
        if !fixture {
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
            let resultCode = code, resultOutput = output
            DispatchQueue.main.async { completion(resultCode, resultOutput) }
        }
    }

    func adoptApp() {
        guard !fixture, let resources = Bundle.main.resourceURL else { return }
        adopting = true
        button.isEnabled = false
        refresh()
        runScript(resources.appendingPathComponent("adopt-app.sh"), arguments: [Bundle.main.bundlePath]) { code, output in
            self.adopting = false
            self.button.isEnabled = true
            do {
                guard code == 0, output.components(separatedBy: .newlines).contains("AAC_APP_PATH=\(self.canonical.path)") else { throw PayloadState.failure("앱을 설치하지 못했습니다. 기존 앱을 덮어쓰지 않습니다.") }
                try PayloadState.refuseSymlinks(at: self.canonical)
                let configuration = NSWorkspace.OpenConfiguration()
                configuration.createsNewApplicationInstance = !NSRunningApplication.runningApplications(withBundleIdentifier: "com.tamcut.aside-automation-creator").contains { $0.bundleURL?.standardizedFileURL == self.canonical.standardizedFileURL }
                NSWorkspace.shared.openApplication(at: self.canonical, configuration: configuration) { _, error in
                    DispatchQueue.main.async {
                        if let error { self.fail(error) } else { NSApp.terminate(nil) }
                    }
                }
            } catch { self.fail(error) }
        }
    }

    func becameReady() {
        if !fixture && isCanonical {
            if controller == nil {
                UserDefaults.standard.register(defaults: ["SUEnableAutomaticChecks": true, "SUAutomaticallyUpdate": true])
                controller = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: self, userDriverDelegate: self)
                controller?.updater.automaticallyChecksForUpdates = UserDefaults.standard.bool(forKey: "SUEnableAutomaticChecks")
                controller?.updater.automaticallyDownloadsUpdates = UserDefaults.standard.bool(forKey: "SUAutomaticallyUpdate")
                controller?.startUpdater()
                if controller?.updater.automaticallyChecksForUpdates == true, launchUpdateCheck.begin() {
                    controller?.updater.checkForUpdateInformation()
                }
            }
            if !UserDefaults.standard.bool(forKey: "AACLoginRegistrationAttempted") {
                UserDefaults.standard.set(true, forKey: "AACLoginRegistrationAttempted")
                do { try SMAppService.mainApp.register() } catch { log.textStorage?.append(NSAttributedString(string: "\n로그인 시 실행 등록 실패: \(error.localizedDescription)\n")) }
            }
        }
        refresh()
    }

    func fail(_ error: Error) {
        phase = .failed(error.localizedDescription)
        log.textStorage?.append(NSAttributedString(string: "\n\(error.localizedDescription)\n"))
        button.title = "다시 시도"
        button.isEnabled = true
        refresh()
        showLog()
    }

    @objc func checkUpdates() { guard !applying else { return }; controller?.checkForUpdates(nil) }
    @objc func toggleMenuVisibility() {
        UserDefaults.standard.set(!UserDefaults.standard.bool(forKey: "AACShowMenuBarIcon"), forKey: "AACShowMenuBarIcon")
        refresh()
    }
    @objc func toggleChecks() {
        guard let updater = controller?.updater else { return }
        updater.automaticallyChecksForUpdates.toggle()
        refresh()
    }
    @objc func toggleDownloads() {
        guard let updater = controller?.updater else { return }
        updater.automaticallyDownloadsUpdates.toggle()
        refresh()
    }
    @objc func toggleLogin() {
        guard !fixture, isCanonical, phase == .ready else { return }
        do {
            if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() }
            else if SMAppService.mainApp.status == .requiresApproval { SMAppService.openSystemSettingsLoginItems() }
            else { try SMAppService.mainApp.register() }
            UserDefaults.standard.set(true, forKey: "AACLoginRegistrationAttempted")
            refresh()
        } catch { log.textStorage?.append(NSAttributedString(string: "\n로그인 시 실행 설정 실패: \(error.localizedDescription)\n")); showLog() }
    }

    func updater(_ updater: SPUUpdater, didFindValidUpdate item: SUAppcastItem) {
        launchUpdateCheck.foundUpdate()
    }
    func updater(_ updater: SPUUpdater, didFinishUpdateCycleFor updateCheck: SPUUpdateCheck, error: Error?) {
        guard updateCheck == .updateInformation else { refresh(); return }
        let recommend = launchUpdateCheck.finish(failed: error != nil)
        refresh()
        if recommend {
            DispatchQueue.main.async { [weak self] in
                guard let self, self.phase == .ready, !self.adopting else { return }
                self.controller?.checkForUpdates(nil)
            }
        }
    }

    var supportsGentleScheduledUpdateReminders: Bool { true }
    func standardUserDriverShouldHandleShowingScheduledUpdate(_ update: SUAppcastItem, andInImmediateFocus immediateFocus: Bool) -> Bool { false }
    func standardUserDriverWillHandleShowingUpdate(_ handleShowingUpdate: Bool, forUpdate update: SUAppcastItem, state: SPUUserUpdateState) {
        updateAvailable = true
        refresh()
    }
    func standardUserDriverWillFinishUpdateSession() { updateAvailable = false; refresh() }
    func updater(_ updater: SPUUpdater, mayPerform updateCheck: SPUUpdateCheck) throws {
        if applying || adopting { throw PayloadState.failure("페이로드 적용이 끝난 후 업데이트할 수 있습니다.") }
    }
    func updater(_ updater: SPUUpdater, shouldPostponeRelaunchForUpdate item: SUAppcastItem, untilInvokingBlock installHandler: @escaping () -> Void) -> Bool {
        guard applying else { return false }
        resumeUpdate = installHandler
        return true
    }
}

@main
enum Launcher {
    static func main() {
        let app = NSApplication.shared
        let delegate = Installer()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        withExtendedLifetime(delegate) { app.run() }
    }
}
