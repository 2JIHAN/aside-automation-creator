import AppKit
import ServiceManagement
import Sparkle

final class Installer: NSObject, NSApplicationDelegate, SPUUpdaterDelegate, SPUStandardUserDriverDelegate {
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 390), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
    let button = NSButton(title: "설치", target: nil, action: nil)
    let status = NSTextField(labelWithString: "현재 사용자의 Aside 프로필에 설치합니다.")
    let progress = NSProgressIndicator()
    let log = NSTextView()
    var logWindow: NSWindow?
    let stateIcon = NSImageView()
    let loginOption = NSButton(checkboxWithTitle: "로그인 시 실행", target: nil, action: nil)
    let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let showMenuOption = NSButton(checkboxWithTitle: "메뉴 막대에 표시", target: nil, action: nil)
    let automaticUpdateOption = NSButton(checkboxWithTitle: "자동 다운로드 및 설치", target: nil, action: nil)
    var launchUpdateCheck = LaunchUpdateCheck()
    var updateReadinessObservation: NSKeyValueObservation?
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
        let icon = NSImageView(frame: NSRect(x: 24, y: 326, width: 40, height: 40))
        icon.image = NSApp.applicationIconImage
        content.addSubview(icon)
        let heading = NSTextField(labelWithString: "Aside Automation Creator")
        heading.font = .systemFont(ofSize: 18, weight: .semibold)
        heading.frame = NSRect(x: 76, y: 344, width: 420, height: 24)
        content.addSubview(heading)
        let caption = NSTextField(labelWithString: "버전 \(version)")
        caption.font = .systemFont(ofSize: 12)
        caption.textColor = .secondaryLabelColor
        caption.frame = NSRect(x: 76, y: 326, width: 420, height: 18)
        content.addSubview(caption)
        for frame in [NSRect(x: 24, y: 264, width: 472, height: 52), NSRect(x: 24, y: 96, width: 472, height: 152)] {
            let box = NSBox(frame: frame)
            box.boxType = .custom
            box.title = ""
            box.titlePosition = .noTitle
            box.borderColor = .separatorColor
            box.fillColor = .controlBackgroundColor
            box.cornerRadius = 10
            content.addSubview(box)
        }
        stateIcon.frame = NSRect(x: 40, y: 282, width: 16, height: 16)
        content.addSubview(stateIcon)
        status.font = .systemFont(ofSize: 13, weight: .medium)
        status.frame = NSRect(x: 66, y: 280, width: 256, height: 20)
        status.lineBreakMode = .byTruncatingTail
        content.addSubview(status)
        progress.frame = stateIcon.frame
        progress.style = .spinning
        progress.controlSize = .small
        progress.isIndeterminate = true
        progress.isDisplayedWhenStopped = false
        progress.isHidden = true
        content.addSubview(progress)
        button.frame = NSRect(x: 330, y: 275, width: 154, height: 32)
        button.bezelStyle = .rounded
        button.target = self
        content.addSubview(button)
        let rows: [(NSButton, CGFloat, String, Selector)] = [
            (automaticUpdateOption, 216, "새 버전을 자동으로 다운로드하고 설치합니다.", #selector(toggleDownloads)),
            (loginOption, 169, "Mac에 로그인하면 백그라운드에서 실행합니다.", #selector(toggleLogin)),
            (showMenuOption, 122, "메뉴 막대에서 상태와 설정에 빠르게 접근합니다.", #selector(toggleMenuVisibility))
        ]
        for (option, y, subtitle, action) in rows {
            option.font = .systemFont(ofSize: 13)
            option.frame = NSRect(x: 40, y: y, width: 436, height: 22)
            option.target = self
            option.action = action
            content.addSubview(option)
            let detail = NSTextField(labelWithString: subtitle)
            detail.font = .systemFont(ofSize: 11)
            detail.textColor = .secondaryLabelColor
            detail.frame = NSRect(x: 60, y: y - 18, width: 420, height: 17)
            content.addSubview(detail)
        }
        let records = NSButton(title: "설치 기록…", target: self, action: #selector(showLog))
        records.bezelStyle = .rounded
        records.frame = NSRect(x: 20, y: 48, width: 102, height: 28)
        content.addSubview(records)
        let note = NSTextField(labelWithString: "메뉴를 숨겨도 Finder나 Spotlight에서 앱을 열어 설정할 수 있습니다.")
        note.font = .systemFont(ofSize: 11)
        note.textColor = .secondaryLabelColor
        note.frame = NSRect(x: 24, y: 24, width: 472, height: 17)
        content.addSubview(note)
        log.isEditable = false
        log.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        refresh()
        if CommandLine.arguments.contains("--smoke-test") && !fixture { NSApp.terminate(nil); return }
        if fixture { applyPayload(); return }
        guard isCanonical else {
            showSettings()
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
        case .ready: text = updateAvailable ? "업데이트가 있습니다" : "정상 실행 중"
        case .failed(let message): text = "오류: \(message)"
        }
        status.stringValue = adopting ? "앱 설치 중" : text
        switch phase {
        case .needsInstall:
            button.title = adopting ? "설치 중…" : "앱 설치"
            button.action = #selector(install)
        case .applying:
            button.title = "적용 중…"
            button.action = #selector(install)
        case .ready:
            button.title = "업데이트 확인…"
            button.action = #selector(checkUpdates)
        case .failed:
            button.title = "다시 시도"
            button.action = #selector(install)
        }
        button.isEnabled = !applying && !adopting && (phase != .ready || controller != nil)
        progress.isHidden = !applying
        if applying { progress.startAnimation(nil) } else { progress.stopAnimation(nil) }
        stateIcon.isHidden = applying
        stateIcon.image = NSImage(systemSymbolName: phase == .ready ? "checkmark.circle.fill" : "info.circle", accessibilityDescription: status.stringValue)
        stateIcon.contentTintColor = phase == .ready ? .systemGreen : .secondaryLabelColor
        loginOption.state = !fixture && SMAppService.mainApp.status == .enabled ? .on : .off
        loginOption.isEnabled = !fixture && isCanonical && phase == .ready
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
        add(text, #selector(showSettings))
        menu.addItem(.separator())
        add(updateAvailable ? "업데이트 있음" : "업데이트 확인…", #selector(checkUpdates), enabled: controller != nil && !applying && !adopting)
        add("자동 업데이트 확인", #selector(toggleChecks), enabled: controller != nil, checked: controller?.updater.automaticallyChecksForUpdates ?? true)
        add("자동 다운로드 및 설치", #selector(toggleDownloads), enabled: controller != nil, checked: controller?.updater.automaticallyDownloadsUpdates ?? false)
        add("로그인 시 실행", #selector(toggleLogin), enabled: !fixture && isCanonical && phase == .ready, checked: !fixture && SMAppService.mainApp.status == .enabled)
        menu.addItem(.separator())
        add(isCanonical ? "엔진과 스킬 다시 확인 / 복구" : "앱 설치 / 기존 앱 열기", #selector(install), enabled: !applying && !adopting)
        add("메뉴 막대에 표시", #selector(toggleMenuVisibility), checked: statusItem.isVisible)
        add("설정…", #selector(showSettings))
        add("설치 기록…", #selector(showLog))
        add("종료", #selector(quit), enabled: !applying && !adopting)
        logWindow?.contentView?.subviews.compactMap { $0 as? NSButton }.forEach { $0.isEnabled = !applying && !adopting }
        statusItem.menu = menu
    }

    @objc func showSettings() {
        refresh()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    @objc func showLog() {
        if logWindow == nil {
            let records = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 400), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            records.title = "설치 기록"
            records.isReleasedWhenClosed = false
            records.center()
            let scroll = NSScrollView(frame: NSRect(x: 16, y: 58, width: 568, height: 326))
            scroll.autoresizingMask = [.width, .height]
            scroll.hasVerticalScroller = true
            log.frame = scroll.contentView.bounds
            log.autoresizingMask = [.width]
            log.isVerticallyResizable = true
            log.textContainer?.widthTracksTextView = true
            scroll.documentView = log
            records.contentView?.addSubview(scroll)
            let repair = NSButton(title: "엔진과 스킬 다시 확인", target: self, action: #selector(install))
            repair.bezelStyle = .rounded
            repair.frame = NSRect(x: 16, y: 16, width: 190, height: 30)
            repair.isEnabled = !applying && !adopting
            records.contentView?.addSubview(repair)
            logWindow = records
        }
        logWindow?.contentView?.subviews.compactMap { $0 as? NSButton }.forEach { $0.isEnabled = !applying && !adopting }
        logWindow?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    @objc func quit() { NSApp.terminate(nil) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply { applying || adopting ? .terminateCancel : .terminateNow }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showSettings(); return true }
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
            refresh()
            let resources = Bundle.main.resourceURL!
            runScript(resources.appendingPathComponent("bootstrap.sh"), arguments: [resources.path]) { code, output in
                do {
                    guard try self.desiredReceipt() == desired else { throw PayloadState.failure("설치 중 프로필이나 페이로드가 변경되었습니다. 다시 적용하세요.") }
                    try PayloadState.recordSuccess(desired, at: self.receiptURL, exitCode: code, output: output)
                    self.phase = .ready
                    self.becameReady()
                } catch { self.fail(error) }
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
        refresh()
        runScript(resources.appendingPathComponent("adopt-app.sh"), arguments: [Bundle.main.bundlePath]) { code, output in
            self.adopting = false
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
        refresh()
        showSettings()
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
        } catch { log.textStorage?.append(NSAttributedString(string: "\n로그인 시 실행 설정 실패: \(error.localizedDescription)\n")); showSettings() }
    }

    func updater(_ updater: SPUUpdater, didFindValidUpdate item: SUAppcastItem) {
        launchUpdateCheck.foundUpdate()
    }
    func updater(_ updater: SPUUpdater, didFinishUpdateCycleFor updateCheck: SPUUpdateCheck, error: Error?) {
        guard updateCheck == .updateInformation else { refresh(); return }
        let recommend = launchUpdateCheck.finish(failed: error != nil)
        refresh()
        if recommend {
            updateReadinessObservation?.invalidate()
            updateReadinessObservation = updater.observe(\.canCheckForUpdates, options: [.initial, .new]) { [weak self] updater, _ in
                guard updater.canCheckForUpdates else { return }
                DispatchQueue.main.async { [weak self] in
                    guard let self, self.phase == .ready, !self.adopting, updater.canCheckForUpdates else { return }
                    self.updateReadinessObservation?.invalidate()
                    self.updateReadinessObservation = nil
                    self.controller?.checkForUpdates(nil)
                }
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
