[CmdletBinding()]
param()
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

$Task = Get-ScheduledTask -TaskPath '\' -ErrorAction Stop | Where-Object { $_.TaskName -eq $TaskName }
if ($Task) {
    $Launcher = Assert-OwnedTask $Task
    Unregister-ScheduledTask -TaskName $TaskName -TaskPath '\' -Confirm:$false -ErrorAction Stop
    $Remaining = Get-ScheduledTask -TaskPath '\' -ErrorAction Stop | Where-Object { $_.TaskName -eq $TaskName }
    if ($Remaining) { throw 'Scheduled task removal verification failed.' }
    Remove-Item -LiteralPath $Launcher -Force
}
Write-Output 'Schedule removed. Scenario, shared engine, and runtime results were preserved.'
