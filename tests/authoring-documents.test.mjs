import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = ['SKILL.md', 'references/file-writing-rules.md', 'assets/scenarios/index.md', ...fs.readdirSync(path.join(root, 'assets/scenarios'), {withFileTypes:true}).filter(entry => entry.isDirectory()).map(entry => 'assets/scenarios/' + entry.name + '/guide.md'), 'assets/scenarios/basic/template/workflow/step-boundary-checklist.md'];
const documents = new Map(files.map(f => [f, fs.readFileSync(path.join(root, f), 'utf8')]));

function links(file) {
  return [...documents.get(file).matchAll(/\]\(([^)]+)\)/g)]
    .map(m => m[1]).filter(link => !/^(https?:|#)/.test(link))
    .map(link => path.posix.normalize(path.posix.join(path.posix.dirname(file), link)));
}

test('제작 문서의 참고 링크가 실제 파일을 가리킴', () => {
  for (const file of files) for (const link of links(file)) assert.ok(fs.statSync(path.join(root, link)).isFile(), link);
  assert.ok(links('SKILL.md').includes('assets/scenarios/basic/template/workflow/step-boundary-checklist.md'));
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
  assert.ok(local.length > 0);
  const workflow = path.resolve(root, 'assets/scenarios/' + type + '/template/workflow') + path.sep;
  for (const link of local) {
    assert.ok(link.startsWith(workflow));
    assert.ok(fs.statSync(link).isFile());
  }
});

test('basic fallback provides a usable template without browser-monitor assumptions', () => {
  const basic = path.join(root, 'assets/scenarios/basic/template');
  const flow = JSON.parse(fs.readFileSync(path.join(basic, 'workflow/flow.json'), 'utf8'));
  assert.ok(flow.steps[flow.startStep], 'basic flow has a valid start step');
  for (const file of [flow.contextFile, ...Object.values(flow.steps).map(step => step.instructionFile)]) {
    assert.ok(fs.statSync(path.join(basic, file)).isFile(), file);
  }
  assert.ok(fs.statSync(path.join(basic, 'workflow/context.md')).isFile());
  assert.ok(fs.statSync(path.join(basic, 'workflow/step-boundary-checklist.md')).isFile());
  assert.ok(links('SKILL.md').includes('assets/scenarios/index.md'));
  assert.ok(links('assets/scenarios/index.md').includes('assets/scenarios/basic/guide.md'));
  assert.ok(links('assets/scenarios/index.md').includes('assets/scenarios/browser-monitor/guide.md'));
});

test('basic은 핵심 공통 기능을 포함하되 브라우저 정리를 강제하지 않음', () => {
  const basic = path.join(root, 'assets/scenarios/basic/template');
  const flow = JSON.parse(fs.readFileSync(path.join(basic, 'workflow/flow.json'), 'utf8'));
  for (const step of ['work', 'review', 'notify', 'cleanup', 'learn']) assert.ok(flow.steps[step], step);
  assert.equal(flow.steps['close-tabs'], undefined);
  for (const file of ['workflow/memory.md', 'maintenance/install.sh', 'maintenance/install.ps1', 'maintenance/uninstall.sh', 'maintenance/uninstall.ps1']) assert.ok(fs.statSync(path.join(basic, file)).isFile(), file);
  for (const step of Object.values(flow.steps)) assert.ok(fs.statSync(path.join(basic, step.instructionFile)).isFile(), step.instructionFile);
});
