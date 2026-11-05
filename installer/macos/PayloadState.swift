import Foundation

enum AppPhase: Equatable {
    case needsInstall
    case applying
    case ready
    case failed(String)
}

struct PayloadReceipt: Codable, Equatable {
    let version: String
    let fingerprint: String
    let profiles: [String]
}

enum PayloadState {
    static func compareVersions(_ lhs: String, _ rhs: String) throws -> ComparisonResult {
        func parts(_ version: String) throws -> [String] {
            let values = version.split(separator: ".", omittingEmptySubsequences: false)
            guard !values.isEmpty, values.allSatisfy({ !$0.isEmpty && $0.allSatisfy({ $0 >= "0" && $0 <= "9" }) }) else {
                throw failure("앱 버전이 올바른 숫자 버전이 아닙니다.")
            }
            return values.map { let digits = $0.drop(while: { $0 == "0" }); return digits.isEmpty ? "0" : String(digits) }
        }
        let left = try parts(lhs), right = try parts(rhs)
        for index in 0..<max(left.count, right.count) {
            let a = index < left.count ? left[index] : "0"
            let b = index < right.count ? right[index] : "0"
            if a.count != b.count { return a.count < b.count ? .orderedAscending : .orderedDescending }
            if a != b { return a < b ? .orderedAscending : .orderedDescending }
        }
        return .orderedSame
    }

    static func isCurrent(_ receipt: PayloadReceipt?, desired: PayloadReceipt) throws -> Bool {
        guard let receipt else { return false }
        guard try compareVersions(desired.version, receipt.version) != .orderedAscending else {
            throw failure("더 최신 버전의 페이로드가 설치되어 있습니다. 다운그레이드하지 않습니다.")
        }
        return receipt.fingerprint == desired.fingerprint && receipt.profiles.sorted() == desired.profiles.sorted()
    }

    static func numericProfiles(at directory: URL) throws -> [String] {
        try refuseSymlinks(at: directory)
        let entries = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        let profiles = try entries.filter { entry in
            let name = entry.lastPathComponent
            guard !name.isEmpty, name.allSatisfy({ $0 >= "0" && $0 <= "9" }) else { return false }
            let values = try entry.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            guard values.isSymbolicLink != true, values.isDirectory == true else { throw failure("프로필 경로가 안전하지 않습니다.") }
            return true
        }.map(\.lastPathComponent).sorted()
        guard !profiles.isEmpty else { throw failure("Aside를 먼저 설치하고 로그인하세요.") }
        return profiles
    }

    static func read(from url: URL) throws -> PayloadReceipt? {
        try refuseSymlinks(at: url)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try JSONDecoder().decode(PayloadReceipt.self, from: Data(contentsOf: url))
    }

    static func recordSuccess(_ receipt: PayloadReceipt, at url: URL, exitCode: Int32, output: String) throws {
        guard exitCode == 0, output.components(separatedBy: .newlines).contains("AAC_INSTALL_COMPLETE") else {
            throw failure("페이로드 설치가 완료되지 않았습니다. 기록을 확인하고 다시 시도하세요.")
        }
        try refuseSymlinks(at: url)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(receipt).write(to: url, options: .atomic)
    }

    static func refuseSymlinks(at url: URL) throws {
        var current = url.standardizedFileURL
        while current.path != "/" {
            if let kind = try? FileManager.default.attributesOfItem(atPath: current.path)[.type], kind as? FileAttributeType == .typeSymbolicLink {
                throw failure("심볼릭 링크 경로는 지원하지 않습니다: \(current.path)")
            }
            current.deleteLastPathComponent()
        }
    }

    static func failure(_ message: String) -> NSError {
        NSError(domain: "AsideAutomationCreator", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}

struct LaunchUpdateCheck {
    enum State { case idle, checking, updateFound, finished }
    private(set) var state = State.idle
    mutating func begin() -> Bool {
        guard state == .idle else { return false }
        state = .checking
        return true
    }
    mutating func foundUpdate() { if state == .checking { state = .updateFound } }
    mutating func finish(failed: Bool) -> Bool {
        let recommend = state == .updateFound && !failed
        state = .finished
        return recommend
    }
}
