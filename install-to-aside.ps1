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
    Assert-NoLink $Assets
    Assert-Tree (Join-Path $Assets 'scenarios')
    $References = Join-Path $Path 'references'
    Assert-NoLink $References
    if (Test-Path -LiteralPath $References) {
        if (-not (Test-Path -LiteralPath $References -PathType Container)) { throw 'references must be a directory.' }
        Assert-Tree $References
    }
    if ((Select-String -LiteralPath (Join-Path $Path 'SKILL.md') -SimpleMatch -CaseSensitive -Pattern 'references/file-writing-rules.md' -Quiet) -and
        -not (Test-Path -LiteralPath (Join-Path $References 'file-writing-rules.md') -PathType Leaf)) { throw 'Missing references/file-writing-rules.md.' }
    if (-not (Select-String -LiteralPath (Join-Path $Path 'SKILL.md') -SimpleMatch -CaseSensitive -Pattern 'name: "aside-automation-creator"' -Quiet)) { throw 'Unexpected skill name.' }
}
function Assert-LegacyParents([string]$Path) {
    while ($Path) { Assert-NoLink $Path; $Next = Split-Path -Parent $Path; if ($Next -eq $Path) { break }; $Path = $Next }
}
function Copy-LegacyItem([string]$Source, [string]$Target) {
    $Item = Get-Item -LiteralPath $Source -Force
    if ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        if ($Item.LinkType -ne 'SymbolicLink') { throw "Cannot safely preserve reparse point: $Source" }
        New-Item -ItemType SymbolicLink -Path $Target -Target $Item.Target -ErrorAction Stop | Out-Null
    } elseif ($Item.PSIsContainer) {
        Ensure-Directory $Target
        foreach ($Child in Get-ChildItem -LiteralPath $Source -Force) { Copy-LegacyItem $Child.FullName (Join-Path $Target $Child.Name) }
    } else { Copy-Item -LiteralPath $Source -Destination $Target }
}
function Copy-Legacy([string]$Source, [string]$Target) {
    Assert-LegacyParents (Join-Path $Source 'assets')
    $Old = Join-Path $Source 'assets/template'
    if ($null -eq (Get-Item -LiteralPath $Old -Force -ErrorAction SilentlyContinue)) { return }
    $New = Join-Path $Target 'assets/template'
    Assert-LegacyParents (Join-Path $Target 'assets')
    if ($null -ne (Get-Item -LiteralPath $New -Force -ErrorAction SilentlyContinue)) { throw 'New payload unexpectedly contains legacy template.' }
    Ensure-Directory (Join-Path $Target 'assets')
    Copy-LegacyItem $Old $New
}
function Clear-Legacy([string]$Root, [string]$Baseline) {
    if (-not (Test-Path -LiteralPath $Baseline -PathType Leaf)) { return }
    try { Assert-LegacyParents $Baseline; Assert-LegacyParents (Join-Path $Root 'assets/template') } catch { return }
    foreach ($Line in Get-Content -LiteralPath $Baseline) {
        if ($Line -notmatch '^([0-9a-f]{64})\t(assets/template/[^\\]+)$') { continue }
        $Hash = $Matches[1]; $Relative = $Matches[2]
        if ($Relative.Split('/') -contains '..' -or $Relative.Split('/') -contains '.') { continue }
        $File = Join-Path $Root $Relative
        try {
            Assert-LegacyParents $File
            $Before = Get-Item -LiteralPath $File -Force -ErrorAction Stop
            if ($Before.PSIsContainer) { continue }
            if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -ine $Hash) { continue }
            Assert-LegacyParents $File
            $After = Get-Item -LiteralPath $File -Force
            if ($Before.CreationTimeUtc -ne $After.CreationTimeUtc -or $Before.LastWriteTimeUtc -ne $After.LastWriteTimeUtc -or $Before.Length -ne $After.Length) { continue }
            Remove-Item -LiteralPath $File -ErrorAction Stop
        } catch { if (Test-Path -LiteralPath $File) { Write-Warning "Legacy file preserved: $File. $($_.Exception.Message)" } }
    }
    # Enumerate without following links and remove only empty directories.
    function Remove-EmptyLegacy([string]$Directory) {
        try {
            Assert-LegacyParents $Directory
            foreach ($Child in Get-ChildItem -LiteralPath $Directory -Force) {
                if ($Child.PSIsContainer -and -not ($Child.Attributes -band [IO.FileAttributes]::ReparsePoint)) { Remove-EmptyLegacy $Child.FullName }
            }
            Assert-LegacyParents $Directory
            if (@(Get-ChildItem -LiteralPath $Directory -Force).Count -eq 0) { [IO.Directory]::Delete($Directory) }
        } catch { Write-Warning "Legacy directory preserved: $Directory. $($_.Exception.Message)" }
    }
    if (Test-Path -LiteralPath (Join-Path $Root 'assets/template') -PathType Container) { Remove-EmptyLegacy (Join-Path $Root 'assets/template') }
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
            Copy-Legacy $Repository $Fresh
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
            Copy-Legacy $Repository $Fresh
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
    Ensure-Directory (Join-Path $Stage 'assets')
    Copy-Item -LiteralPath (Join-Path $Repository 'assets/scenarios') -Destination (Join-Path $Stage 'assets') -Recurse
    if (Test-Path -LiteralPath (Join-Path $Repository 'references') -PathType Container) {
        Copy-Item -LiteralPath (Join-Path $Repository 'references') -Destination $Stage -Recurse
    }
    Get-ChildItem -LiteralPath $Stage -Recurse -Force -File -Filter '.DS_Store' | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
    $BackupRoot = Join-Path $AsideHome ('skill-backups/aside-automation-creator/' + $Stamp)
    $Installed = 0
    foreach ($Account in $Accounts) {
        $Parent = Join-Path $Account.FullName 'skills/user'
        Ensure-Directory $Parent
        $Destination = Join-Path $Parent 'aside-automation-creator'
        if (Test-SameSkill $Stage $Destination) { Write-Host "u$($Account.Name): already current"; continue }
        $Prepared = Join-Path $Work ('profile-' + $Account.Name)
        Copy-Item -LiteralPath $Stage -Destination $Prepared -Recurse
        Copy-Legacy $Destination $Prepared
        if (Test-SameSkill $Prepared $Destination) { Write-Host "u$($Account.Name): already current"; continue }
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
    Clear-Legacy $Repository (Join-Path $Repository 'references/legacy-template-sha256.tsv')
    foreach ($Account in $Accounts) { Clear-Legacy (Join-Path $Account.FullName 'skills/user/aside-automation-creator') (Join-Path $Repository 'references/legacy-template-sha256.tsv') }
    Write-Host "Installed/updated: $Installed. Open a new Aside chat. Shared source: $Repository"
} finally {
    if (Test-Path -LiteralPath $Work) { Remove-Item -LiteralPath $Work -Recurse -Force }
}
