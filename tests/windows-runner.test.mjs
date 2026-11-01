import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const template = fileURLToPath(new URL('../assets/template/run.ps1', import.meta.url));
const engine = fileURLToPath(new URL('../engine.mjs', import.meta.url));
const cleaner = '/Users/seesoong/.aside/u/0/skills/user/quarantine-free-files/scripts/clear-quarantine.sh';
const pwsh = [process.env.POWERSHELL_EXE, 'pwsh', 'powershell.exe'].filter(Boolean).find(exe => spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']).status === 0);
const options = { skip: !pwsh && 'PowerShell is not available; set POWERSHELL_EXE' };
const nativeOptions = { skip: !pwsh ? 'PowerShell is not available; set POWERSHELL_EXE' : process.platform === 'win32' ? 'POSIX native executable fixture; Windows native execution is not verified by this fixture' : false };
const psquote = text => `'${text.replaceAll("'", "''")}'`;
const shquote = text => `'${text.replaceAll("'", "'\\''")}'`;
function put(file, text) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); }
function clean(file) {
  if (process.platform !== 'darwin') return;
  const result = spawnSync('/bin/bash', [cleaner, file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
function success(result) { assert.equal(result.status, 0, result.stdout + result.stderr); }
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'aside-윈도 실행 '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scenario = join(root, '루틴 공백 $(touch injected)');
  const repo = join(root, '다른 공통 저장소');
  const cli = join(root, 'CLI 공백 $(touch cli_injected)', 'aside.exe');
  const log = join(root, 'cli.jsonl');
  const nodeLog = join(root, 'node.json');
  const runner = join(scenario, 'run.ps1');
  put(runner, readFileSync(template, 'utf8').replaceAll('__ACCOUNT_EMAIL__', 'User@Example.com').replaceAll('__TIMEZONE__', 'Asia/Seoul'));
  put(join(repo, 'engine.mjs'), `import fs from 'node:fs'; fs.writeFileSync(process.env.MOCK_NODE_LOG, JSON.stringify({argv: process.argv.slice(2), cwd: process.cwd(), tz: process.env.TZ, cli: process.env.ASIDE_CLI_PATH})); await import(${JSON.stringify(pathToFileURL(engine).href)});`);
  const fake = join(root, 'fake-cli.mjs');
  put(fake, `import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.MOCK_CLI_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'account') { console.log(process.env.MOCK_ACCOUNTS); process.exit(Number(process.env.MOCK_ACCOUNT_EXIT || 0)); }
console.log('created new session: fixture123');
console.log('상태: 완료');
`);
  put(cli, `#!/bin/sh\nexec ${shquote(process.execPath)} ${shquote(fake)} "$@"\n`);
  chmodSync(cli, 0o755);
  put(join(scenario, 'workflow/context.md'), 'fixture only');
  put(join(scenario, 'workflow/단계.md'), 'fixture only');
  put(join(scenario, 'workflow/flow.json'), JSON.stringify({ contextFile: 'workflow/context.md', startStep: 'work', initialState: { 현재턴결과: '미실행' }, steps: { work: { instructionFile: 'workflow/단계.md', next: [{ when: { 현재턴결과: '완료' }, finishWithStatus: 'success' }] } } }));
  const run = (extra = {}, args = []) => {
    clean(root);
    return spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-File', runner, ...args], { encoding: 'utf8', timeout: 20000, cwd: root,
      env: { ...process.env, ASIDE_NODE_PATH: process.execPath, ASIDE_CLI_PATH: cli, ASIDE_AUTOMATION_CREATOR_REPO: repo,
        MOCK_CLI_LOG: log, MOCK_NODE_LOG: nodeLog, MOCK_ACCOUNTS: '  u7 user@example.COM\n  u1 other@example.com', MOCK_ACCOUNT_EXIT: '', ...extra } });
  };
  return { root, scenario, repo, cli, log, nodeLog, runner, run, calls: () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [] };
}

test('PowerShell parses the shipped Windows runner', options, () => {
  const result = spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-Command', `$tokens=$null; $errors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile(${psquote(template)}, [ref]$tokens, [ref]$errors); if ($errors.Count) { $errors | Out-String | Write-Error; exit 1 }`], { encoding: 'utf8' });
  success(result);
});

test('Windows runner passes the matching account, own folder, custom shared repository, timezone and CLI path to real Node engine', nativeOptions, t => {
  const f = fixture(t);
  success(f.run());
  assert.deepEqual(JSON.parse(readFileSync(f.nodeLog, 'utf8')), { argv: ['u7', f.scenario], cwd: f.scenario, tz: 'Asia/Seoul', cli: f.cli });
  const calls = f.calls();
  assert.deepEqual(calls[0], ['account', 'list']);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].slice(0, 5), ['exec', '--account', 'u7', '--effort', 'low']);
  assert.equal(calls[1].length, 6, 'multiline prompt must remain a single native argument');
  assert.match(calls[1][5], /\n/);
  assert.ok(calls[1][5].includes(join(f.scenario, 'workflow/단계.md')));
  assert.ok(calls[1][5].includes('$(touch injected)'));
  assert.equal(existsSync(join(f.scenario, 'injected')), false);
  assert.equal(existsSync(join(f.root, 'injected')), false);
  assert.equal(existsSync(join(f.scenario, 'cli_injected')), false);
  assert.equal(existsSync(join(f.root, 'cli_injected')), false);
  const runs = join(f.scenario, 'runtime/runs');
  const result = JSON.parse(readFileSync(join(runs, readdirSync(runs)[0], 'run.json'), 'utf8'));
  assert.equal(result.finishStatus, 'success');
  assert.equal(result.sessionId, 'fixture123');
});

for (const [name, extra] of [
  ['wrong account', { MOCK_ACCOUNTS: 'u1 other@example.com\nu2 user@example.com.evil' }],
  ['ambiguous account', { MOCK_ACCOUNTS: 'u1 user@example.com\nu2 USER@example.com' }],
  ['failing account list', { MOCK_ACCOUNT_EXIT: '29' }],
]) {
  test(`Windows runner refuses ${name} without executing the engine`, nativeOptions, t => {
    const f = fixture(t);
    const result = f.run(extra);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.equal(existsSync(f.nodeLog), false);
    assert.deepEqual(f.calls(), [['account', 'list']]);
    assert.equal(existsSync(join(f.scenario, 'runtime')), false);
  });
}

for (const arg of ['unexpected', '--dry-run', '-Verbose']) {
  test(`Windows runner refuses ${arg} before account lookup or engine execution`, nativeOptions, t => {
    const f = fixture(t);
    assert.notEqual(f.run({}, [arg]).status, 0);
    assert.deepEqual(f.calls(), []);
    assert.equal(existsSync(f.nodeLog), false);
  });
}

test('Windows runner resolves Node and aside.exe from PATH when overrides are absent', nativeOptions, t => {
  const f = fixture(t);
  const bin = dirname(f.cli);
  const node = join(bin, 'node');
  put(node, `#!/bin/sh\nexec ${shquote(process.execPath)} "$@"\n`);
  chmodSync(node, 0o755);
  const second = join(f.root, 'second PATH directory');
  put(join(second, 'node'), '#!/bin/sh\nexit 89\n');
  put(join(second, 'aside.exe'), '#!/bin/sh\nexit 89\n');
  chmodSync(join(second, 'node'), 0o755);
  chmodSync(join(second, 'aside.exe'), 0o755);
  success(f.run({ ASIDE_NODE_PATH: '', ASIDE_CLI_PATH: '', PATH: `${bin}:${second}:/usr/bin:/bin` }));
  assert.equal(JSON.parse(readFileSync(f.nodeLog, 'utf8')).cli, f.cli);
});

test('Windows runner reports a missing CLI without starting the engine', nativeOptions, t => {
  const f = fixture(t);
  const result = f.run({ ASIDE_CLI_PATH: join(f.root, 'missing.exe') });
  assert.notEqual(result.status, 0);
  assert.deepEqual(f.calls(), []);
  assert.equal(existsSync(f.nodeLog), false);
});

for (const custom of [false, true]) {
  test(`Windows runner resolves CLI from ${custom ? 'custom install directory' : 'LOCALAPPDATA default'}`, nativeOptions, t => {
    const f = fixture(t);
    const base = custom ? join(f.root, 'custom CLI install') : join(f.root, 'Aside/CLI');
    const cli = join(base, 'current/aside.exe');
    put(cli, readFileSync(f.cli, 'utf8'));
    chmodSync(cli, 0o755);
    success(f.run({ ASIDE_CLI_PATH: '', ASIDE_CLI_INSTALL_DIR: custom ? base : '', LOCALAPPDATA: f.root }));
    assert.equal(JSON.parse(readFileSync(f.nodeLog, 'utf8')).cli, cli);
  });
}


test('Windows runner uses bundled runtime/node.exe when Node is absent from PATH', nativeOptions, t => {
  const f = fixture(t);
  const bundled = join(f.repo, 'runtime/node.exe');
  put(bundled, `#!/bin/sh\nexec ${shquote(process.execPath)} "$@"\n`);
  chmodSync(bundled, 0o755);
  const emptyPath = join(f.root, 'empty PATH');
  mkdirSync(emptyPath);
  success(f.run({ ASIDE_NODE_PATH: '', PATH: emptyPath }));
  assert.deepEqual(JSON.parse(readFileSync(f.nodeLog, 'utf8')).argv, ['u7', f.scenario]);
  assert.equal(f.calls().length, 2);
});
