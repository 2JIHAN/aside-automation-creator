import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
test('explicit native CLI path handles spaces and multiline prompts without a shell', { skip: process.platform === 'win32' }, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aside-cli-path-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const scenario = path.join(dir, '업무 with spaces');
  fs.mkdirSync(path.join(scenario, 'workflow'), { recursive: true });
  fs.writeFileSync(path.join(scenario, 'workflow/context.md'), 'context');
  fs.writeFileSync(path.join(scenario, 'workflow/work.md'), 'work');
  fs.writeFileSync(path.join(scenario, 'workflow/flow.json'), JSON.stringify({ contextFile:'workflow/context.md', startStep:'work', initialState:{현재턴결과:'미확인'}, steps:{work:{instructionFile:'workflow/work.md',next:[{when:{현재턴결과:'정상'},finishWithStatus:'ok'}]}} }));
  const cli = path.join(dir, 'native cli with spaces.exe');
  const calls = path.join(dir, 'calls.json');
  fs.writeFileSync(cli, `#!${process.execPath}\nrequire('fs').writeFileSync(process.env.CLI_CALLS,JSON.stringify(process.argv.slice(2)));console.error('created new session: windows_path_mock');console.log('상태: 정상');\n`, {mode:0o700});
  if(process.platform==='darwin'){
    const cleaner=process.env.ASIDE_CLEAR_QUARANTINE;
    if(cleaner)execFileSync('/bin/bash',[cleaner,dir]);
    else if(execFileSync('/usr/bin/xattr',[cli],{encoding:'utf8'}).includes('com.apple.quarantine'))execFileSync('/usr/bin/xattr',['-d','com.apple.quarantine',cli]);
  }
  const out=spawnSync(process.execPath,[path.join(root,'engine.mjs'),'u3',scenario],{env:{...process.env,ASIDE_CLI_PATH:cli,CLI_CALLS:calls},encoding:'utf8'});
  assert.equal(out.status,0,out.stderr);
  const args=JSON.parse(fs.readFileSync(calls,'utf8'));
  assert.deepEqual(args.slice(0,-1),['exec','--account','u3','--effort','low']);
  assert.ok(args.at(-1).includes('\n'));assert.ok(args.at(-1).includes(scenario));
});
