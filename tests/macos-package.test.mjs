import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const cleaner='/Users/seesoong/.aside/u/0/skills/user/quarantine-free-files/scripts/clear-quarantine.sh';
const template=readFileSync(new URL('../assets/template/run.sh',import.meta.url),'utf8');
function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'aside-package-run-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const repo=join(root,'private repo'), dir=join(root,'routine'), cli=join(root,'private aside'), log=join(root,'calls');
  mkdirSync(join(repo,'runtime'),{recursive:true}); mkdirSync(dir);
  cpSync(process.execPath,join(repo,'runtime/node'));
  writeFileSync(join(repo,'engine.mjs'), 'import fs from "node:fs"; fs.appendFileSync(process.env.CALL_LOG, JSON.stringify(process.argv.slice(2))+"\\n");');
  writeFileSync(cli,'#!/bin/sh\nprintf "account:%s\\n" "$*" >> "$CALL_LOG"\nprintf "u7 fixture@example.com\\n"\n'); chmodSync(cli,0o755);
  writeFileSync(join(dir,'run.sh'),template.replaceAll('__TIMEZONE__','Asia/Seoul').replaceAll('__ACCOUNT_EMAIL__','fixture@example.com'));
  if(process.platform==='darwin' && existsSync(cleaner)) {
    const clean=spawnSync('/bin/bash',[cleaner,root],{encoding:'utf8'}); assert.equal(clean.status,0,clean.stderr);
  }
  const run=(args=[])=>spawnSync('/bin/sh',[join(dir,'run.sh'),...args],{encoding:'utf8',env:{...process.env,HOME:root,ASIDE_AUTOMATION_CREATOR_REPO:repo,ASIDE_NODE_PATH:join(repo,'runtime/node'),ASIDE_CLI_PATH:cli,CALL_LOG:log}});
  return {root,repo,dir,log,run};
}
test('run uses explicit private Node and CLI with the unchanged account check',t=>{
  const f=fixture(t), result=f.run(); assert.equal(result.status,0,result.stderr);
  assert.deepEqual(readFileSync(f.log,'utf8').trim().split('\n'),['account:account list',JSON.stringify(['u7',f.dir])]);
});
test('run rejects every argument before account lookup or engine execution',t=>{
  const f=fixture(t), result=f.run(['--test']); assert.equal(result.status,2); assert.equal(existsSync(f.log),false);
});
test('templates share bundled Node fallback and preserve private paths for launchd',()=>{
  const install=readFileSync(new URL('../assets/template/install.sh',import.meta.url),'utf8');
  for(const text of [template,install]) {
    assert.match(text,/NODE=\$\{ASIDE_NODE_PATH:-\$\(command -v node \|\| true\)\}/);
    assert.match(text,/NODE=\$\{NODE:-"\$ENGINE_REPO\/runtime\/node"\}/);
  }
  assert.match(install,/ASIDE_NODE_PATH: require\("path"\)\.resolve\(nodePath\)/);
  assert.match(install,/ASIDE_CLI_PATH: require\("path"\)\.resolve\(cliPath\)/);
  assert.match(install,/ASIDE_CLI_AUTH_PATH: require\("path"\)\.resolve\(authPath\)/);
  assert.doesNotMatch(install,/\nnode /);
  assert.match(install,/같은 Label의 다른 서비스는 변경하지 않습니다/);
});
