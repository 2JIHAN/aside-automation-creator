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
  const included = ['payload/engine.mjs', 'payload/SKILL.md', 'payload/assets/template/workflow/flow.json', 'runtime/arm64/node', 'runtime/x64/node'];
  for (const file of included) put(file, 'original ' + file);
  function fingerprint() {
    const run = spawnSync('/bin/bash', [script, root], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout.trim(), /^[a-f0-9]{64}$/);
    return run.stdout.trim();
  }
  const original = fingerprint();
  for (const file of ['payload/README.md', 'payload/install-to-aside.sh', 'payload/assets/readme/logo.png', 'bootstrap.sh', 'app-version']) {
    put(file, 'metadata update');
    assert.equal(fingerprint(), original, file + ' must not trigger payload application');
  }
  for (const file of included) {
    put(file, 'changed ' + file);
    assert.notEqual(fingerprint(), original, file + ' must trigger payload application');
    put(file, 'original ' + file);
    assert.equal(fingerprint(), original);
  }
  fs.unlinkSync(path.join(root, 'payload/engine.mjs'));
  const missing = spawnSync('/bin/bash', [script, root], { encoding: 'utf8' });
  assert.notEqual(missing.status, 0, 'missing required files must fail rather than identify an incomplete payload');
});
