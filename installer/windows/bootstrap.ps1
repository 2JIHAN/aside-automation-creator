[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PayloadDirectory,
    [Parameter(Mandatory = $true)][ValidateSet('x64', 'arm64')][string]$Architecture,
    [Parameter(Mandatory = $true)][string]$LogDirectory
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
$TranscriptStarted = $false
try {
    Start-Transcript -LiteralPath (Join-Path $LogDirectory 'install.log') -Force | Out-Null
    $TranscriptStarted = $true
    if ([Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'This installer requires Windows.' }
    $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    if ($Identity.User.Value -in @('S-1-5-18', 'S-1-5-19', 'S-1-5-20')) { throw 'Run Setup from your own Windows account, not a system service.' }
    $NativeArchitecture = $env:PROCESSOR_ARCHITECTURE
    if ($env:PROCESSOR_ARCHITEW6432) { $NativeArchitecture = $env:PROCESSOR_ARCHITEW6432 }
    $ExpectedArchitecture = @{ x64 = 'AMD64'; arm64 = 'ARM64' }[$Architecture]
    if ($NativeArchitecture -ne $ExpectedArchitecture) { throw "Download the Setup matching your Windows architecture ($NativeArchitecture)." }
    $AsideHome = if ($env:ASIDE_HOME) { $env:ASIDE_HOME } else { Join-Path $HOME '.aside' }
    $Profiles = Join-Path $AsideHome 'u'
    $Accounts = @(Get-ChildItem -LiteralPath $Profiles -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^\d+$' })
    if ($Accounts.Count -eq 0) { throw 'Open the installed Aside browser with your Windows account first, then run Setup again. No browser or account will be installed or reset.' }
    $Node = Join-Path $PayloadDirectory 'runtime/node.exe'
    foreach ($File in @($Node, (Join-Path $PayloadDirectory 'install-to-aside.ps1'))) {
        if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { throw "Missing installer payload: $File" }
    }
    $Cli = Join-Path $env:LOCALAPPDATA 'Aside/CLI/current/aside.exe'
    if (-not (Test-Path -LiteralPath $Cli -PathType Leaf)) {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $Installer = Join-Path $LogDirectory 'aside-cli-install.ps1'
        Invoke-WebRequest -UseBasicParsing -Uri 'https://releases.aside.com/install.ps1' -OutFile $Installer
        $Signature = Get-AuthenticodeSignature -LiteralPath $Installer
        $Publisher = 'CN=AT YOUR SIDE INC, O=AT YOUR SIDE INC, L=San Francisco, S=California, C=US'
        if ($Signature.Status -ne 'Valid' -or $null -eq $Signature.SignerCertificate -or $Signature.SignerCertificate.Subject -cne $Publisher -or $null -eq $Signature.TimeStamperCertificate) {
            throw 'The official Aside CLI installer signature, publisher, or timestamp could not be verified. Nothing from the download was executed.'
        }
        $global:LASTEXITCODE = 0
        & $Installer
        if ($LASTEXITCODE -ne 0) { throw "Aside CLI installation failed (exit $LASTEXITCODE)." }
        if (-not (Test-Path -LiteralPath $Cli -PathType Leaf)) { throw "The official installer did not create $Cli" }
    }
    $env:ASIDE_CLI_PATH = $Cli
    $env:ASIDE_NODE_PATH = $Node
    $env:PATH = (Split-Path -Parent $Node) + [IO.Path]::PathSeparator + (Split-Path -Parent $Cli) + [IO.Path]::PathSeparator + $env:PATH
    $global:LASTEXITCODE = 0
    & (Join-Path $PayloadDirectory 'install-to-aside.ps1') -SourceDirectory $PayloadDirectory -AsideHome $AsideHome -Repository (Join-Path $HOME '.local/share/aside-automation-creator')
    if ($LASTEXITCODE -ne 0) { throw "Skill installation failed (exit $LASTEXITCODE)." }
    Write-Output 'Installation complete. Open Aside to use aside-automation-creator.'
} catch {
    $_ | Out-String | Set-Content -LiteralPath (Join-Path $LogDirectory 'error.txt') -Encoding UTF8
    Write-Output $_
    exit 1
} finally {
    if ($TranscriptStarted) { Stop-Transcript | Out-Null }
}
