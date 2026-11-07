import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, engine, fixture, records, initial } from './test-helpers.mjs';

test('선언된 상태와 참조만 사용', () => {
  const flow = JSON.parse(fs.readFileSync(path.join(root, 'workflow/flow.json')));assert.deepEqual(flow.initialState, initial);
  for (const [id, step] of Object.entries(flow.steps)) {
    assert.ok(fs.existsSync(path.join(root, step.instructionFile)));
    if (step.stateKey) assert.ok(Object.hasOwn(initial, step.stateKey));
    for (const rule of step.next) {
      for (const key of Object.keys(rule.when)) assert.ok(Object.hasOwn(initial, key));
      assert.ok(!Object.hasOwn(rule, 'response'));
      assert.notEqual(Boolean(rule.step), Boolean(rule.finishWithStatus));
      if (rule.step === '$caller') assert.ok(['review', 'review-notify'].includes(id));
      else if (rule.step) assert.ok(flow.steps[rule.step]);
    }
  }
});
test('두 시나리오가 엔진 하나를 공유하고 각 폴더에만 기록', () => {
  const f = fixture(['정상', '알림완료', '정리완료', '정상', '알림완료', '정리완료']);
  const second = path.join(f.dir, 'second scenario');
  fs.cpSync(f.routine, second, { recursive: true });
  const sharedEngine = path.join(f.env.ASIDE_AUTOMATION_CREATOR_REPO, 'engine.mjs');
  const engineBefore = fs.readFileSync(sharedEngine);
  for (const routine of [f.routine, second]) {
    assert.equal(fs.existsSync(path.join(routine, 'src/engine.mjs')), false);
    const out = spawnSync('/bin/sh', [path.join(routine, 'run.sh')], { cwd: f.home, env: f.env, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    const run = JSON.parse(out.stdout.split('\n').find(line => line.startsWith('ENGINE_RESULT=')).slice('ENGINE_RESULT='.length));
    assert.equal(run.finishStatus, 'ok');
    assert.ok(run.runDir.startsWith(path.join(routine, 'runs') + path.sep));
    const calls = records(f.calls).filter(args => args[0] === 'exec' || args[1] === 'resume').slice(-3);
    assert.ok(calls[0].at(-1).includes(path.join(routine, 'workflow/context.md')));
    assert.ok(calls.every(args => args.at(-1).includes(path.join(routine, 'workflow/steps'))));
  }
  assert.deepEqual(fs.readFileSync(sharedEngine), engineBefore);
  assert.equal(fs.existsSync(path.join(f.env.ASIDE_AUTOMATION_CREATOR_REPO, 'runtime')), false);
});

test('일반 템플릿은 고객명과 비공개 주소를 포함하지 않음', () => {
  const files = ['workflow/memory.md', 'workflow/context.md', ...fs.readdirSync(path.join(root, 'workflow/steps')).map(name => 'workflow/steps/' + name)];
  for (const name of files) {
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    assert.doesNotMatch(text, /DOES|더즈|naver|네이버|tndgud12|seesoong|2jihan000|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, name);
  }
});
test('업무 검토와 알림 검토는 같은 지침을 공유하고 복귀 대상은 분리', () => {
  const flow = JSON.parse(fs.readFileSync(path.join(root, 'workflow/flow.json')));
  assert.equal(flow.steps.review.instructionFile, flow.steps['review-notify'].instructionFile);
  assert.equal(flow.steps.review.rememberCaller, true); assert.equal(flow.steps['review-notify'].rememberCaller, true);
  assert.equal(flow.steps.review.stateKey, '학습계기'); assert.equal(flow.steps['review-notify'].stateKey, '알림검토결과');
});
