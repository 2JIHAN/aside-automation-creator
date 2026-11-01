[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('x64', 'arm64')][string]$Architecture,
    [string]$NodeVersion,
    [string]$Version = '0.0.0',
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'dist')
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ([Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'Build on Windows to verify Authenticode signatures.' }
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
if (-not $NodeVersion) {
    $Index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json'
    $NodeVersion = ($Index | Where-Object { $_.lts } | Select-Object -First 1).version
}
if ($NodeVersion -notmatch '^v\d+\.\d+\.\d+$') { throw 'NodeVersion must be an exact official Node version, such as v24.0.0.' }
$Version = $Version -replace '^v', ''
if ($Version -notmatch '^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$') { throw 'Version must be a release version.' }
$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$Work = Join-Path ([IO.Path]::GetTempPath()) ('aside-setup-build-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Work | Out-Null
try {
    $Payload = Join-Path $Work 'payload'
    New-Item -ItemType Directory -Path (Join-Path $Payload 'runtime') -Force | Out-Null
    foreach ($Name in @('engine.mjs', 'SKILL.md', 'README.md', 'install-to-aside.ps1', 'assets')) {
        Copy-Item -LiteralPath (Join-Path $Root $Name) -Destination $Payload -Recurse
    }
    $ArchiveName = "node-$NodeVersion-win-$Architecture.zip"
    $BaseUrl = "https://nodejs.org/dist/$NodeVersion"
    $Archive = Join-Path $Work $ArchiveName
    Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/$ArchiveName" -OutFile $Archive
    $Sums = (Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/SHASUMS256.txt").Content
    $HashPattern = '(?m)^([a-fA-F0-9]{64})\s+' + [regex]::Escape($ArchiveName) + '\s*$'
    $Match = [regex]::Match([string]$Sums, $HashPattern)
    if (-not $Match.Success -or (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash -ine $Match.Groups[1].Value) { throw 'Official Node ZIP SHA256 verification failed.' }
    Expand-Archive -LiteralPath $Archive -DestinationPath (Join-Path $Work 'node')
    $NodeRoot = Join-Path (Join-Path $Work 'node') "node-$NodeVersion-win-$Architecture"
    $Node = Join-Path $NodeRoot 'node.exe'
    $Signature = Get-AuthenticodeSignature -LiteralPath $Node
    if ($Signature.Status -ne 'Valid' -or $null -eq $Signature.SignerCertificate -or $Signature.SignerCertificate.Subject -notmatch '(^|,\s*)CN=OpenJS Foundation(,|$)' -or $Signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=OpenJS Foundation(,|$)') {
        throw 'Node executable must have a valid OpenJS Foundation Authenticode signature.'
    }
    Copy-Item -LiteralPath $Node -Destination (Join-Path $Payload 'runtime/node.exe')
    Copy-Item -LiteralPath (Join-Path $NodeRoot 'LICENSE') -Destination (Join-Path $Payload 'runtime/NODE-LICENSE.txt')
    @{ name = 'aside-automation-creator'; version = $Version; nodeVersion = $NodeVersion; architecture = $Architecture } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Payload 'package.json') -Encoding UTF8
    $Compiler = Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6/ISCC.exe'
    if (-not (Test-Path -LiteralPath $Compiler)) {
        & choco install innosetup --yes --no-progress
        if ($LASTEXITCODE -ne 0) { throw 'Inno Setup installation failed.' }
    }
    if (-not (Test-Path -LiteralPath $Compiler)) { throw "Inno Setup compiler not found: $Compiler" }
    & $Compiler "/DArchitecture=$Architecture" "/DAppVersion=$Version" "/DPayloadDir=$Payload" "/DOutputDir=$OutputDirectory" (Join-Path $PSScriptRoot 'setup.iss')
    if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed (exit $LASTEXITCODE)." }
    Write-Output "Built native $Architecture Setup using Node $NodeVersion. Setup is unsigned; Windows SmartScreen may warn."
} finally {
    Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
}
