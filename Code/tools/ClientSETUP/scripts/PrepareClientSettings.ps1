param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("Display", "Graphics")]
    [string]$Mode
)

$ErrorActionPreference = "Stop"

function Get-NormalizedSwitchValue {
    param([string]$Value)
    return ([string]$Value).Trim().ToLowerInvariant()
}

function Test-IsDisabled {
    param([string]$Value)
    return @("0", "false", "no", "off") -contains (Get-NormalizedSwitchValue $Value)
}

function Test-IsEnabled {
    param([string]$Value)
    return @("1", "true", "yes", "on") -contains (Get-NormalizedSwitchValue $Value)
}

function Get-ClientSettingsFile {
    if (-not $env:EVEJS_CLIENT_PATH) {
        throw "EVEJS_CLIENT_PATH is not set."
    }
    if (-not $env:LOCALAPPDATA) {
        throw "LOCALAPPDATA is not set."
    }

    $clientPath = [IO.Path]::GetFullPath($env:EVEJS_CLIENT_PATH).TrimEnd([char[]]@("\", "/"))
    $settingsKey = $clientPath.ToLowerInvariant() `
        -replace ":", "" `
        -replace "[\\/]+", "_" `
        -replace "[^a-z0-9._-]+", "_"
    $settingsKey = $settingsKey.Trim("_") + "_127.0.0.1"

    $settingsDir = Join-Path $env:LOCALAPPDATA ("CCP\EVE\" + $settingsKey + "\settings")
    New-Item -ItemType Directory -Force -Path $settingsDir | Out-Null
    return Join-Path $settingsDir "core_public__.yaml"
}

function Read-SettingsLines {
    param([string]$Path)

    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        return ,[IO.File]::ReadAllLines($Path)
    }

    return ,@(
        "device:",
        "generic: {}",
        "ui: {}"
    )
}

function Get-KeyPattern {
    param([string[]]$Keys)

    $escapedKeys = $Keys | ForEach-Object { [regex]::Escape($_) }
    return "^  (?:" + ($escapedKeys -join "|") + "):"
}

function Set-DeviceYamlValues {
    param(
        [string[]]$Lines,
        [string[]]$ReplacementLines,
        [string[]]$KeysToRemove,
        [string[]]$SequenceKeys = @()
    )

    $current = [System.Collections.Generic.List[string]]::new()
    foreach ($line in $Lines) {
        $current.Add($line)
    }

    if ($current.Count -eq 0) {
        $current.Add("device:")
        $current.Add("generic: {}")
        $current.Add("ui: {}")
    }

    $deviceIndex = -1
    for ($i = 0; $i -lt $current.Count; $i++) {
        if ($current[$i] -match "^device:\s*(?:\{\})?\s*$") {
            $deviceIndex = $i
            break
        }
    }

    if ($deviceIndex -lt 0) {
        $current.Insert(0, "device:")
        $deviceIndex = 0
    } else {
        $current[$deviceIndex] = "device:"
    }

    $deviceEnd = $current.Count
    for ($i = $deviceIndex + 1; $i -lt $current.Count; $i++) {
        if ($current[$i] -match "^\S") {
            $deviceEnd = $i
            break
        }
    }

    $keyPattern = Get-KeyPattern $KeysToRemove
    $sequencePattern = $null
    if ($SequenceKeys.Count -gt 0) {
        $sequencePattern = Get-KeyPattern $SequenceKeys
    }

    $body = [System.Collections.Generic.List[string]]::new()
    $skipSequenceItems = $false

    for ($i = $deviceIndex + 1; $i -lt $deviceEnd; $i++) {
        $line = $current[$i]

        if ($skipSequenceItems) {
            if ($line -match "^  -\s") {
                continue
            }
            $skipSequenceItems = $false
        }

        if ($line -match $keyPattern) {
            if ($sequencePattern -and $line -match $sequencePattern) {
                $skipSequenceItems = $true
            }
            continue
        }

        $body.Add($line)
    }

    $updated = [System.Collections.Generic.List[string]]::new()
    for ($i = 0; $i -le $deviceIndex; $i++) {
        $updated.Add($current[$i])
    }
    foreach ($line in $ReplacementLines) {
        $updated.Add($line)
    }
    foreach ($line in $body) {
        $updated.Add($line)
    }
    for ($i = $deviceEnd; $i -lt $current.Count; $i++) {
        $updated.Add($current[$i])
    }

    return ,$updated.ToArray()
}

function Get-ScreenSize {
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
        $area = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
        return [pscustomobject]@{
            Width = [int]$area.Width
            Height = [int]$area.Height
        }
    } catch {
        return [pscustomobject]@{
            Width = 1600
            Height = 900
        }
    }
}

function Get-WindowSize {
    param([int]$ScreenWidth, [int]$ScreenHeight)

    $width = [Math]::Min(1600, [Math]::Max(800, $ScreenWidth - 80))
    $height = [Math]::Min(900, [Math]::Max(600, $ScreenHeight - 120))

    $configuredWidth = 0
    if ([int]::TryParse([string]$env:EVEJS_CLIENT_WINDOW_WIDTH, [ref]$configuredWidth) -and $configuredWidth -gt 0) {
        $width = [Math]::Min($configuredWidth, $ScreenWidth)
    }

    $configuredHeight = 0
    if ([int]::TryParse([string]$env:EVEJS_CLIENT_WINDOW_HEIGHT, [ref]$configuredHeight) -and $configuredHeight -gt 0) {
        $height = [Math]::Min($configuredHeight, $ScreenHeight)
    }

    return [pscustomobject]@{
        Width = $width
        Height = $height
    }
}

function Invoke-DisplaySafety {
    if (-not (Test-IsEnabled $env:EVEJS_CLIENT_SAFE_WINDOWED)) {
        Write-Host "Client display safety reset disabled by default. Set EVEJS_CLIENT_SAFE_WINDOWED=on to enable."
        return
    }

    $settingsFile = Get-ClientSettingsFile
    if ((Test-Path -LiteralPath $settingsFile -PathType Leaf) -and -not (Test-Path -LiteralPath ($settingsFile + ".evejs-display-backup"))) {
        Copy-Item -LiteralPath $settingsFile -Destination ($settingsFile + ".evejs-display-backup")
    }

    $screen = Get-ScreenSize
    $window = Get-WindowSize -ScreenWidth $screen.Width -ScreenHeight $screen.Height
    $timestamp = [DateTime]::UtcNow.ToFileTimeUtc()

    $replacementLines = @(
        "  DeviceSettings: [$timestamp, null]",
        "  FixedWindow: [$timestamp, 0]",
        "  FixedWindowSettings: [$timestamp, null]",
        "  FullScreenResolution: [$timestamp, null]",
        "  FullScreenSettings:",
        "  - $timestamp",
        "  - {adapter: 0, height: $($screen.Height), presentInterval: 1, width: $($screen.Width)}",
        "  UIScaleFullscreen: [$timestamp, 1.0]",
        "  UIScaleFullscreenSetAutomatically: [$timestamp, true]",
        "  UIScaleWindowed: [$timestamp, 1.0]",
        "  UIScaleWindowedSetAutomatically: [$timestamp, false]",
        "  WindowMode: [$timestamp, 1]",
        "  WindowedResolution: [$timestamp, null]",
        "  WindowedSettings:",
        "  - $timestamp",
        "  - {adapter: 0, height: $($window.Height), left: 0, presentInterval: 1, showState: 1, top: 0, width: $($window.Width)}"
    )

    $displayKeys = @(
        "DeviceSettings",
        "FixedWindow",
        "FixedWindowSettings",
        "FullScreenResolution",
        "FullScreenSettings",
        "UIScaleFullscreen",
        "UIScaleFullscreenSetAutomatically",
        "UIScaleWindowed",
        "UIScaleWindowedSetAutomatically",
        "WindowMode",
        "WindowedResolution",
        "WindowedSettings"
    )

    $lines = Read-SettingsLines $settingsFile
    $updatedLines = Set-DeviceYamlValues `
        -Lines $lines `
        -ReplacementLines $replacementLines `
        -KeysToRemove $displayKeys `
        -SequenceKeys @("FullScreenSettings", "WindowedSettings")

    Set-Content -LiteralPath $settingsFile -Value $updatedLines -Encoding UTF8
    Write-Host ("Client display safety applied: windowed {0}x{1} at 0,0; existing non-display settings preserved." -f $window.Width, $window.Height)
    Write-Host ("Settings: " + $settingsFile)
}

function Invoke-GraphicsSafety {
    if (-not (Test-IsEnabled $env:EVEJS_CLIENT_SAFE_GRAPHICS)) {
        Write-Host "Client graphics safety reset disabled by default. Set EVEJS_CLIENT_SAFE_GRAPHICS=on to enable."
        return
    }

    $settingsFile = Get-ClientSettingsFile
    if (-not (Test-Path -LiteralPath $settingsFile -PathType Leaf)) {
        return
    }

    $timestamp = [DateTime]::UtcNow.ToFileTimeUtc()
    $graphicsKeys = @(
        "antiAliasing",
        "aoQuality",
        "charClothSimulation",
        "dofEnabled",
        "frameGeneration",
        "lodQuality",
        "postProcessingQuality",
        "reflectionQuality",
        "shaderQuality",
        "shadowQuality",
        "upscalingTechnique",
        "volumetricQuality"
    )

    $replacementLines = @(
        "  antiAliasing: [$timestamp, 0]",
        "  aoQuality: [$timestamp, 0]",
        "  charClothSimulation: [$timestamp, 0]",
        "  dofEnabled: [$timestamp, false]",
        "  frameGeneration: [$timestamp, false]",
        "  lodQuality: [$timestamp, 1]",
        "  postProcessingQuality: [$timestamp, 0]",
        "  reflectionQuality: [$timestamp, 0]",
        "  shaderQuality: [$timestamp, 1]",
        "  shadowQuality: [$timestamp, 0]",
        "  upscalingTechnique: [$timestamp, 0]",
        "  volumetricQuality: [$timestamp, 0]"
    )

    $lines = Read-SettingsLines $settingsFile
    $updatedLines = Set-DeviceYamlValues `
        -Lines $lines `
        -ReplacementLines $replacementLines `
        -KeysToRemove $graphicsKeys

    Set-Content -LiteralPath $settingsFile -Value $updatedLines -Encoding UTF8
    Write-Host "Client graphics safety reset applied: low GPU profile."
}

switch ($Mode) {
    "Display" { Invoke-DisplaySafety }
    "Graphics" { Invoke-GraphicsSafety }
}
