import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const template = fileURLToPath(new URL('../assets/template/', import.meta.url));

test('native Windows Task Scheduler registers and removes only the current user fixture task', { skip: process.platform !== 'win32' && 'Requires the real Windows Task Scheduler service' }, () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'aside-native-scheduler-')));
  const slug = 'native-test-' + randomUUID();
  const name = 'Aside Native Test ' + randomUUID();
  const scenario = join(root, 'scenario files');
  const repo = join(root, 'shared repo');
  const home = join(root, 'home');
  try {
    for (const dir of [scenario, repo, home]) mkdirSync(dir, { recursive: true });
    for (const file of ['install.ps1', 'uninstall.ps1']) {
      writeFileSync(join(scenario, file), readFileSync(join(template, file), 'utf8').replaceAll('__AUTOMATION_SLUG__', slug).replaceAll('__AUTOMATION_NAME__', name));
    }
    writeFileSync(join(scenario, 'run.ps1'), '\ufeffexit 0\r\n');
    writeFileSync(join(repo, 'engine.mjs'), '// Native scheduler test. Never executed.\n');
    const cli = join(root, 'aside.exe');
    writeFileSync(cli, 'Non-executable fixture. Never invoked.');
    const harness = join(root, 'native-test.ps1');
    writeFileSync(harness, '\ufeff' + String.raw`
$ErrorActionPreference = 'Stop'
Set-Variable HOME $env:TEST_HOME -Force
$TaskName = 'Aside-' + $env:TEST_SLUG
$Minute = (Get-Date).Minute
$Launcher = Join-Path (Join-Path $HOME 'background') ($env:TEST_NAME + '-hourly-' + $Minute + '.ps1')
function Assert($Value, [string]$Message) { if (-not $Value) { throw $Message } }
function User-Sid([string]$UserId) {
    if ($UserId -match '^S-1-') { return $UserId }
    return (New-Object Security.Principal.NTAccount($UserId)).Translate([Security.Principal.SecurityIdentifier]).Value
}
try {
    $Before = Get-Date
    & (Join-Path $env:TEST_SCENARIO 'install.ps1') -Minute $Minute
    $Task = Get-ScheduledTask -TaskPath '\' -TaskName $TaskName -ErrorAction Stop
    $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    Assert ((User-Sid $Task.Principal.UserId) -eq $Identity.User.Value) 'Task principal is not the current Windows identity.'
    Assert ($Task.Principal.LogonType -eq 'Interactive') 'Expected an interactive token.'
    Assert ($Task.Principal.RunLevel -eq 'Limited') 'Expected limited user privileges.'
    Assert ($Task.Settings.MultipleInstances -eq 'IgnoreNew') 'Overlapping runs must be ignored.'
    Assert (@($Task.Actions).Count -eq 1) 'Expected exactly one action.'
    $Action = @($Task.Actions)[0]
    Assert ($Action.WorkingDirectory -ieq $env:TEST_SCENARIO) 'Wrong scenario working directory.'
    Assert ($Action.Execute -ieq (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')) 'Expected Windows PowerShell launcher.'
    Assert ($Action.Arguments -ceq ('-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "' + $Launcher + '"')) 'Expected process RemoteSigned and the named launcher.'
    Assert (Test-Path -LiteralPath $Launcher -PathType Leaf) 'Named launcher not created.'
    $Start = [datetime]::Parse(@($Task.Triggers)[0].StartBoundary)
    Assert ($Start -gt $Before -and $Start -le (Get-Date).AddHours(1)) 'First trigger must be in the next hour, not immediate.'
    Assert (@($Task.Triggers)[0].Repetition.Interval -eq 'PT1H') 'Expected hourly repetition.'
    & (Join-Path $env:TEST_SCENARIO 'uninstall.ps1')
    Assert (-not (Get-ScheduledTask -TaskPath '\' -TaskName $TaskName -ErrorAction SilentlyContinue)) 'Task survived uninstall.'
    Assert (-not (Test-Path -LiteralPath $Launcher)) 'Launcher survived uninstall.'
    foreach ($File in @((Join-Path $env:TEST_SCENARIO 'run.ps1'), (Join-Path $env:ASIDE_AUTOMATION_CREATOR_REPO 'engine.mjs'), $env:ASIDE_CLI_PATH)) {
        Assert (Test-Path -LiteralPath $File -PathType Leaf) ('Uninstall removed fixture source: ' + $File)
    }
    Write-Output 'PASS real Windows Task Scheduler: interactive limited identity, future hourly trigger, IgnoreNew, named RemoteSigned launcher, safe uninstall.'
} catch {
    $Diagnostic = Get-ScheduledTask -TaskPath '\' -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($Diagnostic) { $Diagnostic | Select-Object TaskName, Principal, Actions | ConvertTo-Json -Depth 5 | Write-Output }
    throw
} finally {
    $OwnTask = Get-ScheduledTask -TaskPath '\' -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($OwnTask) { Unregister-ScheduledTask -TaskPath '\' -TaskName $TaskName -Confirm:$false -ErrorAction Stop }
    if (Test-Path -LiteralPath $Launcher) { Remove-Item -LiteralPath $Launcher -Force }
}
`);
    const result = spawnSync(process.env.POWERSHELL_EXE || 'powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', harness], {
      encoding: 'utf8', env: { ...process.env, TEST_HOME: home, TEST_SCENARIO: scenario, TEST_SLUG: slug, TEST_NAME: name,
        ASIDE_AUTOMATION_CREATOR_REPO: repo, ASIDE_NODE_PATH: process.execPath, ASIDE_CLI_PATH: cli, ASIDE_CLI_AUTH_PATH: '' }
    });
    assert.equal(result.status, 0, result.stdout + result.stderr + (result.error ? String(result.error) : ''));
    process.stdout.write(result.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
