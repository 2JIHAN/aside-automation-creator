import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
function fixture() {
  const base = realpathSync(mkdtempSync('/tmp/aac-macos-test.'));
  const home = join(base, 'home');
  const resources = join(base, 'resources');
  mkdirSync(join(home, '.aside/u/0'), { recursive: true });
  mkdirSync(join(home, '.local/bin'), { recursive: true });
  writeFileSync(join(home, '.local/bin/aside'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  mkdirSync(join(resources, 'payload'), { recursive: true });
  for (const name of ['SKILL.md', 'engine.mjs', 'README.md', 'install-to-aside.sh', 'assets']) cpSync(join(root, name), join(resources, 'payload', name), { recursive: true });
  for (const arch of ['arm64', 'x64']) {
    mkdirSync(join(resources, 'runtime', arch), { recursive: true });
    writeFileSync(join(resources, 'runtime', arch, 'node'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }
  const env = { HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', AAC_INSTALLER_FIXTURE: '1', AAC_FIXTURE_ROOT: base, ASIDE_HOME: join(home, '.aside'), ASIDE_AUTOMATION_CREATOR_REPO: join(home, 'repository') };
  return { base, home, resources, env };
}
function run(f) { return spawnSync('/bin/bash', [join(root, 'installer/macos/bootstrap.sh'), f.resources], { env: f.env, encoding: 'utf8' }); }
test('macOS bootstrap installs only into fixture and confirms byte-identical skill/runtime', { skip: process.platform !== 'darwin' }, () => {
  const f = fixture();
  try {
    const result = run(f);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^AAC_INSTALL_COMPLETE$/m);
    assert.equal(readFileSync(join(f.home, '.aside/u/0/skills/user/aside-automation-creator/SKILL.md'), 'utf8'), readFileSync(join(root, 'SKILL.md'), 'utf8'));
    assert.equal(readFileSync(join(f.home, 'repository/runtime/node'), 'utf8'), '#!/bin/sh\nexit 0\n');
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});
test('macOS bootstrap rejects fixture environment escape before writes', { skip: process.platform !== 'darwin' }, () => {
  const f = fixture();
  try {
    f.env.ASIDE_HOME = join(f.base, 'outside');
    const result = run(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /격리되지/);
    assert.doesNotMatch(result.stdout, /AAC_INSTALL_COMPLETE/);
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});
test('macOS bootstrap refuses profiles that are not numeric', { skip: process.platform !== 'darwin' }, () => {
  const f = fixture();
  try {
    rmSync(join(f.home, '.aside/u/0'), { recursive: true });
    mkdirSync(join(f.home, '.aside/u/not-a-profile'));
    const result = run(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /프로필이 없습니다/);
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});

test('macOS bootstrap does not report completion for a no-op root installer', { skip: process.platform !== 'darwin' }, () => {
  const f = fixture();
  try {
    writeFileSync(join(f.resources, 'payload/install-to-aside.sh'), '#!/bin/bash\nexit 0\n');
    const result = run(f);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /^AAC_INSTALL_COMPLETE$/m);
  } finally { rmSync(f.base, { recursive: true, force: true }); }
});
