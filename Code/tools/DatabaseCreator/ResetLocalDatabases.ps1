[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$Full,
    [switch]$Config
)

$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$RepoRootWithSlash = $RepoRoot.TrimEnd('\') + '\'

function Resolve-ExistingPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (Test-Path -LiteralPath $Path) {
        return (Resolve-Path -LiteralPath $Path).Path
    }

    return $null
}

function Assert-InRepo {
    param([Parameter(Mandatory = $true)][string]$Path)

    $resolved = Resolve-ExistingPath -Path $Path
    if (-not $resolved) {
        return $null
    }

    $resolvedWithSlash = $resolved.TrimEnd('\') + '\'
    if ($resolved -ne $RepoRoot -and -not $resolvedWithSlash.StartsWith($RepoRootWithSlash, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove path outside repository: $resolved"
    }

    return $resolved
}

function Remove-PathIfExists {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [switch]$Recurse
    )

    $resolved = Assert-InRepo -Path $Path
    if (-not $resolved) {
        Write-Host "  [skip] Missing: $Path"
        return
    }

    if ($PSCmdlet.ShouldProcess($resolved, 'Remove')) {
        Remove-Item -LiteralPath $resolved -Force -Recurse:$Recurse
        Write-Host "  [done] Removed: $resolved"
    }
}

function Remove-GeneratedGameStoreFiles {
    $dataRoot = Join-Path $RepoRoot 'server\src\gameStore\data'
    if (-not (Test-Path -LiteralPath $dataRoot)) {
        Write-Host "  [skip] Missing: $dataRoot"
        return
    }

    $resolvedRoot = Assert-InRepo -Path $dataRoot
    Get-ChildItem -LiteralPath $resolvedRoot -Directory | ForEach-Object {
        Get-ChildItem -LiteralPath $_.FullName -File | Where-Object {
            $_.Name -eq 'data.json' -or
            $_.Name -eq 'data.json.bak' -or
            $_.Name -like 'data.json.tmp-*'
        } | ForEach-Object {
            Remove-PathIfExists -Path $_.FullName
        }
    }
}

Write-Host ''
Write-Host '  ============================================================'
Write-Host '    EvEJS Local Database Reset'
Write-Host '  ============================================================'
Write-Host ''
Write-Host "  Repository: $RepoRoot"
Write-Host ''

if ($Full) {
    Write-Host '  Removing all local generated data, including cached SDE downloads.'
    Remove-PathIfExists -Path (Join-Path $RepoRoot '_local') -Recurse
}
else {
    Write-Host '  Removing generated local database output.'
    Remove-PathIfExists -Path (Join-Path $RepoRoot '_local\gameStore') -Recurse
    Remove-PathIfExists -Path (Join-Path $RepoRoot '_local\tmp') -Recurse
}

Write-Host ''
Write-Host '  Removing any legacy source-tree generated database files.'
Remove-GeneratedGameStoreFiles

Write-Host ''
Write-Host '  Removing mutable chat runtime state.'
Remove-PathIfExists -Path (Join-Path $RepoRoot 'server\src\_secondary\data\chat\state.json')
Remove-PathIfExists -Path (Join-Path $RepoRoot 'server\src\_secondary\data\chat\state.json.tmp')
Remove-PathIfExists -Path (Join-Path $RepoRoot 'server\src\_secondary\data\chat\backlog') -Recurse

if ($Config) {
    Write-Host ''
    Write-Host '  Removing local client setup config.'
    Remove-PathIfExists -Path (Join-Path $RepoRoot 'tools\ClientSETUP\scripts\EvEJSConfig.bat')
}

Write-Host ''
Write-Host '  Reset complete.'
Write-Host ''
Write-Host '  Next steps:'
Write-Host '    tools\DatabaseCreator\CreateDatabase.bat'
Write-Host '    StartServer.bat'
Write-Host ''
Write-Host '  Notes:'
Write-Host '    Default reset keeps cached SDE downloads and EvEJSConfig.bat.'
Write-Host '    With the .bat wrapper, use /full or /config for the optional cleanup.'
Write-Host '    With this .ps1 file directly, use -Full or -Config.'
Write-Host ''
