import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function clearQuarantine(file) {
  const attrs = spawnSync('/usr/bin/xattr', [file], { encoding: 'utf8' });
  assert.equal(attrs.status, 0, attrs.stderr);
  if (attrs.stdout.split('\n').includes('com.apple.quarantine')) {
    const result = spawnSync('/usr/bin/xattr', ['-d', 'com.apple.quarantine', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const verified = spawnSync('/usr/bin/xattr', [file], { encoding: 'utf8' });
  assert.equal(verified.status, 0, verified.stderr);
  assert.ok(!verified.stdout.split('\n').includes('com.apple.quarantine'));
}
const policy = resolve(import.meta.dirname, '../installer/macos/PayloadState.swift');

test('payload receipts protect freshness and commit only confirmed successful installs', { skip: process.platform !== 'darwin' }, t => {
  const directory = realpathSync(mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'aac-app-state-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const runner = join(directory, 'main.swift');
  const executable = join(directory, 'policy-tests');
  writeFileSync(runner, `
import Foundation
let root = URL(fileURLWithPath: CommandLine.arguments[1])
let receiptURL = root.appendingPathComponent("state/receipt.json")
let current = PayloadReceipt(version: "1.10.0", fingerprint: "signed-manifest", profiles: ["0", "12"])
func check(_ value: Bool, _ message: String) { if !value { fatalError(message) } }
func rejects(_ message: String, _ operation: () throws -> Void) {
    do { try operation() } catch { return }
    fatalError(message)
}
check(try !PayloadState.isCurrent(nil, desired: current), "missing receipt must apply")
check(try PayloadState.isCurrent(current, desired: current), "matching receipt must not apply")
let reordered = PayloadReceipt(version: "1.10.0", fingerprint: "signed-manifest", profiles: ["12", "0"])
check(try PayloadState.isCurrent(current, desired: reordered), "profile order is irrelevant")
let profileChange = PayloadReceipt(version: "1.10.0", fingerprint: "signed-manifest", profiles: ["0", "13"])
check(try !PayloadState.isCurrent(current, desired: profileChange), "exact profiles matter")
let changed = PayloadReceipt(version: "1.10.0", fingerprint: "new-manifest", profiles: ["0", "12"])
check(try !PayloadState.isCurrent(current, desired: changed), "changed payload must apply")
let older = PayloadReceipt(version: "1.9.99", fingerprint: "signed-manifest", profiles: ["0", "12"])
rejects("downgrade must fail even when fingerprint matches") { _ = try PayloadState.isCurrent(current, desired: older) }
check(try PayloadState.compareVersions("1.10", "1.9") == .orderedDescending, "numeric comparison")
check(try PayloadState.compareVersions("01.002.0", "1.2") == .orderedSame, "numeric normalization")
check(try PayloadState.compareVersions("999999999999999999999999", "2") == .orderedDescending, "no integer overflow")
rejects("malformed version must fail closed") { _ = try PayloadState.compareVersions("1..2", "1.2") }
rejects("nonzero exit cannot create receipt") { try PayloadState.recordSuccess(current, at: receiptURL, exitCode: 1, output: "AAC_INSTALL_COMPLETE") }
check(!FileManager.default.fileExists(atPath: receiptURL.path), "failed install created receipt")
rejects("missing completion cannot create receipt") { try PayloadState.recordSuccess(current, at: receiptURL, exitCode: 0, output: "finished") }
rejects("partial marker cannot create receipt") { try PayloadState.recordSuccess(current, at: receiptURL, exitCode: 0, output: "AAC_INSTALL_COMPLETE extra") }
try PayloadState.recordSuccess(current, at: receiptURL, exitCode: 0, output: "log\\nAAC_INSTALL_COMPLETE\\n")
check(try PayloadState.read(from: receiptURL) == current, "successful receipt round trip")
let before = try Data(contentsOf: receiptURL)
rejects("failed apply cannot replace old receipt") { try PayloadState.recordSuccess(changed, at: receiptURL, exitCode: 7, output: "AAC_INSTALL_COMPLETE") }
check(try Data(contentsOf: receiptURL) == before, "failed apply modified old receipt")
let blocker = root.appendingPathComponent("not-a-directory")
try Data("keep".utf8).write(to: blocker)
rejects("receipt write errors must propagate") { try PayloadState.recordSuccess(current, at: blocker.appendingPathComponent("receipt"), exitCode: 0, output: "AAC_INSTALL_COMPLETE") }
check(try PayloadState.read(from: receiptURL) == current, "write failure changed existing receipt")
let profiles = root.appendingPathComponent("profiles")
try FileManager.default.createDirectory(at: profiles.appendingPathComponent("0"), withIntermediateDirectories: true)
try FileManager.default.createDirectory(at: profiles.appendingPathComponent("12"), withIntermediateDirectories: true)
try FileManager.default.createDirectory(at: profiles.appendingPathComponent("not-numeric"), withIntermediateDirectories: true)
check(try PayloadState.numericProfiles(at: profiles) == ["0", "12"], "only exact numeric directories are profiles")
let link = profiles.appendingPathComponent("3")
try FileManager.default.createSymbolicLink(at: link, withDestinationURL: root)
rejects("numeric symlink profile must fail") { _ = try PayloadState.numericProfiles(at: profiles) }
let receiptLink = root.appendingPathComponent("linked-receipt")
try FileManager.default.createSymbolicLink(at: receiptLink, withDestinationURL: receiptURL)
rejects("receipt symlink write must fail") { try PayloadState.recordSuccess(changed, at: receiptLink, exitCode: 0, output: "AAC_INSTALL_COMPLETE") }
check(try Data(contentsOf: receiptURL) == before, "symlink write changed receipt target")
var launch = LaunchUpdateCheck()
check(launch.begin(), "first launch check starts")
check(!launch.begin(), "launch check cannot start twice")
launch.foundUpdate()
check(launch.finish(failed: false), "outdated launch recommends update")
launch.foundUpdate()
check(!launch.finish(failed: false), "regular later checks cannot repeat launch prompt")
var latest = LaunchUpdateCheck()
check(latest.begin(), "latest app still checks")
check(!latest.finish(failed: false), "latest app has no launch popup")
var offline = LaunchUpdateCheck()
check(offline.begin(), "offline check starts")
offline.foundUpdate()
check(!offline.finish(failed: true), "failed launch check has no popup")
print("all payload policy checks passed")
`);
  clearQuarantine(runner);
  const compile = spawnSync('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', policy, runner, '-o', executable], { encoding: 'utf8' });
  assert.equal(compile.status, 0, compile.stdout + compile.stderr);
  clearQuarantine(directory);
  clearQuarantine(executable);
  const run = spawnSync(executable, [directory], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /all payload policy checks passed/);
});
