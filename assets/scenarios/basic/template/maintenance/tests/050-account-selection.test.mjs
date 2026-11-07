import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { engine, fixture, records } from './test-helpers.mjs';

test('실행 계정 확인과 명시적 승인 전 인수 차단', () => {
  const f = fixture(['완료', '알림완료', '정리완료']);
  const invoke = (args, env = f.env) => spawnSync('/bin/sh', [path.join(f.routine, 'run.sh'), ...args], { env, encoding: 'utf8' });
  assert.equal(invoke(['--check']).status, 2);assert.equal(records(f.calls).length, 0);
  assert.equal(invoke([], { ...f.env, WRONG_ACCOUNT: '1' }).status, 1);
  fs.rmSync(f.calls);assert.equal(invoke([]).status, 0);assert.equal(records(f.calls)[0][0], 'account');
});
test('계정 이메일 대소문자 차이는 같은 계정으로 처리', () => {
  const f = fixture(['완료', '알림완료', '정리완료']); const file = path.join(f.routine, 'run.sh');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('test@example.invalid', 'TEST@EXAMPLE.INVALID'));
  const out = spawnSync('/bin/sh', [file], { env: f.env, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr); assert.ok(records(f.calls).some(a => a[0] === 'exec'));
});

test('공통 엔진이 없으면 다른 엔진으로 대체하지 않고 중단', () => {
  const f = fixture([]);
  fs.rmSync(path.join(f.env.ASIDE_AUTOMATION_CREATOR_REPO, 'engine.mjs'));
  const out = spawnSync('/bin/sh', [path.join(f.routine, 'run.sh')], { env: f.env, encoding: 'utf8' });
  assert.notEqual(out.status, 0);
  assert.ok(!records(f.calls).some(args => args[0] === 'exec' || args[1] === 'resume'));
  assert.equal(fs.existsSync(path.join(f.routine, 'runtime')), false);
});

test('경로 설정 없이 기본 설치 위치의 공통 엔진 사용', () => {
  const f = fixture(['완료', '알림완료', '정리완료']);
  const env = { ...f.env };
  delete env.ASIDE_AUTOMATION_CREATOR_REPO;
  const out = spawnSync('/bin/sh', [path.join(f.routine, 'run.sh')], { env, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.ok(records(f.calls).some(args => args[0] === 'exec'));
});
