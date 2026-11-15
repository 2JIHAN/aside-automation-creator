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
if (-not (Test-Path -LiteralPath $Cli -PathType Leaf)) { throw 'Aside CLI not found. Install it from Aside Settings > Developers.' }
$env:ASIDE_CLI_PATH = [IO.Path]::GetFullPath($Cli)
$env:TZ = '__TIMEZONE__'
Set-Location -LiteralPath $Directory
$FlowScript = @'
const fs=require("fs"),path=require("path");const root=fs.realpathSync(process.cwd()),modeFile=path.join(root,"workflow/mode.json");if(!fs.lstatSync(modeFile).isFile())process.exit(1);const m=JSON.parse(fs.readFileSync(modeFile,"utf8"));const f=m.flows&&Object.hasOwn(m.flows,m.mode)&&m.flows[m.mode];if(typeof f!=="string"||!f)process.exit(1);const requested=path.resolve(root,f),real=fs.realpathSync(requested);if(!real.startsWith(root+path.sep)||!fs.lstatSync(requested).isFile())process.exit(1);console.log(f)
'@
$Flow = $FlowScript | & $Node - 2>$null
if ($LASTEXITCODE -ne 0) { throw 'workflow/mode.json does not select a valid scenario flow.' }

$LockScript = @'
const fs=require("fs"),path=require("path");try{const runs=path.join(process.argv[2],"runs");if(fs.existsSync(runs)){if(!fs.lstatSync(runs).isDirectory())throw Error();}else fs.mkdirSync(runs);const lock=path.join(runs,".run.lock");fs.mkdirSync(lock);fs.writeFileSync(path.join(lock,"pid"),process.argv[3],{flag:"wx"});}catch{console.error("Run resources are invalid or another run holds the lock.");process.exit(4);}
'@
$LockScript | & $Node - $Directory ([string]$PID)
if ($LASTEXITCODE -ne 0) { throw 'Cannot acquire the scenario run lock.' }
$ExitCode = 1
try {
    $Accounts = @(& $env:ASIDE_CLI_PATH account list)
    if ($LASTEXITCODE -ne 0) { throw 'Aside account list failed.' }
    $Matches = @($Accounts | ForEach-Object {
        $Match = [regex]::Match([string]$_, '(?:^|\s)(u[0-9]+)\s+(\S+)')
        if ($Match.Success -and $Match.Groups[2].Value -ieq '__ACCOUNT_EMAIL__') { $Match.Groups[1].Value }
    })
    if ($Matches.Count -ne 1) { throw 'Expected exactly one matching Aside account.' }
    & $Node (Join-Path $Repository 'engine.mjs') $Matches[0] $Directory $Flow
    $ExitCode = $LASTEXITCODE
} finally {
    # Remove only the PID file and empty lock directory owned by this process.
    $UnlockScript = @'
const fs=require("fs"),path=require("path");const runs=path.join(process.argv[2],"runs"),lock=path.join(runs,".run.lock"),pid=path.join(lock,"pid");if(!fs.lstatSync(runs).isDirectory()||!fs.existsSync(lock)||!fs.lstatSync(lock).isDirectory()||!fs.existsSync(pid)||!fs.lstatSync(pid).isFile())process.exit(0);if(fs.readFileSync(pid,"utf8")!==process.argv[3])process.exit(0);fs.unlinkSync(pid);fs.rmdirSync(lock);
'@
    $UnlockScript | & $Node - $Directory ([string]$PID)
    if ($LASTEXITCODE -ne 0 -and $ExitCode -eq 0) { $ExitCode = 4 }
}
exit $ExitCode
