import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = ['SKILL.md', 'references/file-writing-rules.md', 'assets/scenarios/index.md', ...fs.readdirSync(path.join(root, 'assets/scenarios'), {withFileTypes:true}).filter(entry => entry.isDirectory()).map(entry => 'assets/scenarios/' + entry.name + '/guide.md')];
const documents = new Map(files.map(f => [f, fs.readFileSync(path.join(root, f), 'utf8')]));

function links(file) {
  return [...documents.get(file).matchAll(/\]\(([^)]+)\)/g)]
    .map(m => m[1]).filter(link => !/^(https?:|#)/.test(link))
    .map(link => path.posix.normalize(path.posix.join(path.posix.dirname(file), link)));
}

test('제작 문서의 참고 링크가 실제 파일을 가리킴', () => {
  for (const file of files) for (const link of links(file)) assert.ok(fs.statSync(path.join(root, link)).isFile(), link);
  assert.ok(links('SKILL.md').includes('assets/scenarios/basic/template/workflow/steps/learn.md'));
  assert.ok(links('SKILL.md').includes('references/file-writing-rules.md'));
});

test('제작 문서 사이에 순환 참조가 없음', () => {
  function visit(file, ancestors) {
    assert.ok(!ancestors.includes(file), [...ancestors, file].join(' -> '));
    for (const next of links(file)) if (documents.has(next)) visit(next, [...ancestors, file]);
  }
  for (const file of files) visit(file, []);
});

for (const type of ['basic', 'browser-monitor']) test(type + ': 학습 지침은 시나리오 내부 파일만 참조함', () => {
  const file = 'assets/scenarios/' + type + '/template/workflow/steps/learn.md';
  const learn = fs.readFileSync(path.join(root, file), 'utf8');
  assert.ok(!/references\/|ASIDE_AUTOMATION_CREATOR_REPO|~\/\.local/.test(learn));
  const local = [...learn.matchAll(/\]\(([^)]+)\)/g)].map(m => path.resolve(root, path.dirname(file), m[1]));
  assert.match(learn, /## 구조 판단[\s\S]*한 가지 목적을 수행하나요/);
  const workflow = path.resolve(root, 'assets/scenarios/' + type + '/template/workflow') + path.sep;
  for (const link of local) {
    assert.ok(link.startsWith(workflow));
    assert.ok(fs.statSync(link).isFile());
  }
});

test('basic fallback provides a usable template without browser-monitor assumptions', () => {
  const basic = path.join(root, 'assets/scenarios/basic/template');
  const flow = JSON.parse(fs.readFileSync(path.join(basic, 'workflow/flows/operational.json'), 'utf8'));
  assert.ok(flow.steps[flow.startStep], 'basic flow has a valid start step');
  for (const file of [flow.contextFile, ...Object.values(flow.steps).map(step => step.instructionFile)]) {
    assert.ok(fs.statSync(path.join(basic, file)).isFile(), file);
  }
  assert.ok(fs.statSync(path.join(basic, 'workflow/context.md')).isFile());
  assert.equal(fs.existsSync(path.join(basic, 'workflow/step-boundary-checklist.md')), false);
  assert.ok(links('SKILL.md').includes('assets/scenarios/index.md'));
  assert.ok(links('assets/scenarios/index.md').includes('assets/scenarios/basic/guide.md'));
  assert.ok(links('assets/scenarios/index.md').includes('assets/scenarios/browser-monitor/guide.md'));
});

test('basic은 핵심 공통 기능을 포함하되 브라우저 정리를 강제하지 않음', () => {
  const basic = path.join(root, 'assets/scenarios/basic/template');
  const flow = JSON.parse(fs.readFileSync(path.join(basic, 'workflow/flows/operational.json'), 'utf8'));
  for (const step of ['work', 'review', 'notify', 'cleanup', 'learn']) assert.ok(flow.steps[step], step);
  assert.equal(flow.steps['close-tabs'], undefined);
  for (const file of ['workflow/mode.json', 'workflow/flows/dev.json', 'workflow/steps/dev-plan.md', 'maintenance/install.sh', 'maintenance/install.ps1', 'maintenance/uninstall.sh', 'maintenance/uninstall.ps1']) assert.ok(fs.statSync(path.join(basic, file)).isFile(), file);
  for (const step of Object.values(flow.steps)) assert.ok(fs.statSync(path.join(basic, step.instructionFile)).isFile(), step.instructionFile);
});

test('필수 배경지식 공통 템플릿은 합의한 네 항목을 그대로 제공함',()=>{
  const template=fs.readFileSync(path.join(root,'references/context-template.md'),'utf8');
  assert.equal(template,"# 1. 작업 배경과 목적\n이 작업이 왜 필요하고, 무엇을 이루려는지.\n\n# 2. 작업 대상과 환경\n무엇을 다루며, 어떤 시스템이나 환경에서 일하는지.\n\n# 3. 알아야 할 개념과 관계\n대상을 이해하는 데 필요한 용어, 구분과 대상 간 관계.\n\n# 4. 관련 자료와 각 역할\n어떤 자료가 있으며, 각각 무엇을 알려주는지.\n");
  assert.ok(links('SKILL.md').includes('references/context-template.md'));
});

for (const type of ['basic','browser-monitor']) test(type + ': 새 템플릿은 운영 모드를 기본 선택하고 학습 장부를 강제하지 않음', () => {
  const template = path.join(root, 'assets/scenarios', type, 'template');
  const mode = JSON.parse(fs.readFileSync(path.join(template, 'workflow/mode.json'), 'utf8'));
  assert.deepEqual(mode, { mode: 'operational', flows: { dev: 'workflow/flows/dev.json', operational: 'workflow/flows/operational.json' } });
  for (const file of Object.values(mode.flows)) {
    const flow = JSON.parse(fs.readFileSync(path.join(template, file), 'utf8'));
    assert.ok(flow.steps[flow.startStep]);
    for (const target of [flow.contextFile, ...Object.values(flow.steps).map(step => step.instructionFile)]) assert.ok(fs.statSync(path.join(template,target)).isFile(), target);
  }
  for (const name of ['learnings.md','memory.md','flow.json']) assert.equal(fs.existsSync(path.join(template,'workflow',name)), false);
  const work = fs.readFileSync(path.join(template,'workflow/steps/work.md'),'utf8');
  const learn = fs.readFileSync(path.join(template,'workflow/steps/learn.md'),'utf8');
  assert.doesNotMatch(work + learn, /workflow\/(?:learnings|memory)\.md/);
  assert.match(learn, /이번 실행 증거/);
});

test('제작 규약은 사람이 읽는 Markdown과 프로그램용 JSON을 구분', () => {
  const rules = documents.get('references/file-writing-rules.md');
  assert.match(rules, /업무 결과와 이월 메모는 사람이 읽는 Markdown을 우선/);
  assert.match(rules, /프로그램이 직접 읽는 실행 설정/);
  assert.match(rules, /개발 담당 에이전트가 계획 전문과 증거를 확인/);
  assert.match(rules, /다른 단계의 기록을 보존하고 부분 완료와 전체 완료를 구분/);
});
