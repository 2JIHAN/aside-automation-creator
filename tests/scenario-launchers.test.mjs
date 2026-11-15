import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync, execFileSync} from 'node:child_process';
import {fixture, root, success, lines, readCalls} from './engine/test-helpers.mjs';

const pwsh=['pwsh','powershell.exe'].find(exe=>spawnSync(exe,['-NoProfile','-NonInteractive','-Command','exit 0']).status===0);
const cleaner=process.env.ASIDE_CLEAR_QUARANTINE || path.join(process.env.HOME || '', '.aside/u/0/skills/user/quarantine-free-files/scripts/clear-quarantine.sh');
function launcher(type, extension, values=success()) {
  const f=fixture(values);
  fs.mkdirSync(path.join(f.routine,'workflow/flows'),{recursive:true});
  fs.renameSync(path.join(f.routine,'workflow/flow.json'),path.join(f.routine,'workflow/flows/selected.json'));
  fs.writeFileSync(path.join(f.routine,'workflow/mode.json'),JSON.stringify({mode:'custom',flows:{custom:'workflow/flows/selected.json'}}));
  const runner=path.join(f.routine,'run.'+extension);
  fs.writeFileSync(runner,fs.readFileSync(path.join(root,'assets/scenarios',type,'template/run.'+extension),'utf8').replaceAll('__ACCOUNT_EMAIL__','test@example.com').replaceAll('__TIMEZONE__','Asia/Seoul'));
  if(process.platform==='darwin') {
    if(fs.existsSync(cleaner)) execFileSync('/bin/bash',[cleaner,runner]);
    const attrs=()=>execFileSync('/usr/bin/xattr',[runner],{encoding:'utf8'});
    if(attrs().includes('com.apple.quarantine')) execFileSync('/usr/bin/xattr',['-d','com.apple.quarantine',runner]);
    assert.ok(!attrs().includes('com.apple.quarantine'));
  }
  f.invoke=(args=[])=>spawnSync(extension==='sh'?'/bin/sh':pwsh,extension==='sh'?[runner,...args]:['-NoProfile','-NonInteractive','-File',runner,...args],{env:{...f.env,ASIDE_NODE_PATH:process.execPath,ASIDE_AUTOMATION_CREATOR_REPO:f.dir},encoding:'utf8',timeout:20000});
  f.mode=mode=>fs.writeFileSync(path.join(f.routine,'workflow/mode.json'),JSON.stringify(mode));
  return f;
}

for(const type of ['basic','browser-monitor']) for(const extension of ['sh','ps1']) {
  const options={skip:process.platform==='win32'?'POSIX mock CLI; Windows native fixture covers Windows':extension==='ps1'&&!pwsh?'PowerShell unavailable':false};
  test(`${type} ${extension}: 선택한 흐름으로 실행하고 자기 잠금만 정리`,options,()=>{
    const f=launcher(type,extension);
    const out=f.invoke();
    assert.equal(out.status,0,out.stderr+out.stdout);
    const [run]=lines(out.stdout,'ENGINE_RESULT=');
    assert.equal(run.flowFile,path.join('workflow','flows','selected.json'));
    assert.equal(run.finishStatus,'ok');
    assert.equal(fs.existsSync(path.join(f.routine,'runs/.run.lock')),false);
    assert.deepEqual(readCalls(f.calls)[0],['account','list']);
  });
  test(`${type} ${extension}: 잘못된 모드나 흐름은 계정 조회 전 거부`,options,()=>{
    for(const mode of [{mode:'absent',flows:{}},{mode:'toString',flows:{}},{mode:'custom',flows:{custom:'../outside.json'}},{mode:'custom',flows:{custom:'workflow/missing.json'}}]){
      const f=launcher(type,extension);
      fs.copyFileSync(path.join(f.routine,'workflow/flows/selected.json'),path.join(f.dir,'outside.json'));
      f.mode(mode);
      assert.notEqual(f.invoke().status,0);
      assert.deepEqual(readCalls(f.calls),[]);
      assert.equal(fs.existsSync(path.join(f.routine,'runs/.run.lock')),false);
    }
  });
  test(`${type} ${extension}: 기존 잠금이 있으면 아무 CLI도 실행하지 않고 보존`,options,()=>{
    const f=launcher(type,extension);
    const lock=path.join(f.routine,'runs/.run.lock');
    fs.mkdirSync(lock,{recursive:true});fs.writeFileSync(path.join(lock,'pid'),'other-owner');
    assert.notEqual(f.invoke().status,0);
    assert.deepEqual(readCalls(f.calls),[]);
    assert.equal(fs.readFileSync(path.join(lock,'pid'),'utf8'),'other-owner');
  });
  test(`${type} ${extension}: 실행 실패 뒤에도 자기 잠금을 해제`,options,()=>{
    const f=launcher(type,extension,[{exit:9}]);
    const out=f.invoke();
    assert.notEqual(out.status,0);
    assert.equal(fs.existsSync(path.join(f.routine,'runs/.run.lock')),false);
    const [run]=lines(out.stdout,'ENGINE_RESULT=');
    assert.equal(run.finishStatus,'stopped');
  });
  test(`${type} ${extension}: 외부 흐름과 runs 링크는 따라가지 않음`,options,()=>{
    for(const target of ['flow','runs']){
      const f=launcher(type,extension);
      const outside=path.join(f.dir,'outside');fs.mkdirSync(outside);
      if(target==='flow'){
        fs.copyFileSync(path.join(f.routine,'workflow/flows/selected.json'),path.join(outside,'flow.json'));
        fs.symlinkSync(path.join(outside,'flow.json'),path.join(f.routine,'workflow/linked.json'));
        f.mode({mode:'custom',flows:{custom:'workflow/linked.json'}});
      }else fs.symlinkSync(outside,path.join(f.routine,'runs'));
      assert.notEqual(f.invoke().status,0);
      assert.deepEqual(readCalls(f.calls),[]);
      assert.deepEqual(fs.readdirSync(outside),target==='flow'?['flow.json']:[]);
    }
  });
  test(`${type} ${extension}: 미지원 인자는 계정 조회 전에 거부`,options,()=>{
    const f=launcher(type,extension);
    assert.notEqual(f.invoke(['--dry-run']).status,0);
    assert.deepEqual(readCalls(f.calls),[]);
  });
}
