Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
if ($args.Count -ne 0) { throw 'Usage: .\run.ps1 (no arguments)' }
$Directory = $PSScriptRoot
$Repository = if ($env:ASIDE_AUTOMATION_CREATOR_REPO) { $env:ASIDE_AUTOMATION_CREATOR_REPO } else { Join-Path $HOME '.local/share/aside-automation-creator' }
$Node = $env:ASIDE_NODE_PATH
if (-not $Node) {
    $NodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($NodeCommand) { $Node = $NodeCommand.Source } else { $Node = Join-Path $Repository 'runtime/node.exe' }
}
if (-not (Test-Path -LiteralPath $Node -PathType Leaf)) { throw 'Node.js not found. Run the setup installer first.' }
$Cli = $env:ASIDE_CLI_PATH
if (-not $Cli) {
    $Command = Get-Command aside.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($Command) { $Cli = $Command.Source } else {
        $CliRoot = if ($env:ASIDE_CLI_INSTALL_DIR) { $env:ASIDE_CLI_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Aside/CLI' }
        $Cli = Join-Path $CliRoot 'current/aside.exe'
    }
}
if (-not (Test-Path -LiteralPath $Cli -PathType Leaf)) { throw "Aside CLI not found: $Cli. Install it from Aside Settings > Developers." }
$env:ASIDE_CLI_PATH = [IO.Path]::GetFullPath($Cli)
$env:TZ = '__TIMEZONE__'
Set-Location -LiteralPath $Directory
$Accounts = @(& $env:ASIDE_CLI_PATH account list)
if ($LASTEXITCODE -ne 0) { throw 'Aside account list failed.' }
$Matches = @($Accounts | ForEach-Object {
    $Match = [regex]::Match([string]$_, '(?:^|\s)(u[0-9]+)\s+(\S+)')
    if ($Match.Success -and $Match.Groups[2].Value -ieq '__ACCOUNT_EMAIL__') { $Match.Groups[1].Value }
})
if ($Matches.Count -ne 1) { throw 'Expected exactly one matching Aside account.' }
& $Node (Join-Path $Repository 'engine.mjs') $Matches[0] $Directory
exit $LASTEXITCODE
