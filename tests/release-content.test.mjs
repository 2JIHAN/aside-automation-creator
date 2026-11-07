import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
test('CI discovers both template test suites and validates authoring documents', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/windows-release.yml'), 'utf8');
  assert.ok(workflow.includes('assets/scenarios/*/template/maintenance/tests/*.test.mjs'));
  assert.ok(workflow.includes('tests/authoring-documents.test.mjs'));
  assert.ok(workflow.includes('tests/release-content.test.mjs'));
  assert.ok(!workflow.includes('assets/template/'));
  for (const filter of ['SKILL.md', 'references/**', 'assets/scenarios/**']) assert.equal(workflow.split("- '" + filter + "'").length - 1, 2, filter);
  for (const type of ['basic', 'browser-monitor']) assert.ok(fs.readdirSync(path.join(root, 'assets/scenarios', type, 'template/maintenance/tests')).some(name => name.endsWith('.test.mjs')));
});

test('all public installer links use the current release page', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  for (const line of readme.split('\n').filter(line => /DMG 다운로드|Setup 다운로드/.test(line))) {
    assert.ok(line.includes('/releases/latest'), line);
    assert.ok(!line.includes('/tag/v0.2.2'), line);
  }
});

test('real macOS payload staging excludes Finder metadata and preserves source files', { skip: process.platform !== 'darwin' }, t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aac-release-stage-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  function put(name, text) { const file = path.join(repo, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
  fs.mkdirSync(path.join(repo, 'installer/macos'), { recursive: true });
  for (const name of ['SKILL.md', 'engine.mjs', 'README.md', 'install-to-aside.sh', 'installer/macos/bootstrap.sh', 'installer/macos/adopt-app.sh']) put(name, 'fixture ' + name);
  for (const name of ['assets/scenarios/index.md', 'assets/scenarios/basic/template/workflow/flow.json', 'assets/scenarios/browser-monitor/guide.md', 'references/file-writing-rules.md']) put(name, 'keep ' + name);
  const metadata = ['assets/scenarios/.DS_Store', 'assets/scenarios/basic/template/.DS_Store', 'references/.DS_Store'];
  for (const name of metadata) put(name, 'source metadata unchanged');
  const build = fs.readFileSync(path.join(root, 'installer/macos/build.sh'), 'utf8');
  const boundary = build.indexOf('SPARKLE_VERSION=');
  assert.ok(boundary > 0);
  const check = '\n[ -z "$(find "$RES/payload" -type f -name .DS_Store -print -quit)" ] || exit 97\n' +
    '[ -f "$RES/payload/assets/scenarios/basic/template/workflow/flow.json" ] || exit 98\n' +
    '[ -f "$RES/payload/assets/scenarios/browser-monitor/guide.md" ] || exit 99\n' +
    '[ -f "$RES/payload/references/file-writing-rules.md" ] || exit 100\n';
  const run = spawnSync('/bin/bash', ['-c', build.slice(0, boundary) + check, path.join(repo, 'installer/macos/build.sh'), '--build', path.join(base, 'out'), '0.5.0'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  for (const name of metadata) assert.equal(fs.readFileSync(path.join(repo, name), 'utf8'), 'source metadata unchanged');
});

test('Windows packaging removes metadata only inside the staged payload', () => {
  const build = fs.readFileSync(path.join(root, 'installer/windows/build.ps1'), 'utf8');
  assert.ok(build.includes("Get-ChildItem -LiteralPath $Payload -Recurse -Force -File -Filter '.DS_Store'"));
  assert.ok(build.includes('Remove-Item -LiteralPath $_.FullName -Force'));
});
