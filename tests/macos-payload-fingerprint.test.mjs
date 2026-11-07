import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = new URL('../installer/macos/payload-fingerprint.sh', import.meta.url).pathname;
test('payload identity ignores app, documentation and artwork but tracks installed execution content', { skip: process.platform !== 'darwin' }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aac-fingerprint-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  function put(file, text) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  const included = ['payload/engine.mjs', 'payload/SKILL.md', 'payload/assets/scenarios/browser-monitor/template/workflow/flow.json', 'payload/assets/scenarios/index.md', 'payload/assets/scenarios/basic/template/workflow/flow.json', 'payload/assets/scenarios/future-type/guide.md', 'payload/assets/scenarios/future-type/template/new.txt', 'payload/assets/scenarios/future-type/examples/new.md', 'runtime/arm64/node', 'runtime/x64/node'];
  for (const file of included) put(file, 'original ' + file);
  function fingerprint() {
    const run = spawnSync('/bin/bash', [script, root], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout.trim(), /^[a-f0-9]{64}$/);
    return run.stdout.trim();
  }
  const legacy = fingerprint();
  for (const file of ['payload/references/file-writing-rules.md', 'payload/references/nested/extra.md']) {
    included.push(file);
    put(file, 'original ' + file);
  }
  const original = fingerprint();
  assert.notEqual(original, legacy, 'adding references must trigger payload application');
  for (const file of ['payload/README.md', 'payload/install-to-aside.sh', 'payload/assets/readme/logo.png', 'payload/assets/scenarios/.DS_Store', 'payload/assets/scenarios/basic/template/.DS_Store', 'payload/references/.DS_Store', 'runtime/arm64/.DS_Store', 'bootstrap.sh', 'app-version']) {
    put(file, 'metadata update');
    assert.equal(fingerprint(), original, file + ' must not trigger payload application');
  }
  for (const file of included) {
    put(file, 'changed ' + file);
    assert.notEqual(fingerprint(), original, file + ' must trigger payload application');
    put(file, 'original ' + file);
    assert.equal(fingerprint(), original);
  }
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aac-fingerprint-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'marker.md'), 'outside unchanged');
  fs.symlinkSync(outside, path.join(root, 'payload/assets/scenarios/linked-type'));
  assert.notEqual(spawnSync('/bin/bash', [script, root]).status, 0, 'scenario symlinks must fail');
  fs.unlinkSync(path.join(root, 'payload/assets/scenarios/linked-type'));
  fs.symlinkSync(outside, path.join(root, 'payload/references/link'));
  assert.notEqual(spawnSync('/bin/bash', [script, root]).status, 0, 'nested references links must fail');
  fs.unlinkSync(path.join(root, 'payload/references/link'));
  fs.rmSync(path.join(root, 'payload/references'), { recursive: true });
  fs.symlinkSync(outside, path.join(root, 'payload/references'));
  assert.notEqual(spawnSync('/bin/bash', [script, root]).status, 0, 'root references links must fail');
  fs.unlinkSync(path.join(root, 'payload/references'));
  assert.equal(fs.readFileSync(path.join(outside, 'marker.md'), 'utf8'), 'outside unchanged');
  put('payload/SKILL.md', 'Read references/file-writing-rules.md');
  assert.notEqual(spawnSync('/bin/bash', [script, root]).status, 0, 'required reference must not be missing');
  put('payload/SKILL.md', 'legacy skill without references');
  fingerprint();
  fs.unlinkSync(path.join(root, 'payload/engine.mjs'));
  const missing = spawnSync('/bin/bash', [script, root], { encoding: 'utf8' });
  assert.notEqual(missing.status, 0, 'missing required files must fail rather than identify an incomplete payload');
});
