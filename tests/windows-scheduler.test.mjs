import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const template = fileURLToPath(new URL('../assets/template/', import.meta.url));
const powershell = process.env.POWERSHELL_EXE || (process.platform === 'win32' ? 'powershell.exe' : 'pwsh');
const available = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8' }).status === 0;
const cleaner = '/Users/seesoong/.aside/u/0/skills/user/quarantine-free-files/scripts/clear-quarantine.sh';
function clean(paths) {
  if (process.platform !== 'darwin') return;
  const result = spawnSync('/bin/bash', [cleaner, ...paths], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('scheduler scripts have Windows PowerShell 5.1-readable UTF8 BOM', () => {
  for (const file of ['install.ps1', 'uninstall.ps1']) {
    assert.deepEqual([...readFileSync(join(template, file)).subarray(0, 3)], [239, 187, 191]);
  }
});

test('mocked scheduler installs, reinstalls and removes only its own interactive hourly task', { skip: !available }, t => {
  const root = mkdtempSync(join(tmpdir(), 'aside-windows-scheduler-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scenario = join(root, "scenario's files");
  const home = join(root, 'home');
  const repo = join(root, 'shared repo');
  for (const dir of [scenario, home, repo]) mkdirSync(dir, { recursive: true });
  for (const file of ['install.ps1', 'uninstall.ps1']) {
    const source = readFileSync(join(template, file), 'utf8').replaceAll('__AUTOMATION_SLUG__', 'scheduler-test').replaceAll('__AUTOMATION_NAME__', 'Friendly Test');
    writeFileSync(join(scenario, file), source);
  }
  for (const file of [join(scenario, 'run.ps1'), join(repo, 'engine.mjs'), join(root, 'node.exe'), join(root, 'aside.exe'), join(root, 'auth.json')]) writeFileSync(file, 'fixture');
  const harness = join(root, 'harness.ps1');
  writeFileSync(harness, '\ufeff' + String.raw`
$ErrorActionPreference = 'Stop'
Set-Variable HOME $env:TEST_HOME -Force
$env:USERNAME = 'test-user'
$env:USERDOMAIN = 'TEST-DOMAIN'
$env:SystemRoot = $env:TEST_HOME
$env:ASIDE_AUTOMATION_CREATOR_REPO = $env:TEST_REPO
$env:ASIDE_NODE_PATH = Join-Path $env:TEST_ROOT 'node.exe'
$env:ASIDE_CLI_PATH = Join-Path $env:TEST_ROOT 'aside.exe'
$env:ASIDE_CLI_AUTH_PATH = Join-Path $env:TEST_ROOT 'auth.json'
$global:MockTask = $null
$global:FailRegister = $false
$global:FixedNow = [datetime]'2026-11-01T10:30:00'
function Get-Date { $global:FixedNow }
function Assert($Value, $Message) { if (-not $Value) { throw $Message } }
function Get-ScheduledTask { param($TaskPath, $ErrorAction) if ($global:MockTask) { $global:MockTask } }
function New-ScheduledTaskAction { param($Execute, $Argument, $WorkingDirectory) [pscustomobject]@{ Execute=$Execute; Arguments=$Argument; WorkingDirectory=$WorkingDirectory } }
function New-ScheduledTaskTrigger { param([switch]$Once, $At, $RepetitionInterval) Assert $Once 'not a once trigger'; [pscustomobject]@{At=$At; Interval=$RepetitionInterval} }
function New-ScheduledTaskPrincipal { param($UserId, $LogonType, $RunLevel) [pscustomobject]@{UserId=$UserId; LogonType=$LogonType; RunLevel=$RunLevel} }
function New-ScheduledTaskSettingsSet { param($MultipleInstances) [pscustomobject]@{MultipleInstances=$MultipleInstances} }
function New-ScheduledTask { param($Action,$Trigger,$Principal,$Settings,$Description) [pscustomobject]@{Actions=@($Action); Triggers=@($Trigger); Principal=$Principal; Settings=$Settings; Description=$Description; TaskName='Aside-scheduler-test'} }
function Register-ScheduledTask { param($TaskName,$TaskPath,$InputObject,[switch]$Force,$ErrorAction) if ($global:FailRegister) { throw 'mock registration failure' }; $global:MockTask=$InputObject }
function Unregister-ScheduledTask { param($TaskName,$TaskPath,$Confirm,$ErrorAction) $global:MockTask=$null }
function Expect-Failure([scriptblock]$Block) { $Failed=$false; try { & $Block } catch { $Failed=$true }; Assert $Failed 'expected refusal' }
$Install = Join-Path $env:TEST_SCENARIO 'install.ps1'
$Uninstall = Join-Path $env:TEST_SCENARIO 'uninstall.ps1'
$Before = Get-Date
& $Install
$After = Get-Date
$Task = $global:MockTask
Assert ($Task.Principal.UserId -eq 'TEST-DOMAIN\test-user') 'wrong user'
Assert ($Task.Principal.LogonType -eq 'Interactive') 'not interactive'
Assert ($Task.Principal.RunLevel -eq 'Limited') 'not limited'
Assert ($Task.Settings.MultipleInstances -eq 'IgnoreNew') 'overlap not blocked'
Assert ($Task.Triggers[0].At -gt $Before -and $Task.Triggers[0].At -le $After.AddHours(1)) 'first occurrence not future'
Assert ($Task.Triggers[0].At -eq [datetime]'2026-11-01T11:30:00') 'exact current minute must advance to next hour'
Assert ($Task.Triggers[0].Interval.TotalHours -eq 1) 'not hourly'
$First = Join-Path $HOME 'background/Friendly Test-hourly-30.ps1'
Assert (Test-Path -LiteralPath $First) 'missing launcher'
Assert ($Task.Actions[0].Arguments -eq ('-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "' + $First + '"')) 'action not named launcher'
Assert ($Task.Actions[0].WorkingDirectory -eq $env:TEST_SCENARIO) 'wrong working directory'
$Text = [IO.File]::ReadAllText($First)
Assert ($Text.Contains($env:ASIDE_NODE_PATH) -and $Text.Contains($env:ASIDE_CLI_PATH) -and $Text.Contains($env:TEST_REPO)) 'missing captured paths'
Assert (-not $Text.Contains('fixture')) 'secret content copied'
$Tokens=$null; $Errors=$null
$null=[System.Management.Automation.Language.Parser]::ParseFile($First,[ref]$Tokens,[ref]$Errors)
Assert ($Errors.Count -eq 0) 'generated launcher parse failed'
& $Install 7
$Second = Join-Path $HOME 'background/Friendly Test-hourly-7.ps1'
Assert (-not (Test-Path -LiteralPath $First)) 'old launcher retained'
Assert (Test-Path -LiteralPath $Second) 'new launcher missing'
Assert ($global:MockTask.Triggers[0].At.Minute -eq 7) 'minute change not accepted'
$Original = [IO.File]::ReadAllText($Second)
$global:FailRegister=$true
Expect-Failure { & $Install 7 }
Assert ([IO.File]::ReadAllText($Second) -ceq $Original) 'failed reinstall did not restore launcher'
Expect-Failure { & $Install 8 }
Assert (-not (Test-Path -LiteralPath (Join-Path $HOME 'background/Friendly Test-hourly-8.ps1'))) 'failed install left launcher'
$global:FailRegister=$false
$global:MockTask.Description='unrelated'
Expect-Failure { & $Install }
Expect-Failure { & $Uninstall }
Assert (Test-Path -LiteralPath $Second) 'collision deleted launcher'
$global:MockTask.Description=$Task.Description
$global:MockTask.Principal.UserId='unrelated'
Expect-Failure { & $Uninstall }
$global:MockTask.Principal.UserId='TEST-DOMAIN\test-user'
$global:MockTask.Actions[0].WorkingDirectory='unrelated'
Expect-Failure { & $Uninstall }
$global:MockTask.Actions[0].WorkingDirectory=$env:TEST_SCENARIO
$global:MockTask.Actions[0].Arguments='-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "unrelated.ps1"'
Expect-Failure { & $Uninstall }
$global:MockTask.Actions[0].Arguments='-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "' + $Second + '"'
[IO.File]::WriteAllText($Second, 'unrelated launcher')
Expect-Failure { & $Install 7 }
Expect-Failure { & $Uninstall }
[IO.File]::WriteAllText($Second,$Original)
& $Uninstall
Assert (-not $global:MockTask) 'task retained'
Assert (-not (Test-Path -LiteralPath $Second)) 'launcher retained'
Assert (Test-Path -LiteralPath (Join-Path $env:TEST_SCENARIO 'run.ps1')) 'scenario removed'
Assert (Test-Path -LiteralPath (Join-Path $env:TEST_REPO 'engine.mjs')) 'shared engine removed'
& $Uninstall
$env:LOCALAPPDATA = Join-Path $env:TEST_ROOT 'local-app-data'
$DefaultCli = Join-Path $env:LOCALAPPDATA 'Aside/CLI/current/aside.exe'
$null = New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($DefaultCli)) -Force
[IO.File]::WriteAllText($DefaultCli,'default cli fixture')
Remove-Item Env:ASIDE_CLI_PATH
Remove-Item Env:ASIDE_CLI_AUTH_PATH
$global:FixedNow = [datetime]'2026-11-01T10:29:59'
& $Install 30
Assert ($global:MockTask.Triggers[0].At -eq [datetime]'2026-11-01T10:30:00') 'future current-hour minute should not skip an hour'
$Text = [IO.File]::ReadAllText($First)
Assert ($Text.Contains($DefaultCli)) 'official CLI default path not captured'
Assert ($Text.Contains('Remove-Item Env:ASIDE_CLI_AUTH_PATH')) 'absent auth path not cleared'
& $Uninstall
[IO.File]::WriteAllText($Second,'unrelated launcher')
Expect-Failure { & $Install 7 }
Assert ([IO.File]::ReadAllText($Second) -eq 'unrelated launcher') 'standalone collision overwritten'
Expect-Failure { & $Install 60 }
Write-Output 'MOCK SCHEDULER PASS: future hourly trigger; interactive limited user; captured paths; rename cleanup; rollback; collision refusals; idempotent uninstall; preserved source.'
`);
  clean([root]);
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-File', harness], {
    encoding: 'utf8', env: { ...process.env, TEST_ROOT: root, TEST_HOME: home, TEST_REPO: repo, TEST_SCENARIO: scenario, POWERSHELL_TELEMETRY_OPTOUT: '1', POWERSHELL_UPDATECHECK: 'Off' },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /MOCK SCHEDULER PASS/);
  console.log(result.stdout.trim());
});
