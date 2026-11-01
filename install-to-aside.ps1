[CmdletBinding()]
param(
    [string]$AsideHome = $(if ($env:ASIDE_HOME) { $env:ASIDE_HOME } else { Join-Path $HOME '.aside' }),
    [string]$Repository = $(if ($env:ASIDE_AUTOMATION_CREATOR_REPO) { $env:ASIDE_AUTOMATION_CREATOR_REPO } else { Join-Path $HOME '.local/share/aside-automation-creator' }),
    [string]$SourceDirectory = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Url = 'https://github.com/2JIHAN/aside-automation-creator.git'

function Assert-NoLink([string]$Path) {
    $Item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    if ($null -ne $Item) {
        if ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Refusing symlink or junction: $Path"
        }
    }
}
function Ensure-Directory([string]$Path) {
    $Parent = Split-Path -Parent $Path
    if ($Parent -and $Parent -ne $Path) { Ensure-Directory $Parent }
    Assert-NoLink $Path
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
}
function Assert-Tree([string]$Path) {
    Assert-NoLink $Path
    foreach ($Item in Get-ChildItem -LiteralPath $Path -Force) {
        Assert-NoLink $Item.FullName
        if ($Item.PSIsContainer) { Assert-Tree $Item.FullName }
    }
}
function Invoke-Git([string[]]$GitArgs) {
    $global:LASTEXITCODE = 0
    & git @GitArgs
    if ($LASTEXITCODE -ne 0) { throw "Git failed (exit $LASTEXITCODE)." }
}
function Assert-Source([string]$Path) {
    foreach ($Name in @('SKILL.md', 'engine.mjs')) {
        $File = Join-Path $Path $Name
        Assert-NoLink $File
        if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { throw "Missing $Name in $Path" }
    }
    $Assets = Join-Path $Path 'assets'
    if (-not (Test-Path -LiteralPath $Assets -PathType Container)) { throw 'Missing assets.' }
    Assert-Tree $Assets
    if (-not (Select-String -LiteralPath (Join-Path $Path 'SKILL.md') -SimpleMatch -CaseSensitive -Pattern 'name: "aside-automation-creator"' -Quiet)) { throw 'Unexpected skill name.' }
}
function Get-Fingerprint([string]$Path) {
    $Base = (Get-Item -LiteralPath $Path).FullName.TrimEnd([IO.Path]::DirectorySeparatorChar)
    $Lines = @(Get-ChildItem -LiteralPath $Path -Force -Recurse | Sort-Object FullName | ForEach-Object {
        $Relative = $_.FullName.Substring($Base.Length).Replace('\', '/')
        if ($_.PSIsContainer) { 'D ' + $Relative } else { 'F ' + $Relative + ' ' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
    })
    return ($Lines -join "`n")
}
function Test-SameSkill([string]$Stage, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Destination -PathType Container)) { return $false }
    try {
        Assert-Tree $Destination
        return (Get-Fingerprint $Stage) -ceq (Get-Fingerprint $Destination)
    } catch { return $false }
}

if (-not $SourceDirectory) { Get-Command git -ErrorAction Stop | Out-Null }
$AsideHome = [IO.Path]::GetFullPath($AsideHome)
$Repository = [IO.Path]::GetFullPath($Repository)
$Users = Join-Path $AsideHome 'u'
Assert-NoLink $AsideHome
Assert-NoLink $Users
if (-not (Test-Path -LiteralPath $Users -PathType Container)) { throw "Aside profiles not found: $Users" }
Ensure-Directory $AsideHome
$Accounts = @(Get-ChildItem -LiteralPath $Users -Directory -Force | Where-Object { $_.Name -match '^\d+$' })
if ($Accounts.Count -eq 0) { throw 'No numeric Aside profiles found.' }
foreach ($Account in $Accounts) {
    Assert-NoLink $Account.FullName
    Assert-NoLink (Join-Path $Account.FullName 'skills')
    Assert-NoLink (Join-Path $Account.FullName 'skills/user')
}
Assert-NoLink $Repository
Ensure-Directory (Split-Path -Parent $Repository)
$Work = Join-Path $AsideHome ('.automation-creator-install.' + [guid]::NewGuid().ToString('N'))
$Stamp = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $PID
Ensure-Directory $Work
try {
    if ($SourceDirectory) {
        $SourceDirectory = [IO.Path]::GetFullPath($SourceDirectory)
        if ($SourceDirectory -eq $Repository) { throw 'Package source and destination must differ.' }
        Assert-Source $SourceDirectory
        Assert-Tree $SourceDirectory
        $Fresh = Join-Path $Work 'repository'
        Copy-Item -LiteralPath $SourceDirectory -Destination $Fresh -Recurse
        Assert-Source $Fresh
        $RepoBackup = $null
        if (Test-Path -LiteralPath $Repository) {
            $Owner = Join-Path $Repository 'SKILL.md'
            Assert-NoLink $Owner
            if (-not (Test-Path -LiteralPath $Owner -PathType Leaf) -or
                -not (Select-String -LiteralPath $Owner -SimpleMatch -CaseSensitive -Pattern 'name: "aside-automation-creator"' -Quiet)) { throw 'Refusing an unrelated package destination.' }
            $RepoBackup = $Repository + '.backup-' + $Stamp
            if (Test-Path -LiteralPath $RepoBackup) { throw 'Backup already exists.' }
            Move-Item -LiteralPath $Repository -Destination $RepoBackup
        }
        try { Move-Item -LiteralPath $Fresh -Destination $Repository } catch {
            if ($RepoBackup -and -not (Test-Path -LiteralPath $Repository)) { Move-Item -LiteralPath $RepoBackup -Destination $Repository }
            throw
        }
        if ($RepoBackup) { Write-Host "Previous package backed up: $RepoBackup" }
    } elseif (Test-Path -LiteralPath $Repository) {
        $GitDirectory = Join-Path $Repository '.git'
        Assert-NoLink $GitDirectory
        if (-not (Test-Path -LiteralPath $GitDirectory -PathType Container)) { throw "Refusing unrelated directory: $Repository" }
        if ((@(Invoke-Git @('-C', $Repository, 'remote', 'get-url', 'origin')) -join "`n").Trim() -ne $Url) { throw 'Unexpected source remote.' }
        if ((@(Invoke-Git @('-C', $Repository, 'symbolic-ref', '--short', 'HEAD')) -join "`n").Trim() -ne 'main') { throw 'Source must be on main.' }
        $Dirty = (@(Invoke-Git @('-C', $Repository, 'status', '--porcelain')) -join "`n").Trim()
        if ($Dirty) {
            $Fresh = Join-Path $Work 'repository'
            Invoke-Git @('clone', '--branch', 'main', '--single-branch', $Url, $Fresh)
            Assert-Source $Fresh
            $RepoBackup = $Repository + '.backup-' + $Stamp
            if (Test-Path -LiteralPath $RepoBackup) { throw "Backup already exists: $RepoBackup" }
            Move-Item -LiteralPath $Repository -Destination $RepoBackup
            try { Move-Item -LiteralPath $Fresh -Destination $Repository } catch {
                if (-not (Test-Path -LiteralPath $Repository)) { Move-Item -LiteralPath $RepoBackup -Destination $Repository }
                throw "Source replacement failed. Original preserved at $RepoBackup. $($_.Exception.Message)"
            }
            Write-Host "Modified source backed up: $RepoBackup"
        } else { Invoke-Git @('-C', $Repository, 'pull', '--ff-only') }
    } else { Invoke-Git @('clone', '--branch', 'main', '--single-branch', $Url, $Repository) }
    Assert-Source $Repository
    $Stage = Join-Path $Work 'skill'
    Ensure-Directory $Stage
    Copy-Item -LiteralPath (Join-Path $Repository 'SKILL.md') -Destination $Stage
    Copy-Item -LiteralPath (Join-Path $Repository 'assets') -Destination $Stage -Recurse
    $BackupRoot = Join-Path $AsideHome ('skill-backups/aside-automation-creator/' + $Stamp)
    $Installed = 0
    foreach ($Account in $Accounts) {
        $Parent = Join-Path $Account.FullName 'skills/user'
        Ensure-Directory $Parent
        $Destination = Join-Path $Parent 'aside-automation-creator'
        if (Test-SameSkill $Stage $Destination) { Write-Host "u$($Account.Name): already current"; continue }
        $Prepared = Join-Path $Work ('profile-' + $Account.Name)
        Copy-Item -LiteralPath $Stage -Destination $Prepared -Recurse
        $Backup = $null
        if ($null -ne (Get-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue)) {
            Ensure-Directory $BackupRoot
            $Backup = Join-Path $BackupRoot ('u' + $Account.Name)
            Move-Item -LiteralPath $Destination -Destination $Backup
        }
        try { Move-Item -LiteralPath $Prepared -Destination $Destination } catch {
            if ($Backup -and -not (Test-Path -LiteralPath $Destination)) { Move-Item -LiteralPath $Backup -Destination $Destination }
            throw
        }
        $Installed++
        Write-Host "u$($Account.Name): installed $Destination"
        if ($Backup) { Write-Host "Previous skill: $Backup" }
    }
    Write-Host "Installed/updated: $Installed. Open a new Aside chat. Shared source: $Repository"
} finally {
    if (Test-Path -LiteralPath $Work) { Remove-Item -LiteralPath $Work -Recurse -Force }
}
