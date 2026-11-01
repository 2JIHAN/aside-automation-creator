import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const options = { skip: process.platform !== 'win32' && 'Windows PE integration requires Windows; not verified on this platform' };
const powershell = process.env.POWERSHELL_EXE || 'powershell.exe';
const template = fileURLToPath(new URL('../assets/template/run.ps1', import.meta.url));
const engine = fileURLToPath(new URL('../engine.mjs', import.meta.url));
const flags = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned'];
const source = String.raw`
using System;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
public class FakeAside {
    public static int Main(string[] arguments) {
        Console.OutputEncoding = new UTF8Encoding(false);
        string calls = Environment.GetEnvironmentVariable("TEST_CALLS");
        File.AppendAllText(calls, new JavaScriptSerializer().Serialize(arguments) + "\n", new UTF8Encoding(false));
        if (arguments.Length == 2 && arguments[0] == "account" && arguments[1] == "list") {
            Console.WriteLine(Environment.GetEnvironmentVariable("TEST_ACCOUNTS"));
            return 0;
        }
        if (arguments.Length == 6 && arguments[0] == "exec") {
            Console.Error.WriteLine("created new session: native123");
            Console.WriteLine("\uC0C1\uD0DC: \uC815\uC0C1");
            return 0;
        }
        if (arguments.Length == 6 && arguments[0] == "session" && arguments[1] == "resume") {
            Console.WriteLine("\uC0C1\uD0DC: \uC815\uC0C1");
            return 0;
        }
        return 71;
    }
}
`;

function put(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf8');
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'aside-native-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scenario = join(root, '루틴 공백 & mkdir shell-injected & rem');
  const repository = join(root, '공통 엔진');
  const cli = join(root, '가짜 CLI & 공백', 'cli.exe');
  const callsFile = join(root, 'calls.jsonl');
  const runner = join(scenario, 'run.ps1');
  put(runner, readFileSync(template, 'utf8').replaceAll('__ACCOUNT_EMAIL__', 'test@example.invalid').replaceAll('__TIMEZONE__', 'Asia/Seoul'));
  mkdirSync(repository, { recursive: true });
  copyFileSync(engine, join(repository, 'engine.mjs'));
  put(join(scenario, 'workflow/context.md'), 'Offline native fixture.');
  put(join(scenario, 'workflow/단계.md'), 'Offline native fixture.');
  put(join(scenario, 'workflow/flow.json'), JSON.stringify({
    contextFile: 'workflow/context.md', startStep: 'work', initialState: { 현재턴결과: '미실행' },
    steps: { work: { instructionFile: 'workflow/단계.md', next: [{ when: { 현재턴결과: '정상' }, finishWithStatus: 'ok' }] } },
  }));
  const sourceFile = join(root, 'FakeAside.cs');
  const compileScript = join(root, 'compile.ps1');
  put(sourceFile, source);
  mkdirSync(dirname(cli), { recursive: true });
  put(compileScript, "Add-Type -Path $env:TEST_SOURCE -ReferencedAssemblies 'System.Web.Extensions.dll' -OutputType ConsoleApplication -OutputAssembly $env:TEST_CLI\n");
  // Always compile a .NET Framework PE with built-in PowerShell 5.1, even when testing pwsh 7.
  const compiler = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const compiled = spawnSync(compiler, [...flags, '-File', compileScript], {
    encoding: 'utf8', timeout: 60000, cwd: root,
    env: { ...process.env, TEST_SOURCE: sourceFile, TEST_CLI: cli },
  });
  assert.equal(compiled.status, 0, compiled.error?.message || compiled.stdout + compiled.stderr);
  assert.equal(readFileSync(cli).subarray(0, 2).toString('ascii'), 'MZ');
  const run = (extra = {}, args = []) => spawnSync(powershell, [...flags, '-File', runner, ...args], {
    encoding: 'utf8', timeout: 30000, cwd: root,
    env: { ...process.env, ASIDE_NODE_PATH: process.execPath, ASIDE_CLI_PATH: cli,
      ASIDE_AUTOMATION_CREATOR_REPO: repository, TEST_CALLS: callsFile,
      TEST_ACCOUNTS: 'u7 test@example.invalid\nu1 other@example.invalid', ...extra },
  });
  const calls = () => existsSync(callsFile) ? readFileSync(callsFile, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line)) : [];
  return { root, scenario, run, calls };
}

test('Windows native PE CLI preserves account, Korean UTF-8 output and multiline path arguments', options, t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
  const calls = f.calls();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ['account', 'list']);
  assert.deepEqual(calls[1].slice(0, 5), ['exec', '--account', 'u7', '--effort', 'low']);
  assert.equal(calls[1].length, 6, 'multiline prompt remains one native argument');
  assert.match(calls[1][5], /\n/);
  assert.ok(calls[1][5].includes(join(f.scenario, 'workflow/단계.md')));
  assert.ok(calls[1][5].includes(join(f.scenario, 'workflow/context.md')));
  const runs = join(f.scenario, 'runtime/runs');
  const folders = readdirSync(runs);
  assert.equal(folders.length, 1);
  const record = JSON.parse(readFileSync(join(runs, folders[0], 'run.json'), 'utf8'));
  assert.equal(record.finishStatus, 'ok');
  assert.equal(record.sessionId, 'native123');
  assert.equal(record.turns.length, 1);
  assert.equal(record.state.현재턴결과, '정상');
  for (const directory of [f.root, f.scenario]) {
    assert.equal(existsSync(join(directory, 'shell-injected')), false, 'shell metacharacters must not execute commands');
  }
});

test('Windows native runner rejects a wrong account without executing the engine', options, t => {
  const f = fixture(t);
  const result = f.run({ TEST_ACCOUNTS: 'u1 other@example.invalid\nu2 test@example.invalid.evil' });
  assert.notEqual(result.status, 0);
  assert.equal(result.error, undefined);
  assert.deepEqual(f.calls(), [['account', 'list']]);
  assert.equal(existsSync(join(f.scenario, 'runtime')), false);
});

test('Windows native runner rejects unexpected arguments before any CLI execution', options, t => {
  const f = fixture(t);
  for (const argument of ['unexpected', '--dry-run', '-Verbose']) {
    const result = f.run({}, [argument]);
    assert.notEqual(result.status, 0);
    assert.equal(result.error, undefined);
    assert.deepEqual(f.calls(), []);
    assert.equal(existsSync(join(f.scenario, 'runtime')), false);
  }
});
