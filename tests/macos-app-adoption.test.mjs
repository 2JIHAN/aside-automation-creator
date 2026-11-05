import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = new URL('../installer/macos/adopt-app.sh', import.meta.url).pathname;
const mac = { skip: process.platform !== 'darwin' };
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync('/tmp/aac-macos-test.'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const app = path.join(root, 'download', 'Aside Automation Creator.app');
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  fs.mkdirSync(home);
  fs.copyFileSync('/usr/bin/true', path.join(app, 'Contents', 'MacOS', 'Host'));
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.tamcut.aside-automation-creator</string><key>CFBundleExecutable</key><string>Host</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>');
  const sign = spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', app], { encoding: 'utf8' });
  assert.equal(sign.status, 0, sign.stderr);
  const env = { ...process.env, HOME: home, AAC_INSTALLER_FIXTURE: '1', AAC_FIXTURE_ROOT: root };
  const run = (source = app, overrides = {}) => spawnSync('/bin/bash', [script, source], { env: { ...env, ...overrides }, encoding: 'utf8' });
  return { root, home, app, env, run, destination: path.join(home, 'Applications', 'Aside Automation Creator.app') };
}
test('adoption verifies and copies app to user Applications without changing the source', mac, t => {
  const f = fixture(t);
  const before = fs.readFileSync(path.join(f.app, 'Contents', 'MacOS', 'Host'));
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'AAC_APP_PATH=' + f.destination);
  assert.deepEqual(fs.readFileSync(path.join(f.destination, 'Contents', 'MacOS', 'Host')), before);
  assert.deepEqual(fs.readFileSync(path.join(f.app, 'Contents', 'MacOS', 'Host')), before);
  assert.equal(spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', f.destination]).status, 0);
});
test('existing same-identity app is opened without overwriting or making backups', mac, t => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  const original = fs.statSync(path.join(f.destination, 'Contents', 'MacOS', 'Host')).mtimeMs;
  assert.equal(f.run().status, 0);
  assert.equal(fs.statSync(path.join(f.destination, 'Contents', 'MacOS', 'Host')).mtimeMs, original);
  assert.deepEqual(fs.readdirSync(path.join(f.home, 'Applications')), ['Aside Automation Creator.app']);
});
test('symlink Applications folder is rejected before copying', mac, t => {
  const f = fixture(t), outside = path.join(f.root, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(f.home, 'Applications'));
  assert.notEqual(f.run().status, 0);
  assert.deepEqual(fs.readdirSync(outside), []);
});
test('symlink destination is not followed or overwritten', mac, t => {
  const f = fixture(t);
  fs.mkdirSync(path.dirname(f.destination));
  fs.symlinkSync(f.app, f.destination);
  assert.notEqual(f.run().status, 0);
  assert.ok(fs.lstatSync(f.destination).isSymbolicLink());
});
test('unrelated existing destination is preserved', mac, t => {
  const f = fixture(t);
  fs.mkdirSync(f.destination, { recursive: true });
  fs.writeFileSync(path.join(f.destination, 'keep'), 'unrelated');
  assert.notEqual(f.run().status, 0);
  assert.equal(fs.readFileSync(path.join(f.destination, 'keep'), 'utf8'), 'unrelated');
});
test('modified unsigned source is rejected without creating Applications', mac, t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.app, 'Contents', 'Info.plist'), 'tampered');
  assert.notEqual(f.run().status, 0);
  assert.equal(fs.existsSync(path.join(f.home, 'Applications')), false);
});
test('fixture cannot redirect installation outside its isolated home', mac, t => {
  const f = fixture(t);
  assert.notEqual(f.run(f.app, { HOME: f.root }).status, 0);
  assert.equal(fs.existsSync(path.join(f.root, 'Applications')), false);
});
