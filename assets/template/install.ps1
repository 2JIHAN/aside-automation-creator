[CmdletBinding()]
param([ValidateRange(0, 59)][int]$Minute = 30)
$ErrorActionPreference = 'Stop'
$Dir = [IO.Path]::GetFullPath($PSScriptRoot)
$Slug = '__AUTOMATION_SLUG__'
$Name = '__AUTOMATION_NAME__'
if ($Slug -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$' -or $Name -match '__AUTOMATION_' -or
    $Name -match '[<>:"/\\|?*\x00-\x1f]' -or $Name.EndsWith('.') -or $Name.EndsWith(' ')) { throw 'Set valid template values first.' }
if (-not $env:USERDOMAIN -or -not $env:USERNAME -or -not $env:SystemRoot) { throw 'Run as the current Windows user.' }
$UserId = $env:USERDOMAIN + '\' + $env:USERNAME
$PowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$TaskName = 'Aside-' + $Slug
$Background = Join-Path $HOME 'background'
$Marker = '# Managed by aside-automation-creator: ' + $Slug
$OwnerLine = '# Scenario: ' + $Dir
$Description = $Marker + "\n" + $OwnerLine
$LauncherPattern = '^' + [regex]::Escape($Name) + '-hourly-(?:[0-9]|[1-5][0-9])\.ps1$'

$BackgroundItem = Get-Item -LiteralPath $Background -Force -ErrorAction SilentlyContinue
if ($BackgroundItem -and (-not $BackgroundItem.PSIsContainer -or ($BackgroundItem.Attributes -band [IO.FileAttributes]::ReparsePoint))) { throw 'Background must be a regular directory.' }

function Assert-OwnedTask($Task) {
    if ($Task.Description -cne $Description -or @($Task.Actions).Count -ne 1) { throw 'Refusing an unrelated scheduled task.' }
    $Action = @($Task.Actions)[0]
    if ($Action.Execute -ine $PowerShell -or $Action.WorkingDirectory -ine $Dir -or
        $Task.Principal.UserId -ine $UserId -or $Task.Principal.LogonType -ne 'Interactive' -or
        $Task.Principal.RunLevel -ne 'Limited') { throw 'Scheduled task ownership does not match.' }
    $Prefix = '-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "'
    if (-not $Action.Arguments.StartsWith($Prefix) -or -not $Action.Arguments.EndsWith('"')) { throw 'Unexpected task action.' }
    $File = $Action.Arguments.Substring($Prefix.Length, $Action.Arguments.Length - $Prefix.Length - 1)
    $Parent = [IO.Path]::GetDirectoryName($File)
    $Leaf = [IO.Path]::GetFileName($File)
    if ($Parent -ine $Background -or $Leaf -notmatch $LauncherPattern) { throw 'Unexpected launcher path.' }
    Assert-OwnedLauncher $File
    return $File
}
function Assert-OwnedLauncher([string]$File) {
    $Item = Get-Item -LiteralPath $File -ErrorAction Stop
    if ($Item.PSIsContainer -or ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Launcher is not a regular file.' }
    $Lines = [IO.File]::ReadAllLines($File)
    if ($Lines.Count -lt 2 -or $Lines[0] -cne $Marker -or $Lines[1] -cne $OwnerLine) { throw 'Refusing an unrelated launcher.' }
}

function Resolve-File([string]$Value) {
    $Item = Get-Item -LiteralPath $Value -ErrorAction Stop
    if ($Item.PSIsContainer) { throw ('Expected a file: ' + $Value) }
    return $Item.FullName
}
function Quote-PS([string]$Value) { return "'" + $Value.Replace("'", "''") + "'" }
$Run = Resolve-File (Join-Path $Dir 'run.ps1')
$Repo = $env:ASIDE_AUTOMATION_CREATOR_REPO
if (-not $Repo) { $Repo = Join-Path $HOME '.local\share\aside-automation-creator' }
$Repo = (Get-Item -LiteralPath $Repo -ErrorAction Stop).FullName
$null = Resolve-File (Join-Path $Repo 'engine.mjs')
$Node = $env:ASIDE_NODE_PATH
if (-not $Node) {
    $NodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($NodeCommand) { $Node = $NodeCommand.Source } else { $Node = Join-Path $Repo 'runtime/node.exe' }
}
$Node = Resolve-File $Node
$Cli = $env:ASIDE_CLI_PATH
if (-not $Cli) { $Cli = Join-Path $env:LOCALAPPDATA 'Aside\CLI\current\aside.exe' }
$Cli = Resolve-File $Cli
$AuthPath = $null
if ($env:ASIDE_CLI_AUTH_PATH) { $AuthPath = Resolve-File $env:ASIDE_CLI_AUTH_PATH }
$Launcher = Join-Path $Background ($Name + '-hourly-' + $Minute + '.ps1')
$OldTask = Get-ScheduledTask -TaskPath '\' -ErrorAction Stop | Where-Object { $_.TaskName -eq $TaskName }
$OldLauncher = $null
if ($OldTask) { $OldLauncher = Assert-OwnedTask $OldTask }
if (Get-Item -LiteralPath $Launcher -Force -ErrorAction SilentlyContinue) { Assert-OwnedLauncher $Launcher }
$Now = Get-Date
$Next = $Now.Date.AddHours($Now.Hour).AddMinutes($Minute)
if ($Next -le $Now) { $Next = $Next.AddHours(1) }
$Trigger = New-ScheduledTaskTrigger -Once -At $Next -RepetitionInterval (New-TimeSpan -Hours 1)
$Principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew
$Arguments = '-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "' + $Launcher + '"'
$Action = New-ScheduledTaskAction -Execute $PowerShell -Argument $Arguments -WorkingDirectory $Dir
$Task = New-ScheduledTask -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Description $Description
$Lines = @($Marker, $OwnerLine, '$ErrorActionPreference = ''Stop''',
    ('$env:ASIDE_AUTOMATION_CREATOR_REPO = ' + (Quote-PS $Repo)),
    ('$env:ASIDE_NODE_PATH = ' + (Quote-PS $Node)),
    ('$env:ASIDE_CLI_PATH = ' + (Quote-PS $Cli)))
if ($AuthPath) { $Lines += '$env:ASIDE_CLI_AUTH_PATH = ' + (Quote-PS $AuthPath) }
else { $Lines += 'Remove-Item Env:ASIDE_CLI_AUTH_PATH -ErrorAction SilentlyContinue' }
$Lines += '& ' + (Quote-PS $Run)
$Lines += 'exit $LASTEXITCODE'
$null = New-Item -ItemType Directory -Path $Background -Force
$Previous = $null
if (Test-Path -LiteralPath $Launcher) { $Previous = [IO.File]::ReadAllBytes($Launcher) }
[IO.File]::WriteAllLines($Launcher, $Lines, (New-Object Text.UTF8Encoding($true)))
try {
    $null = Register-ScheduledTask -TaskName $TaskName -TaskPath '\' -InputObject $Task -Force -ErrorAction Stop
} catch {
    if ($null -ne $Previous) { [IO.File]::WriteAllBytes($Launcher, $Previous) }
    else { Remove-Item -LiteralPath $Launcher -Force }
    throw
}
$Accepted = Get-ScheduledTask -TaskPath '\' -ErrorAction Stop | Where-Object { $_.TaskName -eq $TaskName }
if (-not $Accepted -or (Assert-OwnedTask $Accepted) -ine $Launcher) { throw 'Scheduled task verification failed.' }
if ($OldLauncher -and $OldLauncher -ine $Launcher) { Remove-Item -LiteralPath $OldLauncher -Force }
Write-Output ('Registered ' + $TaskName + ' at minute ' + $Minute + '. First run: ' + $Next.ToString('s') + ' (system time zone). Not run now.')
