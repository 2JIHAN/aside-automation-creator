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
  const f = fixture(['완료', '알림완료', '정리완료', '완료', '알림완료', '정리완료']);
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

test('허용된 상태 조합은 정리와 학습에서 정확히 한 분기만 선택', () => {
  const flow = JSON.parse(fs.readFileSync(path.join(root, 'workflow/flow.json')));
  const matches = (id, state) => flow.steps[id].next.filter(rule => Object.entries(rule.when).every(([k, v]) => state[k] === v));
  for (const 업무상태 of ['완료', '실패']) for (const 알림상태 of ['알림완료', '알림불가'])
    for (const 정리상태 of ['정리완료', '정리불가']) for (const 학습계기 of ['없음', '재확인', '해결불가', '후보시험'])
      for (const 알림검토결과 of ['미실행', '재확인', '해결불가']) {
        const state = { 업무상태, 알림상태, 정리상태, 학습계기, 알림검토결과 };
        const rules = matches('cleanup', state);
        assert.equal(rules.length, 1, JSON.stringify(state));
        if (rules[0].step === 'learn') for (const 학습상태 of ['학습완료', '학습불가']) {
          const end = matches('learn', { ...state, 학습상태 });
          assert.equal(end.length, 1);
          assert.equal(end[0].finishWithStatus, 알림상태 === '알림불가' || 정리상태 === '정리불가' ? 'incomplete' : 업무상태 === '실패' ? 'handed_off' : 'ok');
        }
      }
  for (const 알림상태 of ['알림완료', '알림불가']) for (const 알림검토결과 of ['미실행', '재확인', '해결불가'])
    assert.equal(matches('notify', { 알림상태, 알림검토결과 }).length, 1);
  for (const 업무상태 of ['완료', '실패']) assert.equal(matches('work', { 업무상태 }).length, 1);
  for (const id of ['review', 'review-notify']) for (const 현재턴결과 of ['재확인', '해결불가']) assert.equal(matches(id, { 현재턴결과 }).length, 1);
});
test('파일 조회와 정리의 권한 계약', () => {
  const work = fs.readFileSync(path.join(root, 'workflow/steps/work.md'), 'utf8');
  const cleanup = fs.readFileSync(path.join(root, 'workflow/steps/cleanup.md'), 'utf8');
  for (const clause of ['재귀 탐색하지 않습니다', '심볼릭 링크가 아닌 일반 파일', '파일 본문을 읽거나 입력을 수정하지 않습니다', '실제 입력 목록과 메타데이터를 다시 조회']) assert.ok(work.includes(clause), clause);
  for (const clause of ['소유자를 확인할 수 없으면 그대로 두고', '최종 보고서, 증거 폴더, 입력 파일, 사용자 자원과 다른 실행의 자원은 보존']) assert.ok(cleanup.includes(clause), clause);
});
