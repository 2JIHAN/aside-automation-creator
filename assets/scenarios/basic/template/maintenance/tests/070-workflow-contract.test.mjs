import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, engine, fixture, records, execute, initial } from './test-helpers.mjs';

test('선언된 상태와 참조만 사용', () => {
  const flow = JSON.parse(fs.readFileSync(path.join(root, 'workflow/flows/operational.json')));assert.deepEqual(flow.initialState, initial);
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
  const files = ['workflow/context.md', ...fs.readdirSync(path.join(root, 'workflow/steps')).map(name => 'workflow/steps/' + name)];
  for (const name of files) {
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    assert.doesNotMatch(text, /DOES|더즈|naver|네이버|tndgud12|seesoong|2jihan000|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, name);
  }
});
test('업무 검토와 알림 검토는 같은 지침을 공유하고 복귀 대상은 분리', () => {
  const flow = JSON.parse(fs.readFileSync(path.join(root, 'workflow/flows/operational.json')));
  assert.equal(flow.steps.review.instructionFile, flow.steps['review-notify'].instructionFile);
  assert.equal(flow.steps.review.rememberCaller, true); assert.equal(flow.steps['review-notify'].rememberCaller, true);
  assert.equal(flow.steps.review.stateKey, '학습계기'); assert.equal(flow.steps['review-notify'].stateKey, '알림검토결과');
});

test('허용된 상태 조합은 정리와 학습에서 정확히 한 분기만 선택', () => {
  const flow = JSON.parse(fs.readFileSync(path.join(root, 'workflow/flows/operational.json')));
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


test('새 시나리오는 전역 학습 파일을 만들거나 읽지 않음', () => {
  const f = fixture([]);
  const context = fs.readFileSync(path.join(f.routine, 'workflow/context.md'), 'utf8');
  assert.deepEqual([...context.matchAll(/^# (.+)$/gm)].map(m=>m[1]), ['1. 작업 배경과 목적','2. 작업 대상과 환경','3. 알아야 할 개념과 관계','4. 관련 자료와 각 역할']);
  for (const name of ['learnings.md','memory.md']) assert.equal(fs.existsSync(path.join(f.routine, 'workflow', name)), false);
  for (const name of fs.readdirSync(path.join(f.routine, 'workflow/steps'))) {
    const text = fs.readFileSync(path.join(f.routine, 'workflow/steps', name), 'utf8');
    assert.doesNotMatch(context + text, /workflow\/(?:learnings|memory)\.md/);
  }
});

test('문서 역할이 실제 파일을 가리키고 확정 지식 반영 경로를 제공', () => {
  const flow = JSON.parse(fs.readFileSync(path.join(root, 'workflow/flows/operational.json'), 'utf8'));
  const context = fs.readFileSync(path.join(root, flow.contextFile), 'utf8');
  const mapped = [...context.matchAll(/^\| \x60(workflow\/[^\x60]+)\x60 \|/gm)].map(m => m[1]);
  for (const file of [flow.contextFile, 'workflow/mode.json', 'workflow/flows/dev.json', 'workflow/flows/operational.json', 'workflow/steps/dev-plan.md', ...new Set(Object.values(flow.steps).map(s => s.instructionFile))]) assert.ok(mapped.includes(file), file);
  for (const file of mapped) assert.ok(fs.statSync(path.join(root, file)).isFile(), file);
  assert.match(context, /필수 배경지식/);
  const learn = fs.readFileSync(path.join(root, flow.steps.learn.instructionFile), 'utf8');
  assert.match(learn, /## 확정 지식 반영/);
  assert.match(learn, /## 미확정 개선안/);
  assert.match(learn, /직접 반영/);
  assert.match(learn, /반복 횟수만으로 채택하지/);
});

test('기본은 운영이고 별도 개발 예제는 계획만 작성', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'workflow/mode.json'), 'utf8'));
  assert.equal(config.mode, 'operational');
  assert.deepEqual(Object.keys(config.flows), ['dev', 'operational']);
  assert.equal(fs.existsSync(path.join(root, 'workflow/flow.json')), false);
  for (const file of Object.values(config.flows)) {
    const selected = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    for (const step of Object.values(selected.steps)) {
      assert.ok(fs.statSync(path.join(root, step.instructionFile)).isFile());
      if (step.stateKey) assert.ok(Object.hasOwn(selected.initialState, step.stateKey));
      for (const rule of step.next) {
        assert.notEqual(Boolean(rule.step), Boolean(rule.finishWithStatus));
        for (const key of Object.keys(rule.when)) assert.ok(Object.hasOwn(selected.initialState, key));
        if (rule.step && rule.step !== '$caller') assert.ok(selected.steps[rule.step]);
      }
    }
  }
  const dev = JSON.parse(fs.readFileSync(path.join(root, config.flows.dev), 'utf8'));
  assert.deepEqual(Object.keys(dev.steps), ['dev-plan']);
  const plan = fs.readFileSync(path.join(root, dev.steps['dev-plan'].instructionFile), 'utf8');
  for (const clause of ['계획 대상: workflow/steps/work.md', 'work-plan.md', '사이트 접속과 브라우저 조작', '원본 파일 조회와 처리', '이월 메모와 업무 상태는 바꾸지']) assert.ok(plan.includes(clause), clause);
  assert.ok(!Object.hasOwn(dev.initialState, '업무상태'));
});

test('개발 흐름은 모의 CLI 한 턴으로 planned 종료', () => {
  const f = fixture(['계획완료'], 'dev');
  const {out, run} = execute(f);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(run.finishStatus, 'planned');
  assert.deepEqual(run.turns.map(turn => turn.step), ['dev-plan']);
  assert.equal(run.flowFile, 'workflow/flows/dev.json');
  assert.equal(records(f.calls).length, 1);
});

test('개발 계획 작성 불가는 운영 업무로 넘어가지 않음', () => {
  const f = fixture(['계획불가'], 'dev');
  const {out, run} = execute(f);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(run.finishStatus, 'incomplete');
  assert.deepEqual(run.turns.map(turn => turn.step), ['dev-plan']);
  assert.equal(records(f.calls).length, 1);
  assert.ok(!Object.hasOwn(run.state, '업무상태'));
});
