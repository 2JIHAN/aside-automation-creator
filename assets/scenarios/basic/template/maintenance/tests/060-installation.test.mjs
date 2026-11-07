import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { engine, fixture, records } from './test-helpers.mjs';

test('모의 설치와 재설치 및 해제는 해당 서비스만 관리', { skip: process.platform !== 'darwin' }, () => {
  const f = fixture([]);const invoke = (script, args = [], env = f.env) => spawnSync('/bin/sh', [path.join(f.routine, script), ...args], { env, encoding: 'utf8' });
  let out = invoke('maintenance/install.sh', ['17']);assert.equal(out.status, 0, out.stderr);
  const plist = path.join(f.home, 'Library/LaunchAgents/io.local.routines.template-test.plist');
  const launcher = execFileSync('/usr/bin/plutil', ['-extract', 'ProgramArguments.0', 'raw', '-o', '-', plist], { encoding: 'utf8' }).trim();
  assert.ok(launcher.startsWith(path.join(f.home, 'background/테스트자동화-매시')));
  assert.ok(records(f.launches).some(a => a[0] === 'bootstrap'));assert.ok(!records(f.launches).some(a => a[0] === 'kickstart'));
  out = invoke('maintenance/install.sh', ['18'], { ...f.env, EXISTING: '1' });assert.equal(out.status, 0, out.stderr);assert.ok(!fs.existsSync(launcher));
  out = invoke('maintenance/uninstall.sh', [], { ...f.env, EXISTING: '1', BOOTOUT_FAIL: '1' });assert.equal(out.status, 5);assert.ok(fs.existsSync(plist));
  out = invoke('maintenance/uninstall.sh', [], { ...f.env, EXISTING: '1' });assert.equal(out.status, 0, out.stderr);assert.ok(!fs.existsSync(plist));assert.ok(fs.existsSync(path.join(f.env.ASIDE_AUTOMATION_CREATOR_REPO, 'engine.mjs')));
});

test('다른 서비스의 plist는 설치와 해제 모두 거부', { skip: process.platform !== 'darwin' }, () => {
  const f = fixture([]); const dest = path.join(f.home, 'Library/LaunchAgents/io.local.routines.template-test.plist');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const foreign = JSON.stringify({ Label: 'io.local.routines.template-test', WorkingDirectory: '/another-owner', ProgramArguments: ['/bin/sh'] });
  fs.writeFileSync(dest, foreign);
  for (const script of ['maintenance/install.sh', 'maintenance/uninstall.sh']) {
    const out = spawnSync('/bin/sh', [path.join(f.routine, script)], { env: { ...f.env, EXISTING: '1' }, encoding: 'utf8' });
    assert.equal(out.status, 1);assert.equal(fs.readFileSync(dest, 'utf8'), foreign);
    assert.ok(!records(f.launches).some(a => ['bootout', 'bootstrap'].includes(a[0])));
  }
});
test('소유 파일 없는 실행 중 서비스는 건드리지 않음', { skip: process.platform !== 'darwin' }, () => {
  const f = fixture([]);
  for (const script of ['maintenance/install.sh', 'maintenance/uninstall.sh']) {
    const out = spawnSync('/bin/sh', [path.join(f.routine, script)], { env: { ...f.env, EXISTING: '1' }, encoding: 'utf8' });
    assert.equal(out.status, 1);assert.ok(!records(f.launches).some(a => ['bootout', 'bootstrap'].includes(a[0])));
  }
});
test('예약 실행은 설치 시 지정한 공통 저장소 경로를 보존', { skip: process.platform !== 'darwin' }, () => {
  const f = fixture(['완료', '알림완료', '정리완료']);
  const custom = path.join(f.home, 'custom engine');
  fs.renameSync(f.env.ASIDE_AUTOMATION_CREATOR_REPO, custom);
  const out = spawnSync('/bin/sh', [path.join(f.routine, 'maintenance/install.sh'), '17'], { env: { ...f.env, ASIDE_AUTOMATION_CREATOR_REPO: custom }, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const plist = path.join(f.home, 'Library/LaunchAgents/io.local.routines.template-test.plist');
  const config = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8' }));
  assert.equal(config.EnvironmentVariables.ASIDE_AUTOMATION_CREATOR_REPO, custom);
  const env = { ...f.env };
  delete env.ASIDE_AUTOMATION_CREATOR_REPO;
  Object.assign(env, config.EnvironmentVariables);
  const run = spawnSync('/bin/sh', [config.ProgramArguments[0]], { cwd: config.WorkingDirectory, env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(records(f.calls).some(args => args[0] === 'exec'));
});
