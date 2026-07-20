param(
  [switch]$NoUi
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

Add-Type -Namespace EvEJS -Name NativeChrome -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("dwmapi.dll", PreserveSig = true)]
public static extern int DwmSetWindowAttribute(System.IntPtr hwnd, int attr, ref int attrValue, int attrSize);
'@

$script:CliPath = Join-Path $PSScriptRoot "config-manager-cli.js"
$script:IconManifestPath = Join-Path $PSScriptRoot "assets\icon-map.json"
$script:ClientIconsRoot = Join-Path $PSScriptRoot "assets\eve-icons"
$script:UiIconsRoot = Join-Path $PSScriptRoot "assets\ui-icons"
$script:Culture = [System.Globalization.CultureInfo]::InvariantCulture

$script:SettingsFieldControllers = @{}
$script:SettingsSnapshot = $null
$script:SettingsDirty = $false
$script:IsRenderingSettings = $false
$script:SettingsSearchBox = $null
$script:SettingsSearchHint = $null
$script:SettingsSearchItems = @()
$script:SettingsTabViews = @()
$script:SettingsCardByKey = @{}
$script:MasterTabs = $null
$script:FooterErrorKey = $null

$script:DatabaseSnapshot = $null
$script:DbWorkingPlayer = $null
$script:DatabaseDirty = $false
$script:IsRenderingDatabase = $false
$script:DbRawJsonDirty = $false
$script:SuppressPlayerSelection = $false
$script:IconManifest = $null
$script:NextGeneratedItemId = $null
$script:ThemeToggleButton = $null
$script:MarketStatus = $null
$script:MarketLastQuery = $null
$script:MarketBookTypeId = 0

function New-Brush {
  param([Parameter(Mandatory = $true)][string]$Color)
  return [System.Windows.Media.BrushConverter]::new().ConvertFromString($Color)
}

# ---------------------------------------------------------------------------
# Theme engine
# ---------------------------------------------------------------------------
# Every color the UI paints is expressed as a semantic *role* (TextPrimary,
# Panel, Accent, ...). Two palettes map those roles to concrete hex values.
# The active palette is exposed three ways:
#   * $script:Theme        - role -> hex string (for code that needs a string,
#                            e.g. New-Badge / glyph foregrounds)
#   * $script:ThemeBrushes - role -> shared SolidColorBrush instance (for PS
#                            controls that assign a Brush)
#   * Application resources - the same brush instances keyed by role, so XAML
#                            can bind with {DynamicResource <Role>}
# Switching the theme mutates each shared brush's .Color in place, which live-
# updates every XAML DynamicResource binding and every PS control that holds a
# reference to the brush. Hex-based visuals (badges, cards) are refreshed by a
# re-render triggered from Set-Theme.

$script:PrefsPath = Join-Path $PSScriptRoot "config-editor-prefs.json"

$script:ThemePalettes = @{
  Dark = @{
    WindowBg      = "#0E1116"
    Panel         = "#191D24"
    PanelSubtle   = "#14171D"
    PanelInput    = "#11141A"
    HeroBg        = "#171B22"
    ListHoverBg   = "#20242D"
    ListSelBg     = "#1D2A3B"
    Border        = "#2A303B"
    BorderStrong  = "#333B48"
    BorderSel     = "#3D74B0"
    BorderSelSoft = "#2E4B6E"
    Accent        = "#4A9EFF"
    AccentHover   = "#63B0FF"
    OnAccent      = "#F5FAFF"
    TextPrimary   = "#E6E9EF"
    TextSecondary = "#C2C8D2"
    TextMuted     = "#858E9C"
    TextAccent    = "#6FB4FF"
    BtnBg         = "#232833"
    BtnHoverBg    = "#2B323E"
    BtnPressBg    = "#313A48"
    BtnText       = "#D7DCE4"
    TabBg         = "#1B1F27"
    TabSelBg      = "#232A36"
    TabHoverBorder= "#4A5568"
    SuccessBg     = "#14241E"
    SuccessFg     = "#34D399"
    WarnBg        = "#241E12"
    WarnFg        = "#F0A030"
    DangerBg      = "#2A1517"
    DangerFg      = "#F87171"
    InfoBg        = "#12202E"
    InfoFg        = "#4A9EFF"
    BadgeNeutralBg= "#23272F"
    BadgeNeutralFg= "#C2C8D2"
    BadgeBlueBg   = "#16283F"
    BadgeBlueFg   = "#7FB4F0"
    BadgeGreenBg  = "#14241E"
    BadgeGreenFg  = "#34D399"
    BadgePurpleBg = "#211A33"
    BadgePurpleFg = "#B794F0"
    BadgeAmberBg  = "#241E12"
    BadgeAmberFg  = "#F0A030"
    IconPlateBg   = "#232A36"
    IconPlateBorder = "#313A48"
    EditorIconBg  = "#16283F"
    ScrollThumb   = "#3A414E"
    ScrollThumbHover = "#525B6B"
  }
  Light = @{
    WindowBg      = "#F4F7FB"
    Panel         = "#FFFFFF"
    PanelSubtle   = "#F4F7FB"
    PanelInput    = "#FFFFFF"
    HeroBg        = "#F7FAFD"
    ListHoverBg   = "#F7FAFD"
    ListSelBg     = "#EAF4FB"
    Border        = "#D9E2EC"
    BorderStrong  = "#D5E0EA"
    BorderSel     = "#6FAEDC"
    BorderSelSoft = "#B9D4E8"
    Accent        = "#4F7EA8"
    AccentHover   = "#6FAEDC"
    OnAccent      = "#FFFFFF"
    TextPrimary   = "#102235"
    TextSecondary = "#334155"
    TextMuted     = "#6A7C90"
    TextAccent    = "#2F6F9F"
    BtnBg         = "#FFFFFF"
    BtnHoverBg    = "#F7FAFD"
    BtnPressBg    = "#EAF4FB"
    BtnText       = "#17324D"
    TabBg         = "#EAF1F7"
    TabSelBg      = "#FFFFFF"
    TabHoverBorder= "#6A7A8F"
    SuccessBg     = "#DDF6EF"
    SuccessFg     = "#0F766E"
    WarnBg        = "#FFF5DD"
    WarnFg        = "#9A6700"
    DangerBg      = "#FDE7EA"
    DangerFg      = "#B42318"
    InfoBg        = "#EAF4FB"
    InfoFg        = "#2F6F9F"
    BadgeNeutralBg= "#E2E8F0"
    BadgeNeutralFg= "#334155"
    BadgeBlueBg   = "#DBEAFE"
    BadgeBlueFg   = "#1D4ED8"
    BadgeGreenBg  = "#DCFCE7"
    BadgeGreenFg  = "#166534"
    BadgePurpleBg = "#EDE9FE"
    BadgePurpleFg = "#6D28D9"
    BadgeAmberBg  = "#FEF3C7"
    BadgeAmberFg  = "#92400E"
    IconPlateBg   = "#334155"
    IconPlateBorder = "#223042"
    EditorIconBg  = "#EAF4FB"
    ScrollThumb   = "#C2CBD6"
    ScrollThumbHover = "#A6B2C0"
  }
}

# Named tones the icon manifest can reference so category tiles stay theme-aware
# instead of using hardcoded hex. Each maps to a (background, foreground) role pair.
$script:IconTonePalette = @{
  blue    = @("BadgeBlueBg", "BadgeBlueFg")
  green   = @("BadgeGreenBg", "BadgeGreenFg")
  amber   = @("BadgeAmberBg", "BadgeAmberFg")
  purple  = @("BadgePurpleBg", "BadgePurpleFg")
  neutral = @("BadgeNeutralBg", "BadgeNeutralFg")
  accent  = @("EditorIconBg", "TextAccent")
  red     = @("DangerBg", "DangerFg")
  teal    = @("SuccessBg", "SuccessFg")
}

$script:ActiveThemeName = "Dark"
$script:Theme = @{}
$script:ThemeBrushes = @{}
$script:Brushes = @{}

function Get-PreferredThemeName {
  try {
    if (Test-Path $script:PrefsPath) {
      $prefs = Get-Content $script:PrefsPath -Raw | ConvertFrom-Json
      $name = [string]$prefs.theme
      if ($name -eq "Dark" -or $name -eq "Light") { return $name }
    }
  } catch { }
  return "Dark"
}

function Save-ThemePreference {
  param([Parameter(Mandatory = $true)][string]$Name)
  try {
    [pscustomobject]@{ theme = $Name } | ConvertTo-Json | Set-Content -Path $script:PrefsPath -Encoding UTF8
  } catch { }
}

function Get-ThemeHex {
  param([Parameter(Mandatory = $true)][string]$Role)
  if ($script:Theme.ContainsKey($Role)) { return $script:Theme[$Role] }
  return "#FF00FF"
}

function Get-ThemeBrush {
  param([Parameter(Mandatory = $true)][string]$Role)
  if ($script:ThemeBrushes.ContainsKey($Role)) { return $script:ThemeBrushes[$Role] }
  return $script:ThemeBrushes["TextPrimary"]
}

# Compatibility aliases: legacy $script:Brushes.<Name> map onto theme roles so
# existing PS controls pick up the active palette without per-call changes.
$script:BrushRoleAliases = @{
  Slate900 = "TextPrimary"
  Slate700 = "TextSecondary"
  Slate500 = "TextMuted"
  Slate200 = "Border"
  Slate100 = "PanelSubtle"
  White    = "Panel"
  GreenBg  = "SuccessBg"
  GreenFg  = "SuccessFg"
  AmberBg  = "WarnBg"
  AmberFg  = "WarnFg"
  RedBg    = "DangerBg"
  RedFg    = "DangerFg"
  BlueBg   = "InfoBg"
  BlueFg   = "InfoFg"
}

function Apply-ThemeValues {
  param([Parameter(Mandatory = $true)][string]$Name)

  $palette = $script:ThemePalettes[$Name]
  $script:ActiveThemeName = $Name
  $script:Theme = @{}
  foreach ($role in $palette.Keys) { $script:Theme[$role] = $palette[$role] }

  # Replace (not mutate) the brush per role: WPF freezes a brush once it is used
  # as a resource, so a fresh instance is registered each time. Assigning a new
  # value to the resource key makes every {DynamicResource} consumer re-resolve;
  # PS-built controls pick up the new brushes when Set-Theme re-renders them.
  $app = [System.Windows.Application]::Current
  foreach ($role in $palette.Keys) {
    $color = [System.Windows.Media.ColorConverter]::ConvertFromString($palette[$role])
    $brush = [System.Windows.Media.SolidColorBrush]::new($color)
    $script:ThemeBrushes[$role] = $brush
    if ($app) { $app.Resources[$role] = $brush }
  }

  foreach ($alias in $script:BrushRoleAliases.Keys) {
    $script:Brushes[$alias] = $script:ThemeBrushes[$script:BrushRoleAliases[$alias]]
  }
}

function Register-GlobalStyles {
  # Implicit styles merged into Application resources so every window (including
  # the on-demand dialogs) gets themed scrollbars. Brushes are resolved with
  # DynamicResource so they follow theme switches.
  $dictXaml = @'
<ResourceDictionary xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
                    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">
  <Style x:Key="EvejsScrollThumb" TargetType="Thumb">
    <Setter Property="OverridesDefaultStyle" Value="True" />
    <Setter Property="IsTabStop" Value="False" />
    <Setter Property="MinHeight" Value="28" />
    <Setter Property="MinWidth" Value="28" />
    <Setter Property="Template">
      <Setter.Value>
        <ControlTemplate TargetType="Thumb">
          <Border x:Name="ThumbBorder" CornerRadius="4" Margin="2" Background="{DynamicResource ScrollThumb}" />
          <ControlTemplate.Triggers>
            <Trigger Property="IsMouseOver" Value="True">
              <Setter TargetName="ThumbBorder" Property="Background" Value="{DynamicResource ScrollThumbHover}" />
            </Trigger>
            <Trigger Property="IsDragging" Value="True">
              <Setter TargetName="ThumbBorder" Property="Background" Value="{DynamicResource ScrollThumbHover}" />
            </Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
      </Setter.Value>
    </Setter>
  </Style>
  <Style x:Key="EvejsScrollPageButton" TargetType="RepeatButton">
    <Setter Property="OverridesDefaultStyle" Value="True" />
    <Setter Property="Background" Value="Transparent" />
    <Setter Property="Focusable" Value="False" />
    <Setter Property="IsTabStop" Value="False" />
    <Setter Property="Template">
      <Setter.Value>
        <ControlTemplate TargetType="RepeatButton">
          <Border Background="Transparent" />
        </ControlTemplate>
      </Setter.Value>
    </Setter>
  </Style>
  <Style TargetType="ScrollBar">
    <Setter Property="OverridesDefaultStyle" Value="True" />
    <Setter Property="Background" Value="Transparent" />
    <Setter Property="Width" Value="12" />
    <Setter Property="MinWidth" Value="12" />
    <Setter Property="Template">
      <Setter.Value>
        <ControlTemplate TargetType="ScrollBar">
          <Grid Background="Transparent">
            <Track x:Name="PART_Track"
                   Orientation="{Binding Orientation, RelativeSource={RelativeSource TemplatedParent}}"
                   IsDirectionReversed="True"
                   Focusable="False">
              <Track.DecreaseRepeatButton>
                <RepeatButton Style="{StaticResource EvejsScrollPageButton}" Command="ScrollBar.PageUpCommand" />
              </Track.DecreaseRepeatButton>
              <Track.Thumb>
                <Thumb Style="{StaticResource EvejsScrollThumb}" />
              </Track.Thumb>
              <Track.IncreaseRepeatButton>
                <RepeatButton Style="{StaticResource EvejsScrollPageButton}" Command="ScrollBar.PageDownCommand" />
              </Track.IncreaseRepeatButton>
            </Track>
          </Grid>
          <ControlTemplate.Triggers>
            <Trigger Property="Orientation" Value="Horizontal">
              <Setter TargetName="PART_Track" Property="IsDirectionReversed" Value="False" />
            </Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
      </Setter.Value>
    </Setter>
    <Style.Triggers>
      <Trigger Property="Orientation" Value="Horizontal">
        <Setter Property="Width" Value="Auto" />
        <Setter Property="MinWidth" Value="0" />
        <Setter Property="Height" Value="12" />
        <Setter Property="MinHeight" Value="12" />
      </Trigger>
    </Style.Triggers>
  </Style>
</ResourceDictionary>
'@
  try {
    $dict = [System.Windows.Markup.XamlReader]::Parse($dictXaml)
    [System.Windows.Application]::Current.Resources.MergedDictionaries.Add($dict)
  } catch { }
}

function Initialize-Theme {
  if (-not [System.Windows.Application]::Current) {
    $null = [System.Windows.Application]::new()
  }
  $script:ActiveThemeName = Get-PreferredThemeName
  Apply-ThemeValues -Name $script:ActiveThemeName
  Register-GlobalStyles
}

function Set-Theme {
  param([Parameter(Mandatory = $true)][ValidateSet("Dark", "Light")][string]$Name)

  if ($Name -eq $script:ActiveThemeName) { return }
  Apply-ThemeValues -Name $Name
  Save-ThemePreference -Name $Name
  if ($script:ThemeToggleButton) { Update-ThemeToggleButton }
  if ($script:Window) { Apply-WindowThemeChrome -Window $script:Window }

  # Mutating the shared brushes above live-updates every DynamicResource binding
  # and every control painted from $script:Brushes. The only visuals that keep a
  # stale color are the ones built from hex strings at render time (badges and
  # per-item icon plates), so re-render those - WITHOUT discarding unsaved edits.
  if ($script:SettingsSnapshot) {
    $savedDirty = $script:SettingsDirty
    $savedValues = $null
    try { $savedValues = Collect-SettingsValues } catch { $savedValues = $null }
    Render-SettingsSnapshot -Snapshot $script:SettingsSnapshot -ReadyMessage "Theme set to $Name."
    if ($savedValues) {
      $script:IsRenderingSettings = $true
      try {
        foreach ($key in @($savedValues.Keys)) {
          if ($script:SettingsFieldControllers.ContainsKey($key)) {
            Set-ControlValue -Controller $script:SettingsFieldControllers[$key] -Value $savedValues[$key]
          }
        }
      } finally { $script:IsRenderingSettings = $false }
    }
    Set-SettingsDirtyState -Dirty $savedDirty -Message "Theme set to $Name."
  }

  if ($script:DatabaseSnapshot) {
    $savedDbDirty = $script:DatabaseDirty
    $script:IsRenderingDatabase = $true
    try {
      Update-PlayerListDisplay
      if ($script:DbWorkingPlayer) {
        Sync-OverviewControlsToWorkingCopy
        Render-DatabasePlayer
      }
    } finally { $script:IsRenderingDatabase = $false }
    Set-DatabaseDirtyState -Dirty $savedDbDirty -Message "Theme set to $Name."
  }
}

function Update-ThemeToggleButton {
  if (-not $script:ThemeToggleButton) { return }
  if ($script:ActiveThemeName -eq "Dark") {
    $script:ThemeToggleButton.Content = [string][char]0x2600  # sun: click to go light
    $script:ThemeToggleButton.ToolTip = "Switch to light theme"
  } else {
    $script:ThemeToggleButton.Content = [string][char]0x263E  # moon: click to go dark
    $script:ThemeToggleButton.ToolTip = "Switch to dark theme"
  }
}

function Toggle-Theme {
  $next = if ($script:ActiveThemeName -eq "Dark") { "Light" } else { "Dark" }
  Set-Theme -Name $next
}

function Set-WindowDarkTitleBar {
  param(
    [Parameter(Mandatory = $true)][System.Windows.Window]$Window,
    [bool]$Dark
  )
  try {
    $hwnd = ([System.Windows.Interop.WindowInteropHelper]::new($Window)).Handle
    if ($hwnd -eq [System.IntPtr]::Zero) { return }
    $val = if ($Dark) { 1 } else { 0 }
    # 20 = DWMWA_USE_IMMERSIVE_DARK_MODE (Win10 2004+); 19 on older builds.
    if ([EvEJS.NativeChrome]::DwmSetWindowAttribute($hwnd, 20, [ref]$val, 4) -ne 0) {
      [EvEJS.NativeChrome]::DwmSetWindowAttribute($hwnd, 19, [ref]$val, 4) | Out-Null
    }
  } catch { }
}

function Apply-WindowThemeChrome {
  param([Parameter(Mandatory = $true)][System.Windows.Window]$Window)
  Set-WindowDarkTitleBar -Window $Window -Dark ($script:ActiveThemeName -eq "Dark")
}

Initialize-Theme

function Invoke-ProjectCli {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [string[]]$Arguments = @(),
    [object]$InputObject
  )

  $stderrPath = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())

  try {
    $nodeArgs = @($script:CliPath, $Command) + @($Arguments)
    $result =
      if ($PSBoundParameters.ContainsKey("InputObject")) {
        $payloadJson = $InputObject | ConvertTo-Json -Depth 100 -Compress
        $payloadJson | & node @nodeArgs 2> $stderrPath
      } else {
        & node @nodeArgs 2> $stderrPath
      }

    $stderrText = if (Test-Path $stderrPath) { Get-Content $stderrPath -Raw } else { "" }
    if ($LASTEXITCODE -ne 0) {
      if ([string]::IsNullOrWhiteSpace($stderrText)) {
        throw "The EvEJS helper exited with code $LASTEXITCODE."
      }
      throw $stderrText.Trim()
    }

    $jsonText = ($result -join "`n").Trim()
    if ([string]::IsNullOrWhiteSpace($jsonText)) {
      throw "The EvEJS helper did not return any JSON."
    }

    return $jsonText | ConvertFrom-Json
  } finally {
    Remove-Item $stderrPath -ErrorAction SilentlyContinue
  }
}

function ConvertTo-PrettyJson {
  param([Parameter(Mandatory = $true)][object]$Value)
  return ($Value | ConvertTo-Json -Depth 100)
}

function ConvertTo-DeepClone {
  param([Parameter(Mandatory = $true)][object]$Value)
  return (ConvertTo-PrettyJson $Value) | ConvertFrom-Json
}

function Set-ObjectProperty {
  param(
    [Parameter(Mandatory = $true)][object]$Object,
    [Parameter(Mandatory = $true)][string]$Name,
    [object]$Value
  )

  $existingProperty = $Object.PSObject.Properties[$Name]
  if ($null -ne $existingProperty) {
    $existingProperty.Value = $Value
  } else {
    $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
  }
}

function Format-DisplayValue {
  param([object]$Value)
  if ($null -eq $Value) { return "not set" }
  if ($Value -is [bool]) { if ($Value) { return "true" } else { return "false" } }
  if ($Value -is [double] -or $Value -is [single] -or $Value -is [decimal]) {
    return $Value.ToString("0.############################", $script:Culture)
  }
  return [string]$Value
}

function Parse-NumericText {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $trimmedText = $Text.Trim()
  if ($trimmedText -eq "") { throw "$Label cannot be blank." }
  if ($trimmedText -match '^-?\d+$') {
    return [Int64]::Parse($trimmedText, $script:Culture)
  }
  return [double]::Parse($trimmedText, $script:Culture)
}

function Parse-JsonObjectText {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $trimmedText = $Text.Trim()
  if ($trimmedText -eq "") { throw "$Label cannot be blank." }
  $parsed = $trimmedText | ConvertFrom-Json
  if ($parsed -isnot [pscustomobject]) { throw "$Label must be a JSON object." }
  return $parsed
}

function New-Badge {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [string]$Background = (Get-ThemeHex 'BadgeNeutralBg'),
    [string]$Foreground = (Get-ThemeHex 'BadgeNeutralFg'),
    [string]$Glyph = "",
    [string]$ImagePath = "",
    [double]$ImageSize = 16
  )

  $border = [System.Windows.Controls.Border]::new()
  $border.CornerRadius = [System.Windows.CornerRadius]::new(10)
  $border.Padding = [System.Windows.Thickness]::new(12, 7, 12, 7)
  $border.Margin = [System.Windows.Thickness]::new(0, 0, 8, 8)
  $border.Background = New-Brush $Background

  $panel = [System.Windows.Controls.DockPanel]::new()

  $iconElement = New-IconVisual -ImagePath $ImagePath -Glyph $Glyph -Foreground $Foreground -IconSize $ImageSize -MarginRight 8
  if ($iconElement) {
    [System.Windows.Controls.DockPanel]::SetDock($iconElement, [System.Windows.Controls.Dock]::Left)
    $panel.Children.Add($iconElement) | Out-Null
  }

  $label = [System.Windows.Controls.TextBlock]::new()
  $label.Text = $Text
  $label.FontSize = 11
  $label.FontWeight = [System.Windows.FontWeights]::SemiBold
  $label.Foreground = New-Brush $Foreground
  $label.VerticalAlignment = [System.Windows.VerticalAlignment]::Center

  $panel.Children.Add($label) | Out-Null
  $border.Child = $panel
  return $border
}

function Resolve-UiIconPath {
  param([Parameter(Mandatory = $true)][string]$Key)

  $candidatePath = Join-Path $script:UiIconsRoot ("{0}.png" -f $Key)
  if (Test-Path $candidatePath) { return $candidatePath }
  return ""
}

function Test-IsUiIconPath {
  param([string]$Path)

  if ([string]::IsNullOrWhiteSpace($Path)) { return $false }

  try {
    $resolvedPath = [System.IO.Path]::GetFullPath($Path)
    $uiRootPath = [System.IO.Path]::GetFullPath($script:UiIconsRoot)
    return $resolvedPath.StartsWith($uiRootPath, [System.StringComparison]::OrdinalIgnoreCase)
  } catch {
    return $false
  }
}

function New-IconVisual {
  param(
    [string]$ImagePath = "",
    [string]$Glyph = "",
    [string]$GlyphFont = "Segoe MDL2 Assets",
    [string]$Foreground = (Get-ThemeHex 'TextSecondary'),
    [double]$IconSize = 16,
    [double]$MarginRight = 8
  )

  if (-not [string]::IsNullOrWhiteSpace($ImagePath) -and (Test-Path $ImagePath)) {
    $image = [System.Windows.Controls.Image]::new()
    $image.Source = $ImagePath
    $image.Width = $IconSize
    $image.Height = $IconSize
    $image.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    $image.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
    $image.Stretch = [System.Windows.Media.Stretch]::Uniform

    if (Test-IsUiIconPath -Path $ImagePath) {
      $plate = [System.Windows.Controls.Border]::new()
      $plate.Width = [Math]::Max($IconSize + 10, 24)
      $plate.Height = [Math]::Max($IconSize + 10, 24)
      $plate.CornerRadius = [System.Windows.CornerRadius]::new(8)
      $plate.Margin = [System.Windows.Thickness]::new(0, 0, $MarginRight, 0)
      $plate.Background = New-Brush (Get-ThemeHex 'IconPlateBg')
      $plate.BorderBrush = New-Brush (Get-ThemeHex 'IconPlateBorder')
      $plate.BorderThickness = [System.Windows.Thickness]::new(1)
      $plate.Child = $image
      return $plate
    }

    $image.Margin = [System.Windows.Thickness]::new(0, 0, $MarginRight, 0)
    return $image
  }

  if (-not [string]::IsNullOrWhiteSpace($Glyph)) {
    $icon = [System.Windows.Controls.TextBlock]::new()
    $icon.Text = $Glyph
    $icon.FontFamily = [System.Windows.Media.FontFamily]::new($GlyphFont)
    $icon.FontSize = [Math]::Max($IconSize - 2, 12)
    $icon.Margin = [System.Windows.Thickness]::new(0, 0, $MarginRight, 0)
    $icon.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    # An empty foreground means "inherit" so button glyphs follow the button's
    # own Foreground (primary vs secondary) across theme changes.
    if (-not [string]::IsNullOrWhiteSpace($Foreground)) {
      $icon.Foreground = New-Brush $Foreground
    }
    return $icon
  }

  return $null
}

function Get-JsonPropertyValue {
  param(
    [object]$Object,
    [Parameter(Mandatory = $true)][string]$Name
  )

  if ($null -eq $Object) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -ne $property) { return $property.Value }
  return $null
}

function Convert-GlyphTokenToText {
  param([string]$GlyphToken)

  $trimmedToken = [string]$GlyphToken
  if ([string]::IsNullOrWhiteSpace($trimmedToken)) { return [string][char]0xE10F }
  if ($trimmedToken -match '^[0-9A-Fa-f]+$') {
    return [string][char]([Convert]::ToInt32($trimmedToken, 16))
  }
  return $trimmedToken
}

function Get-IconManifest {
  if ($script:IconManifest) { return $script:IconManifest }

  if (Test-Path $script:IconManifestPath) {
    $script:IconManifest = Get-Content $script:IconManifestPath -Raw | ConvertFrom-Json
  } else {
    $script:IconManifest = [pscustomobject]@{}
  }

  return $script:IconManifest
}

function Resolve-ManifestIconSpec {
  param(
    [Parameter(Mandatory = $true)][string]$SectionName,
    [string[]]$LookupValues = @()
  )

  $manifest = Get-IconManifest
  $section = Get-JsonPropertyValue -Object $manifest -Name $SectionName
  $resolvedEntry = $null

  foreach ($lookupValue in @($LookupValues)) {
    if ([string]::IsNullOrWhiteSpace([string]$lookupValue) -or $null -eq $section) { continue }

    $exactProperty = $section.PSObject.Properties[[string]$lookupValue]
    if ($null -ne $exactProperty) {
      $resolvedEntry = $exactProperty.Value
      break
    }

    foreach ($sectionProperty in $section.PSObject.Properties) {
      if ($sectionProperty.Name -eq "default") { continue }
      if ([string]$lookupValue -like "*$($sectionProperty.Name)*") {
        $resolvedEntry = $sectionProperty.Value
        break
      }
    }

    if ($null -ne $resolvedEntry) { break }
  }

  if ($null -eq $resolvedEntry -and $null -ne $section) {
    $resolvedEntry = Get-JsonPropertyValue -Object $section -Name "default"
  }

  $foreground = [string](Get-JsonPropertyValue -Object $resolvedEntry -Name "foreground")
  $background = [string](Get-JsonPropertyValue -Object $resolvedEntry -Name "background")

  # A named tone resolves to theme-aware colors (so tiles adapt to dark/light);
  # explicit foreground/background hex still take precedence when provided.
  $tone = [string](Get-JsonPropertyValue -Object $resolvedEntry -Name "tone")
  if (-not [string]::IsNullOrWhiteSpace($tone) -and $script:IconTonePalette.ContainsKey($tone.ToLowerInvariant())) {
    $tonePair = $script:IconTonePalette[$tone.ToLowerInvariant()]
    if ([string]::IsNullOrWhiteSpace($background)) { $background = (Get-ThemeHex $tonePair[0]) }
    if ([string]::IsNullOrWhiteSpace($foreground)) { $foreground = (Get-ThemeHex $tonePair[1]) }
  }

  if ([string]::IsNullOrWhiteSpace($foreground)) { $foreground = (Get-ThemeHex 'TextAccent') }
  if ([string]::IsNullOrWhiteSpace($background)) { $background = (Get-ThemeHex 'EditorIconBg') }

  return [pscustomobject]@{
    glyph = Convert-GlyphTokenToText ([string](Get-JsonPropertyValue -Object $resolvedEntry -Name "glyph"))
    foreground = $foreground
    background = $background
    border = $foreground
  }
}

function Resolve-SkillIconSpec {
  param([string]$GroupName, [string]$ItemName = "")
  return Resolve-ManifestIconSpec -SectionName "skills" -LookupValues @($GroupName, $ItemName)
}

function Resolve-ShipIconSpec {
  param([string]$GroupName, [string]$ShipName = "")
  return Resolve-ManifestIconSpec -SectionName "ships" -LookupValues @($GroupName, $ShipName)
}

function Resolve-ItemIconSpec {
  param(
    [string]$GroupName,
    [object]$CategoryID,
    [string]$ItemName = ""
  )

  $normalizedCategoryId = if ($null -ne $CategoryID) { [int]$CategoryID } else { -1 }
  if ($normalizedCategoryId -eq 6) {
    return Resolve-ShipIconSpec -GroupName $GroupName -ShipName $ItemName
  }
  if ($normalizedCategoryId -eq 16) {
    return Resolve-ManifestIconSpec -SectionName "items" -LookupValues @("Skillbook", $GroupName, $ItemName)
  }

  $lookupValues = @($GroupName, $ItemName)
  if ($ItemName -match "missile") { $lookupValues = @("Missile") + $lookupValues }
  if ($ItemName -match "drone") { $lookupValues = @("Drone") + $lookupValues }
  if ($ItemName -match "charge") { $lookupValues = @("Charge") + $lookupValues }
  return Resolve-ManifestIconSpec -SectionName "items" -LookupValues $lookupValues
}

function Resolve-WalletIconSpec {
  param([Parameter(Mandatory = $true)][string]$CurrencyKey)
  return Resolve-ManifestIconSpec -SectionName "wallet" -LookupValues @($CurrencyKey)
}

function Add-IconFields {
  param(
    [Parameter(Mandatory = $true)][object]$Object,
    [Parameter(Mandatory = $true)][pscustomobject]$IconSpec
  )

  Set-ObjectProperty -Object $Object -Name "iconGlyph" -Value $IconSpec.glyph
  Set-ObjectProperty -Object $Object -Name "iconForeground" -Value $IconSpec.foreground
  Set-ObjectProperty -Object $Object -Name "iconBackground" -Value $IconSpec.background
  Set-ObjectProperty -Object $Object -Name "iconBorder" -Value $IconSpec.border
  Set-ObjectProperty -Object $Object -Name "iconFilePath" -Value ""
  return $Object
}

function Resolve-TypeIconFilePath {
  param([object]$TypeId)

  if ($null -eq $TypeId) { return "" }
  $candidatePath = Join-Path $script:ClientIconsRoot ("{0}.png" -f [string]$TypeId)
  if (Test-Path $candidatePath) { return $candidatePath }
  return ""
}

function Add-TypeIconFields {
  param(
    [Parameter(Mandatory = $true)][object]$Object,
    [Parameter(Mandatory = $true)][pscustomobject]$IconSpec,
    [object]$TypeId
  )

  $Object = Add-IconFields -Object $Object -IconSpec $IconSpec
  Set-ObjectProperty -Object $Object -Name "iconFilePath" -Value (Resolve-TypeIconFilePath -TypeId $TypeId)
  return $Object
}

function Format-CompactNumber {
  param([object]$Value)

  if ($null -eq $Value) { return "0" }
  $number = [double]$Value
  $absoluteValue = [Math]::Abs($number)
  if ($absoluteValue -ge 1000000000) {
    return ("{0:0.#}b" -f ($number / 1000000000))
  }
  if ($absoluteValue -ge 1000000) {
    return ("{0:0.#}m" -f ($number / 1000000))
  }
  if ($absoluteValue -ge 1000) {
    return ("{0:0.#}k" -f ($number / 1000))
  }
  return Format-DisplayValue $Value
}

function New-IconTextContent {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [int]$GlyphCode = 0,
    [string]$GlyphFont = "Segoe MDL2 Assets",
    [string]$IconPath = "",
    [double]$IconSize = 16
  )

  $panel = [System.Windows.Controls.StackPanel]::new()
  $panel.Orientation = [System.Windows.Controls.Orientation]::Horizontal

  $glyphText = ""
  if ($GlyphCode -gt 0) {
    $glyphText = [string][char]$GlyphCode
  }

  $iconElement = New-IconVisual -ImagePath $IconPath -Glyph $glyphText -GlyphFont $GlyphFont -Foreground "" -IconSize $IconSize -MarginRight 8
  if ($iconElement) {
    $panel.Children.Add($iconElement) | Out-Null
  }

  $label = [System.Windows.Controls.TextBlock]::new()
  $label.Text = $Text
  $label.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
  $panel.Children.Add($label) | Out-Null
  return $panel
}

function Set-ButtonChrome {
  param(
    [Parameter(Mandatory = $true)][System.Windows.Controls.Button]$Button,
    [Parameter(Mandatory = $true)][string]$Text,
    [int]$GlyphCode = 0,
    [string]$IconKey = "",
    [double]$IconSize = 16
  )

  $iconPath = ""
  if (-not [string]::IsNullOrWhiteSpace($IconKey)) {
    $iconPath = Resolve-UiIconPath -Key $IconKey
  }

  $Button.Content = New-IconTextContent -Text $Text -GlyphCode $GlyphCode -IconPath $iconPath -IconSize $IconSize
}

function Set-StatusUi {
  param(
    [Parameter(Mandatory = $true)][string]$Message,
    [ValidateSet("ready", "dirty", "success", "error", "info")][string]$Tone = "ready",
    [string]$BadgeText = ""
  )

  $toneConfig = switch ($Tone) {
    "dirty" { @{ Background = $script:Brushes.AmberBg; Foreground = $script:Brushes.AmberFg; Badge = "Unsaved changes" } }
    "success" { @{ Background = $script:Brushes.GreenBg; Foreground = $script:Brushes.GreenFg; Badge = "Saved" } }
    "error" { @{ Background = $script:Brushes.RedBg; Foreground = $script:Brushes.RedFg; Badge = "Error" } }
    "info" { @{ Background = $script:Brushes.BlueBg; Foreground = $script:Brushes.BlueFg; Badge = "Info" } }
    default { @{ Background = $script:Brushes.GreenBg; Foreground = $script:Brushes.GreenFg; Badge = "Ready" } }
  }

  $resolvedBadgeText = if ($BadgeText) { $BadgeText } else { $toneConfig.Badge }
  $script:FooterStatusText.Text = $Message
  $script:FooterStatusText.Foreground = $toneConfig.Foreground
  $script:HeroBadgeBorder.Background = $toneConfig.Background
  $script:HeroBadgeBorder.BorderBrush = $toneConfig.Foreground
  $script:HeroBadgeText.Foreground = $toneConfig.Foreground
  $script:HeroBadgeText.Text = ("STATUS: {0}" -f $resolvedBadgeText.ToUpperInvariant())

  # If an error names a known setting, make the footer a shortcut to that field.
  $script:FooterErrorKey = if ($Tone -eq "error") { Find-SettingKeyInMessage -Message $Message } else { $null }
  Update-FooterClickable
}

function Find-SettingKeyInMessage {
  param([string]$Message)
  if (-not $script:SettingsSnapshot -or [string]::IsNullOrEmpty($Message)) { return $null }
  $best = $null
  foreach ($entry in @($script:SettingsSnapshot.entries)) {
    $key = [string]$entry.key
    if ($key -and $script:SettingsCardByKey.ContainsKey($key) -and $Message.Contains($key)) {
      # Prefer the longest match so e.g. "clientBuild" wins over any shorter key.
      if (-not $best -or $key.Length -gt $best.Length) { $best = $key }
    }
  }
  return $best
}

function Update-FooterClickable {
  if (-not $script:FooterStatusText) { return }
  if ($script:FooterErrorKey) {
    $script:FooterStatusText.Cursor = [System.Windows.Input.Cursors]::Hand
    $script:FooterStatusText.TextDecorations = [System.Windows.TextDecorations]::Underline
    $script:FooterStatusText.ToolTip = "Go to setting: $($script:FooterErrorKey)"
  } else {
    $script:FooterStatusText.Cursor = [System.Windows.Input.Cursors]::Arrow
    $script:FooterStatusText.TextDecorations = $null
    $script:FooterStatusText.ToolTip = $null
  }
}

function Flash-Card {
  param([Parameter(Mandatory = $true)][System.Windows.Controls.Border]$Card)
  $origBrush = $Card.BorderBrush
  $origThickness = $Card.BorderThickness
  $Card.BorderBrush = (Get-ThemeBrush 'Accent')
  $Card.BorderThickness = [System.Windows.Thickness]::new(2)
  $timer = [System.Windows.Threading.DispatcherTimer]::new()
  $timer.Interval = [TimeSpan]::FromMilliseconds(1800)
  $timer.Add_Tick({
    $Card.BorderBrush = $origBrush
    $Card.BorderThickness = $origThickness
    $timer.Stop()
  }.GetNewClosure())
  $timer.Start()
}

function Navigate-ToSetting {
  param([Parameter(Mandatory = $true)][string]$Key)
  if (-not $script:SettingsCardByKey.ContainsKey($Key)) { return }
  $target = $script:SettingsCardByKey[$Key]

  if ($script:MasterTabs) { $script:MasterTabs.SelectedIndex = 0 }
  $target.Section.Expanded = $true
  if ($script:SettingsSearchBox -and -not [string]::IsNullOrEmpty($script:SettingsSearchBox.Text)) {
    $script:SettingsSearchBox.Text = ""
  }
  $tabIndex = $script:SettingsTabs.Items.IndexOf($target.TabView.Tab)
  if ($tabIndex -ge 0) { $script:SettingsTabs.SelectedIndex = $tabIndex }
  Update-SettingsVisibility

  # Defer until layout settles so BringIntoView can reach the now-visible card.
  $card = $target.Card
  $card.Dispatcher.BeginInvoke([System.Windows.Threading.DispatcherPriority]::Background, [action]{
    $card.BringIntoView()
    Flash-Card -Card $card
  }.GetNewClosure()) | Out-Null
}

function Set-SettingsDirtyState {
  param([bool]$Dirty, [string]$Message = "")
  $script:SettingsDirty = $Dirty
  if ($Dirty) {
    $resolvedMessage = if ($Message) { $Message } else { "Server settings have unsaved changes." }
    Set-StatusUi -Message $resolvedMessage -Tone "dirty" -BadgeText "Settings changed"
  } else {
    $resolvedMessage = if ($Message) { $Message } else { "Server settings loaded and ready." }
    Set-StatusUi -Message $resolvedMessage -Tone "ready" -BadgeText "Settings ready"
  }
}

function Set-DatabaseDirtyState {
  param([bool]$Dirty, [string]$Message = "")
  $script:DatabaseDirty = $Dirty
  if ($Dirty) {
    $resolvedMessage = if ($Message) { $Message } else { "Player database changes are waiting to be saved." }
    Set-StatusUi -Message $resolvedMessage -Tone "dirty" -BadgeText "Database changed"
  } else {
    $resolvedMessage = if ($Message) { $Message } else { "Player database loaded and ready." }
    Set-StatusUi -Message $resolvedMessage -Tone "ready" -BadgeText "Database ready"
  }
}

function Confirm-DiscardChanges {
  param([Parameter(Mandatory = $true)][string]$Area, [bool]$IsDirty)
  if (-not $IsDirty) { return $true }
  $result = [System.Windows.MessageBox]::Show(
    "You have unsaved changes in $Area. Discard them?",
    "EvEJS Config Manager",
    [System.Windows.MessageBoxButton]::YesNo,
    [System.Windows.MessageBoxImage]::Warning
  )
  return $result -eq [System.Windows.MessageBoxResult]::Yes
}

function Get-SourceLabel {
  param([string]$Source)
  switch ($Source) {
    "env" { return "Environment" }
    "local" { return "Local file" }
    "shared" { return "Shared file" }
    default { return "Default" }
  }
}

function Get-GroupDescription {
  param([string]$Group)
  switch ($Group) {
    "Basics" { return "Everyday toggles and the most common runtime switches." }
    "Structures & Safety" { return "Upwell bypasses and timer scaling controls for structure and safety workflows." }
    "Client Compatibility" { return "Values the client handshake expects to match your build." }
    "Network" { return "Ports, service URLs, socket tuning, proxy, XMPP, and host bindings for the local services." }
    "Market & Services" { return "Market daemon connectivity, retries, and related service tuning." }
    "HyperNet" { return "HyperNet kill-switch, pricing, and startup seeding controls." }
    "World & Performance" { return "Startup loading, debris cleanup, stargate / sentry presence, and runtime performance tuning." }
    "NPC & Crimewatch" { return "NPC startup behavior and CONCORD / Crimewatch controls." }
    "Mining" { return "Everything mining: belt / ice / gas sites, mining NPC fleets, haulers, response, and ledgers." }
    "Belt Rats" { return "Asteroid belt NPC rat spawning, specials, commanders, officers, capitals, and bounties." }
    "Wormholes" { return "Wormhole availability, lifetimes, and wandering-connection behavior." }
    "New Eden Store" { return "New Eden Store checkout flow, PLEX offers, and test / fake-purchase switches." }
    "Server Ops" { return "Server status reporting, downtime scheduling, industry indices, and packet logging." }
    "Developer" { return "Developer conveniences: account bootstrap, new-character flow, skills, and expert systems." }
    default { return "Advanced settings for EvEJS." }
  }
}

function Get-ControlValue {
  param([Parameter(Mandatory = $true)][pscustomobject]$Controller)
  switch ($Controller.Kind) {
    "boolean" { return [bool]$Controller.Control.IsChecked }
    "select" { return $Controller.Control.SelectedValue }
    default { return $Controller.Control.Text }
  }
}

function Set-ControlValue {
  param([Parameter(Mandatory = $true)][pscustomobject]$Controller, [object]$Value)
  switch ($Controller.Kind) {
    "boolean" { $Controller.Control.IsChecked = [bool]$Value }
    "select" {
      $Controller.Control.SelectedValue = $Value
      if ($null -eq $Controller.Control.SelectedItem -and $Controller.Control.Items.Count -gt 0) {
        $Controller.Control.SelectedIndex = 0
      }
    }
    default { $Controller.Control.Text = Format-DisplayValue $Value }
  }
}

function Register-SettingsDirtyHandler {
  param([Parameter(Mandatory = $true)][object]$Control, [Parameter(Mandatory = $true)][string]$Kind)
  $handler = {
    if (-not $script:IsRenderingSettings) {
      Set-SettingsDirtyState -Dirty $true -Message "Server settings are staged in the form. Click Save Changes to write them."
    }
  }

  switch ($Kind) {
    "boolean" { $Control.Add_Checked($handler); $Control.Add_Unchecked($handler) }
    "select" { $Control.Add_SelectionChanged($handler) }
    default { $Control.Add_TextChanged($handler) }
  }
}

function New-SettingsFieldController {
  param([Parameter(Mandatory = $true)][pscustomobject]$Entry)

  switch ($Entry.control) {
    "boolean" {
      $checkBox = [System.Windows.Controls.CheckBox]::new()
      $checkBox.Content = "Enabled"
      $checkBox.FontSize = 14
      $checkBox.Foreground = $script:Brushes.Slate900
      $controller = [pscustomobject]@{ Kind = "boolean"; Control = $checkBox; Entry = $Entry }
    }
    "select" {
      $comboBox = [System.Windows.Controls.ComboBox]::new()
      $comboBox.MinWidth = 340
      $comboBox.Height = 38
      $comboBox.Padding = [System.Windows.Thickness]::new(8, 4, 8, 4)
      $comboBox.DisplayMemberPath = "label"
      $comboBox.SelectedValuePath = "value"
      $comboBox.ItemsSource = @($Entry.options)
      $comboBox.Style = $script:Window.FindResource("ConfigComboBoxStyle")
      $controller = [pscustomobject]@{ Kind = "select"; Control = $comboBox; Entry = $Entry }
    }
    default {
      $textBox = [System.Windows.Controls.TextBox]::new()
      $textBox.MinWidth = 340
      $textBox.Height = 38
      $textBox.VerticalContentAlignment = [System.Windows.VerticalAlignment]::Center
      $textBox.Style = $script:Window.FindResource("ConfigTextBoxStyle")
      $controller = [pscustomobject]@{ Kind = $Entry.control; Control = $textBox; Entry = $Entry }
    }
  }

  Register-SettingsDirtyHandler -Control $controller.Control -Kind $controller.Kind
  return $controller
}

function New-SettingsCard {
  param([Parameter(Mandatory = $true)][pscustomobject]$Entry)

  $card = [System.Windows.Controls.Border]::new()
  $card.CornerRadius = [System.Windows.CornerRadius]::new(12)
  $card.BorderThickness = [System.Windows.Thickness]::new(1)
  $card.BorderBrush = $script:Brushes.Slate200
  $card.Background = $script:Brushes.White
  $card.Padding = [System.Windows.Thickness]::new(16, 12, 16, 12)
  $card.Margin = [System.Windows.Thickness]::new(0, 0, 0, 10)

  $layout = [System.Windows.Controls.StackPanel]::new()
  $headerGrid = [System.Windows.Controls.Grid]::new()
  $headerGrid.Margin = [System.Windows.Thickness]::new(0, 0, 0, 8)
  $headerGrid.ColumnDefinitions.Add([System.Windows.Controls.ColumnDefinition]@{ Width = "*" })
  $headerGrid.ColumnDefinitions.Add([System.Windows.Controls.ColumnDefinition]@{ Width = "Auto" })

  $titleStack = [System.Windows.Controls.StackPanel]::new()
  $titleText = [System.Windows.Controls.TextBlock]::new()
  $titleText.Text = $Entry.label
  $titleText.FontSize = 17
  $titleText.FontWeight = [System.Windows.FontWeights]::SemiBold
  $titleText.Foreground = $script:Brushes.Slate900
  $keyText = [System.Windows.Controls.TextBlock]::new()
  $keyText.Text = $Entry.key
  $keyText.FontSize = 11
  $keyText.Foreground = $script:Brushes.Slate500
  $keyText.Margin = [System.Windows.Thickness]::new(0, 2, 0, 0)
  $titleStack.Children.Add($titleText) | Out-Null
  $titleStack.Children.Add($keyText) | Out-Null
  [System.Windows.Controls.Grid]::SetColumn($titleStack, 0)

  $badgePanel = [System.Windows.Controls.WrapPanel]::new()
  $badgePanel.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Right
  $badgePanel.Children.Add((New-Badge -Text ("Source: {0}" -f (Get-SourceLabel $Entry.source)) -Background (Get-ThemeHex 'BadgeNeutralBg') -Foreground (Get-ThemeHex 'BadgeNeutralFg'))) | Out-Null
  $badgePanel.Children.Add((New-Badge -Text ("Default: {0}" -f (Format-DisplayValue $Entry.defaultValue)) -Background (Get-ThemeHex 'BadgeBlueBg') -Foreground (Get-ThemeHex 'BadgeBlueFg'))) | Out-Null
  if ($Entry.source -eq "env" -and $Entry.envVar) {
    $badgePanel.Children.Add((New-Badge -Text ("Env: {0}" -f $Entry.envVar) -Background (Get-ThemeHex 'BadgeAmberBg') -Foreground (Get-ThemeHex 'BadgeAmberFg'))) | Out-Null
  }
  [System.Windows.Controls.Grid]::SetColumn($badgePanel, 1)

  $headerGrid.Children.Add($titleStack) | Out-Null
  $headerGrid.Children.Add($badgePanel) | Out-Null
  $layout.Children.Add($headerGrid) | Out-Null

  $descriptionText = [System.Windows.Controls.TextBlock]::new()
  $descriptionText.Text = (@($Entry.description) -join " ")
  $descriptionText.TextWrapping = [System.Windows.TextWrapping]::Wrap
  $descriptionText.FontSize = 13
  $descriptionText.Foreground = $script:Brushes.Slate700
  $descriptionText.Margin = [System.Windows.Thickness]::new(0, 0, 0, 8)
  $layout.Children.Add($descriptionText) | Out-Null

  $validText = [System.Windows.Controls.TextBlock]::new()
  $validText.Text = "Valid values: $($Entry.validValues)"
  $validText.TextWrapping = [System.Windows.TextWrapping]::Wrap
  $validText.FontSize = 12
  $validText.Foreground = $script:Brushes.Slate500
  $validText.Margin = [System.Windows.Thickness]::new(0, 0, 0, 14)
  $layout.Children.Add($validText) | Out-Null

  $controlGrid = [System.Windows.Controls.Grid]::new()
  $controlGrid.ColumnDefinitions.Add([System.Windows.Controls.ColumnDefinition]@{ Width = "*" })
  $controlGrid.ColumnDefinitions.Add([System.Windows.Controls.ColumnDefinition]@{ Width = "Auto" })

  $controller = New-SettingsFieldController -Entry $Entry
  Set-ControlValue -Controller $controller -Value $Entry.fileValue
  [System.Windows.Controls.Grid]::SetColumn($controller.Control, 0)

  $resetButton = [System.Windows.Controls.Button]::new()
  $resetButton.Content = "Use Default"
  $resetButton.Margin = [System.Windows.Thickness]::new(12, 0, 0, 0)
  $resetButton.Padding = [System.Windows.Thickness]::new(16, 10, 16, 10)
  $resetButton.Style = $script:Window.FindResource("SecondaryButtonStyle")
  [System.Windows.Controls.Grid]::SetColumn($resetButton, 1)

  $capturedController = $controller
  $capturedEntry = $Entry
  $resetButton.Add_Click({
    Set-ControlValue -Controller $capturedController -Value $capturedEntry.defaultValue
    Set-SettingsDirtyState -Dirty $true -Message ("{0} has been reset in the form." -f $capturedEntry.label)
  }.GetNewClosure())

  $script:SettingsFieldControllers[$Entry.key] = $controller

  $controlGrid.Children.Add($controller.Control) | Out-Null
  $controlGrid.Children.Add($resetButton) | Out-Null
  $layout.Children.Add($controlGrid) | Out-Null
  $card.Child = $layout
  return $card
}

function Collect-SettingsValues {
  $values = @{}
  foreach ($key in $script:SettingsFieldControllers.Keys) {
    $values[$key] = Get-ControlValue -Controller $script:SettingsFieldControllers[$key]
  }
  return $values
}

function New-SubGroupHeader {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [int]$Count = 0
  )

  $border = [System.Windows.Controls.Border]::new()
  $border.CornerRadius = [System.Windows.CornerRadius]::new(8)
  $border.Background = (Get-ThemeBrush 'PanelSubtle')
  $border.BorderBrush = (Get-ThemeBrush 'Border')
  $border.BorderThickness = [System.Windows.Thickness]::new(1)
  $border.Padding = [System.Windows.Thickness]::new(12, 8, 12, 8)
  $border.Margin = [System.Windows.Thickness]::new(0, 0, 0, 8)
  $border.Cursor = [System.Windows.Input.Cursors]::Hand

  $dock = [System.Windows.Controls.DockPanel]::new()

  $chevron = [System.Windows.Controls.TextBlock]::new()
  $chevron.Text = [string][char]0x25B8  # right-pointing triangle (collapsed)
  $chevron.FontSize = 11
  $chevron.Foreground = (Get-ThemeBrush 'TextAccent')
  $chevron.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
  $chevron.Margin = [System.Windows.Thickness]::new(0, 0, 10, 0)
  [System.Windows.Controls.DockPanel]::SetDock($chevron, [System.Windows.Controls.Dock]::Left)
  $dock.Children.Add($chevron) | Out-Null

  $countText = [System.Windows.Controls.TextBlock]::new()
  $countText.Text = [string]$Count
  $countText.FontSize = 11
  $countText.FontWeight = [System.Windows.FontWeights]::SemiBold
  $countText.Foreground = (Get-ThemeBrush 'TextMuted')
  $countText.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
  [System.Windows.Controls.DockPanel]::SetDock($countText, [System.Windows.Controls.Dock]::Right)
  $dock.Children.Add($countText) | Out-Null

  $label = [System.Windows.Controls.TextBlock]::new()
  $label.Text = $Name.ToUpperInvariant()
  $label.FontSize = 12
  $label.FontWeight = [System.Windows.FontWeights]::SemiBold
  $label.Foreground = (Get-ThemeBrush 'TextAccent')
  $label.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
  $dock.Children.Add($label) | Out-Null

  $border.Child = $dock
  $border.Add_MouseEnter({ param($s, $e) $s.Background = (Get-ThemeBrush 'ListHoverBg') })
  $border.Add_MouseLeave({ param($s, $e) $s.Background = (Get-ThemeBrush 'PanelSubtle') })

  return [pscustomobject]@{ Element = $border; Chevron = $chevron }
}

function Update-SettingsVisibility {
  if (-not $script:SettingsSearchBox) { return }

  $term = ([string]$script:SettingsSearchBox.Text).Trim().ToLowerInvariant()
  $hasTerm = $term.Length -gt 0
  $vis = [System.Windows.Visibility]::Visible
  $col = [System.Windows.Visibility]::Collapsed
  $chevDown = [string][char]0x25BE  # expanded
  $chevRight = [string][char]0x25B8 # collapsed

  if ($script:SettingsSearchHint) {
    $script:SettingsSearchHint.Visibility = if ($hasTerm) { $col } else { $vis }
  }

  $firstMatchTab = -1
  $currentHasMatch = $false
  for ($ti = 0; $ti -lt $script:SettingsTabViews.Count; $ti++) {
    $tabView = $script:SettingsTabViews[$ti]
    if ($tabView.Intro) { $tabView.Intro.Visibility = if ($hasTerm) { $col } else { $vis } }
    $tabHasMatch = $false
    foreach ($section in $tabView.Sections) {
      $sectionHasMatch = $false
      foreach ($card in $section.Cards) {
        $match = (-not $hasTerm) -or ([string]$card.Tag).Contains($term)
        if ($match) { $sectionHasMatch = $true }
        # When searching, matching cards are force-shown; otherwise they follow
        # the section's expand/collapse state.
        $showCard = $match -and ($section.Expanded -or $hasTerm)
        $card.Visibility = if ($showCard) { $vis } else { $col }
      }
      if ($section.Header) {
        $section.Header.Visibility = if ((-not $hasTerm) -or $sectionHasMatch) { $vis } else { $col }
      }
      $effectiveExpanded = if ($hasTerm) { $sectionHasMatch } else { [bool]$section.Expanded }
      if ($section.Chevron) { $section.Chevron.Text = if ($effectiveExpanded) { $chevDown } else { $chevRight } }
      if ($sectionHasMatch) { $tabHasMatch = $true }
    }
    if ($tabHasMatch) {
      if ($firstMatchTab -lt 0) { $firstMatchTab = $ti }
      if ($ti -eq $script:SettingsTabs.SelectedIndex) { $currentHasMatch = $true }
    }
  }

  if ($hasTerm -and -not $currentHasMatch -and $firstMatchTab -ge 0) {
    $script:SettingsTabs.SelectedIndex = $firstMatchTab
  }
}

function Render-SettingsSnapshot {
  param([Parameter(Mandatory = $true)][pscustomobject]$Snapshot, [string]$ReadyMessage = "Server settings loaded and ready.")

  $script:IsRenderingSettings = $true
  try {
    $script:SettingsSnapshot = $Snapshot
    $script:SettingsFieldControllers = @{}
    $script:SettingsPathText.Text = "Saved file: $($Snapshot.paths.localConfigPath)"
    if (@($Snapshot.environmentOverrides).Count -gt 0) {
      $script:SettingsEnvNoteText.Text = @($Snapshot.notes) -join " "
      $script:SettingsEnvNoteText.Visibility = [System.Windows.Visibility]::Visible
    } else {
      $script:SettingsEnvNoteText.Text = ""
      $script:SettingsEnvNoteText.Visibility = [System.Windows.Visibility]::Collapsed
    }

    $script:SettingsTabs.Items.Clear()
    $script:SettingsSearchItems = New-Object System.Collections.Generic.List[object]
    $script:SettingsTabViews = New-Object System.Collections.Generic.List[object]
    $script:SettingsCardByKey = @{}

    foreach ($group in @($Snapshot.groupOrder)) {
      $groupEntries = @($Snapshot.entries | Where-Object { $_.group -eq $group })
      if ($groupEntries.Count -eq 0) { continue }

      $tabItem = [System.Windows.Controls.TabItem]::new()
      $tabItem.Header = $group
      $scrollViewer = [System.Windows.Controls.ScrollViewer]::new()
      $scrollViewer.VerticalScrollBarVisibility = [System.Windows.Controls.ScrollBarVisibility]::Auto
      # Fixed gap between the tab strip and the scrolling viewport.
      $scrollViewer.Margin = [System.Windows.Thickness]::new(0, 10, 0, 0)
      $scrollViewer.Padding = [System.Windows.Thickness]::new(0, 0, 6, 0)
      $contentStack = [System.Windows.Controls.StackPanel]::new()
      $contentStack.Margin = [System.Windows.Thickness]::new(0, 0, 0, 0)

      $introCard = [System.Windows.Controls.Border]::new()
      $introCard.CornerRadius = [System.Windows.CornerRadius]::new(12)
      $introCard.Padding = [System.Windows.Thickness]::new(14, 9, 14, 9)
      $introCard.Background = $script:Brushes.Slate100
      $introCard.BorderBrush = $script:Brushes.Slate200
      $introCard.BorderThickness = [System.Windows.Thickness]::new(1)
      $introCard.Margin = [System.Windows.Thickness]::new(0, 0, 0, 10)
      $introText = [System.Windows.Controls.TextBlock]::new()
      $introText.Text = Get-GroupDescription $group
      $introText.TextWrapping = [System.Windows.TextWrapping]::Wrap
      $introText.FontSize = 12
      $introText.Foreground = $script:Brushes.Slate700
      $introCard.Child = $introText
      $contentStack.Children.Add($introCard) | Out-Null

      # Bucket the group's entries by sub-group, preserving first-seen order.
      $subOrder = New-Object System.Collections.Generic.List[string]
      $buckets = @{}
      foreach ($entry in $groupEntries) {
        $sub = [string]$entry.subGroup
        if ([string]::IsNullOrWhiteSpace($sub)) { $sub = "General" }
        if (-not $buckets.ContainsKey($sub)) {
          $buckets[$sub] = (New-Object System.Collections.Generic.List[object])
          $subOrder.Add($sub) | Out-Null
        }
        $buckets[$sub].Add($entry) | Out-Null
      }
      $tabView = [pscustomobject]@{
        Tab = $tabItem
        Intro = $introCard
        Sections = (New-Object System.Collections.Generic.List[object])
      }

      foreach ($sub in $subOrder) {
        $bucketEntries = $buckets[$sub]
        $headerInfo = New-SubGroupHeader -Name $sub -Count $bucketEntries.Count
        $contentStack.Children.Add($headerInfo.Element) | Out-Null

        $sectionCards = New-Object System.Collections.Generic.List[object]
        $sectionObj = [pscustomobject]@{
          Header = $headerInfo.Element
          Chevron = $headerInfo.Chevron
          Cards = $sectionCards
          Expanded = $false
        }
        foreach ($entry in $bucketEntries) {
          $card = New-SettingsCard -Entry $entry
          $haystack = (@($entry.key, $entry.label, (@($entry.description) -join ' '), $entry.group, $sub, $entry.validValues) -join ' ').ToLowerInvariant()
          $card.Tag = $haystack
          $contentStack.Children.Add($card) | Out-Null
          $script:SettingsSearchItems.Add([pscustomobject]@{ Card = $card; Haystack = $haystack }) | Out-Null
          $sectionCards.Add($card) | Out-Null
          $script:SettingsCardByKey[[string]$entry.key] = [pscustomobject]@{ Card = $card; Section = $sectionObj; TabView = $tabView }
        }

        # Collapsed by default; clicking the header toggles this section.
        $capturedSection = $sectionObj
        $toggleHandler = {
          $capturedSection.Expanded = -not $capturedSection.Expanded
          Update-SettingsVisibility
        }.GetNewClosure()
        $headerInfo.Element.Add_MouseLeftButtonUp($toggleHandler)
        $tabView.Sections.Add($sectionObj) | Out-Null
      }

      $scrollViewer.Content = $contentStack
      $tabItem.Content = $scrollViewer
      $script:SettingsTabs.Items.Add($tabItem) | Out-Null
      $script:SettingsTabViews.Add($tabView) | Out-Null
    }

    if ($script:SettingsTabs.Items.Count -gt 0) { $script:SettingsTabs.SelectedIndex = 0 }
    # Apply the initial (all-collapsed) state and honor any active search term.
    Update-SettingsVisibility
    Set-SettingsDirtyState -Dirty $false -Message $ReadyMessage
  } finally {
    $script:IsRenderingSettings = $false
  }
}

function New-DatabaseWorkingCopy {
  param([Parameter(Mandatory = $true)][pscustomobject]$SelectedPlayer)

  $catalogByKey = @{}
  foreach ($catalogEntry in @($script:DatabaseSnapshot.skillCatalog)) {
    $catalogByKey[[string]$catalogEntry.skillKey] = ConvertTo-DeepClone $catalogEntry
  }
  foreach ($skill in @($SelectedPlayer.skillsList)) {
    if (-not $catalogByKey.ContainsKey([string]$skill.skillKey)) {
      $catalogByKey[[string]$skill.skillKey] = ConvertTo-DeepClone $skill
    }
  }

  return [pscustomobject]@{
    summary = ConvertTo-DeepClone $SelectedPlayer.summary
    originalAccountKey = [string]$SelectedPlayer.originalAccountKey
    accountName = [string]$SelectedPlayer.accountName
    account = ConvertTo-DeepClone $SelectedPlayer.account
    characterId = [string]$SelectedPlayer.characterId
    character = ConvertTo-DeepClone $SelectedPlayer.character
    skillsList = @(Convert-SkillStoreToList -SkillStore (Convert-SkillListToMap -SkillList @($SelectedPlayer.skillsList)) -CatalogByKey $catalogByKey)
    itemsList = @(Convert-ItemMapToList -ItemsMap (Convert-ItemListToMap -ItemList @($SelectedPlayer.itemsList)))
    metrics = ConvertTo-DeepClone $SelectedPlayer.metrics
    references = ConvertTo-DeepClone $SelectedPlayer.references
    warningMessages = @($SelectedPlayer.warningMessages)
  }
}

function Convert-SkillListToMap {
  param([Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$SkillList)
  $map = [ordered]@{}
  foreach ($skill in $SkillList) { $map[[string]$skill.skillKey] = $skill.raw }
  return [pscustomobject]$map
}

function Convert-ItemListToMap {
  param([Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$ItemList)
  $map = [ordered]@{}
  foreach ($item in $ItemList) { $map[[string]$item.itemKey] = $item.raw }
  return [pscustomobject]$map
}

function Build-DisplayItems {
  param([Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Items, [Parameter(Mandatory = $true)][scriptblock]$LabelBuilder, [Parameter(Mandatory = $true)][string]$KeyName)
  return @(
    foreach ($item in $Items) {
      [pscustomobject]@{
        key = [string]$item.$KeyName
        label = (& $LabelBuilder $item)
      }
    }
  )
}

function Get-SkillPointsForLevel {
  param(
    [double]$Rank = 1,
    [int]$Level = 0
  )

  $resolvedLevel = [Math]::Max(0, [Math]::Min(5, $Level))
  $resolvedRank = if ($Rank -gt 0) { $Rank } else { 1 }
  $skillPointTable = @(0, 250, 1415, 8000, 45255, 256000)
  return [int64][Math]::Round($skillPointTable[$resolvedLevel] * $resolvedRank)
}

function Update-WorkingPlayerDerivedData {
  if (-not $script:DbWorkingPlayer) { return }

  $skills = @($script:DbWorkingPlayer.skillsList)
  $items = @($script:DbWorkingPlayer.itemsList)
  $skillPointTotal = 0
  $shipCount = @($items | Where-Object { [int]$_.categoryID -eq 6 }).Count

  foreach ($skill in $skills) {
    if ($null -ne $skill.skillPoints) {
      $skillPointTotal += [double]$skill.skillPoints
    }
  }

  Set-ObjectProperty -Object $script:DbWorkingPlayer.summary -Name "skillCount" -Value $skills.Count
  Set-ObjectProperty -Object $script:DbWorkingPlayer.summary -Name "itemCount" -Value $items.Count
  Set-ObjectProperty -Object $script:DbWorkingPlayer.summary -Name "shipCount" -Value $shipCount
  Set-ObjectProperty -Object $script:DbWorkingPlayer.summary -Name "skillPoints" -Value ([int64][Math]::Round($skillPointTotal))
  Set-ObjectProperty -Object $script:DbWorkingPlayer.character -Name "skillPoints" -Value ([int64][Math]::Round($skillPointTotal))

  if ($script:DbWorkingPlayer.metrics) {
    Set-ObjectProperty -Object $script:DbWorkingPlayer.metrics -Name "skillCount" -Value $skills.Count
    Set-ObjectProperty -Object $script:DbWorkingPlayer.metrics -Name "itemCount" -Value $items.Count
    Set-ObjectProperty -Object $script:DbWorkingPlayer.metrics -Name "shipCount" -Value $shipCount
  }
}

function Convert-SkillStoreToList {
  param(
    [Parameter(Mandatory = $true)][object]$SkillStore,
    [Parameter(Mandatory = $true)][hashtable]$CatalogByKey
  )

  $skillKeys =
    if ($SkillStore -is [System.Collections.IDictionary]) {
      @($SkillStore.Keys)
    } else {
      @($SkillStore.PSObject.Properties | ForEach-Object { [string]$_.Name })
    }

  $entries = @(
    foreach ($skillKey in ($skillKeys | Sort-Object)) {
      $rawValue =
        if ($SkillStore -is [System.Collections.IDictionary]) {
          $SkillStore[$skillKey]
        } else {
          (Get-JsonPropertyValue -Object $SkillStore -Name $skillKey)
        }
      $raw = ConvertTo-DeepClone $rawValue
      $catalogEntry = $CatalogByKey[[string]$skillKey]
      $skillName = if ($raw.itemName) { [string]$raw.itemName } elseif ($catalogEntry) { [string]$catalogEntry.itemName } else { "Skill $skillKey" }
      $groupName = if ($raw.groupName) { [string]$raw.groupName } elseif ($catalogEntry) { [string]$catalogEntry.groupName } else { "" }
      $skillRank = if ($null -ne $raw.skillRank) { [double]$raw.skillRank } elseif ($catalogEntry -and $null -ne $catalogEntry.skillRank) { [double]$catalogEntry.skillRank } else { 1 }
      $skillLevel = if ($null -ne $raw.skillLevel) { [int]$raw.skillLevel } else { 0 }
      $trainedSkillLevel = if ($null -ne $raw.trainedSkillLevel) { [int]$raw.trainedSkillLevel } else { $skillLevel }
      $effectiveSkillLevel = if ($null -ne $raw.effectiveSkillLevel) { [int]$raw.effectiveSkillLevel } else { $trainedSkillLevel }
      $skillPoints = if ($null -ne $raw.skillPoints) { [int64]$raw.skillPoints } else { Get-SkillPointsForLevel -Rank $skillRank -Level $skillLevel }
      $resolvedTypeId = if ($null -ne $raw.typeID) { $raw.typeID } elseif ($catalogEntry) { $catalogEntry.typeID } else { [int]$skillKey }
      $iconSpec = Resolve-SkillIconSpec -GroupName $groupName -ItemName $skillName

      Add-TypeIconFields -Object ([pscustomobject]@{
        skillKey = [string]$skillKey
        typeID = $resolvedTypeId
        itemName = $skillName
        groupName = $groupName
        groupID = if ($null -ne $raw.groupID) { $raw.groupID } elseif ($catalogEntry) { $catalogEntry.groupID } else { $null }
        skillRank = $skillRank
        skillLevel = $skillLevel
        trainedSkillLevel = $trainedSkillLevel
        effectiveSkillLevel = $effectiveSkillLevel
        skillPoints = $skillPoints
        inTraining = [bool]$raw.inTraining
        raw = $raw
      }) -IconSpec $iconSpec -TypeId $resolvedTypeId
    }
  )

  return @($entries | Sort-Object itemName, skillKey)
}

function New-SkillRawFromCatalog {
  param(
    [Parameter(Mandatory = $true)][pscustomobject]$CatalogEntry,
    [Parameter(Mandatory = $true)][string]$CharacterId,
    [int]$Level = 0
  )

  $resolvedLevel = [Math]::Max(0, [Math]::Min(5, $Level))
  $skillRank = if ($null -ne $CatalogEntry.skillRank -and [double]$CatalogEntry.skillRank -gt 0) { [double]$CatalogEntry.skillRank } else { 1 }
  $skillPoints = Get-SkillPointsForLevel -Rank $skillRank -Level $resolvedLevel
  $ownerId = [Int64]::Parse($CharacterId, $script:Culture)
  $skillTypeId = if ($null -ne $CatalogEntry.typeID) { [Int64]$CatalogEntry.typeID } else { [Int64]$CatalogEntry.skillKey }
  $itemId = ($ownerId * 100000L) + $skillTypeId

  return [pscustomobject]@{
    itemID = $itemId
    typeID = $skillTypeId
    ownerID = $ownerId
    locationID = $ownerId
    flagID = 7
    categoryID = 16
    groupID = $CatalogEntry.groupID
    groupName = $CatalogEntry.groupName
    itemName = $CatalogEntry.itemName
    published = if ($null -ne $CatalogEntry.published) { [bool]$CatalogEntry.published } else { $true }
    skillLevel = $resolvedLevel
    trainedSkillLevel = $resolvedLevel
    effectiveSkillLevel = $resolvedLevel
    virtualSkillLevel = $null
    skillRank = $skillRank
    skillPoints = $skillPoints
    trainedSkillPoints = $skillPoints
    inTraining = $false
    trainingStartSP = $skillPoints
    trainingDestinationSP = $skillPoints
    trainingStartTime = $null
    trainingEndTime = $null
  }
}

function New-DatabaseSkillCatalog {
  if (-not $script:DatabaseSnapshot) { return @() }

  $catalogByKey = @{}
  foreach ($catalogEntry in @($script:DatabaseSnapshot.skillCatalog)) {
    $catalogByKey[[string]$catalogEntry.skillKey] = ConvertTo-DeepClone $catalogEntry
  }

  foreach ($skill in @($script:DbWorkingPlayer.skillsList)) {
    $skillKey = [string]$skill.skillKey
    if (-not $catalogByKey.ContainsKey($skillKey)) {
      $catalogByKey[$skillKey] = [pscustomobject]@{
        skillKey = $skillKey
        typeID = if ($null -ne $skill.typeID) { $skill.typeID } else { [int]$skillKey }
        itemName = $skill.itemName
        groupName = $skill.groupName
        groupID = $skill.groupID
        skillRank = if ($null -ne $skill.skillRank) { $skill.skillRank } else { 1 }
        published = $true
      }
    }
  }

  return @(
    $catalogByKey.Values |
      Sort-Object groupName, itemName, skillKey |
      ForEach-Object {
        Add-TypeIconFields -Object $_ -IconSpec (Resolve-SkillIconSpec -GroupName $_.groupName -ItemName $_.itemName) -TypeId $_.typeID
      }
  )
}

function Get-ShipCatalogEntryByTypeId {
  param([object]$TypeId)

  if (-not $script:DatabaseSnapshot) { return $null }
  return ($script:DatabaseSnapshot.shipCatalog | Where-Object { [string]$_.typeID -eq [string]$TypeId } | Select-Object -First 1)
}

function Resolve-ItemLocationLabel {
  param(
    [Parameter(Mandatory = $true)][object]$Raw,
    [hashtable]$RawLookup = @{}
  )

  $locationId = [string](Get-JsonPropertyValue -Object $Raw -Name "locationID")
  if ([string]::IsNullOrWhiteSpace($locationId)) { return "Unknown location" }

  if ($script:DbWorkingPlayer) {
    $character = Get-JsonPropertyValue -Object $script:DbWorkingPlayer -Name "character"
    $summary = Get-JsonPropertyValue -Object $script:DbWorkingPlayer -Name "summary"
    $stationId = Get-JsonPropertyValue -Object $character -Name "stationID"
    $solarSystemId = Get-JsonPropertyValue -Object $character -Name "solarSystemID"
    $stationName = Get-JsonPropertyValue -Object $summary -Name "stationName"
    $solarSystemName = Get-JsonPropertyValue -Object $summary -Name "solarSystemName"

    if ($locationId -eq [string]$stationId) {
      return "Station Hangar | $stationName"
    }
    if ($locationId -eq [string]$solarSystemId) {
      return "In Space | $solarSystemName"
    }
  }

  if ($RawLookup.ContainsKey($locationId)) {
    $container = $RawLookup[$locationId]
    $containerShipName = Get-JsonPropertyValue -Object $container -Name "shipName"
    $containerItemName = Get-JsonPropertyValue -Object $container -Name "itemName"
    $containerName =
      if ($containerShipName) { [string]$containerShipName }
      elseif ($containerItemName) { [string]$containerItemName }
      else { "Container $locationId" }
    return "Cargo | $containerName"
  }

  $workingItems = @(Get-JsonPropertyValue -Object $script:DbWorkingPlayer -Name "itemsList")
  $existingContainer =
    (
    $workingItems |
      Where-Object {
        $candidateKey = Get-JsonPropertyValue -Object $_ -Name "itemKey"
        if ($null -eq $candidateKey) { $candidateKey = Get-JsonPropertyValue -Object $_ -Name "itemID" }
        [string]$candidateKey -eq $locationId
      } |
      Select-Object -First 1
    )
  if ($existingContainer) {
    $existingContainerName = Get-JsonPropertyValue -Object $existingContainer -Name "itemName"
    return "Cargo | $existingContainerName"
  }

  return "Location $locationId"
}

function Convert-RawItemToListEntry {
  param(
    [Parameter(Mandatory = $true)][string]$ItemKey,
    [Parameter(Mandatory = $true)][object]$Raw,
    [hashtable]$RawLookup = @{}
  )

  $categoryIdValue = Get-JsonPropertyValue -Object $Raw -Name "categoryID"
  $typeIdValue = Get-JsonPropertyValue -Object $Raw -Name "typeID"
  $shipNameValue = Get-JsonPropertyValue -Object $Raw -Name "shipName"
  $itemNameValue = Get-JsonPropertyValue -Object $Raw -Name "itemName"
  $groupNameValue = Get-JsonPropertyValue -Object $Raw -Name "groupName"
  $quantityRaw = Get-JsonPropertyValue -Object $Raw -Name "quantity"
  $stackSizeRaw = Get-JsonPropertyValue -Object $Raw -Name "stacksize"
  $groupIdValue = Get-JsonPropertyValue -Object $Raw -Name "groupID"

  $categoryId = if ($null -ne $categoryIdValue) { [int]$categoryIdValue } else { $null }
  $catalogEntry = if ($categoryId -eq 6) { Get-ShipCatalogEntryByTypeId -TypeId $typeIdValue } else { $null }
  $itemName =
    if ($shipNameValue) { [string]$shipNameValue }
    elseif ($itemNameValue) { [string]$itemNameValue }
    elseif ($catalogEntry) { [string]$catalogEntry.name }
    else { "Item $ItemKey" }
  $groupName =
    if ($groupNameValue) { [string]$groupNameValue }
    elseif ($catalogEntry -and $catalogEntry.groupName) { [string]$catalogEntry.groupName }
    else { "" }
  $quantityValue =
    if ($categoryId -eq 6) { 1 }
    elseif ($null -ne $quantityRaw -and [double]$quantityRaw -gt 0) { [double]$quantityRaw }
    elseif ($null -ne $stackSizeRaw -and [double]$stackSizeRaw -gt 0) { [double]$stackSizeRaw }
    else { 1 }
  $metaText =
    if ($categoryId -eq 6) {
      if ($groupName) { "Ship | $groupName" } else { "Ship" }
    } else {
      $groupLabel = if ($groupName) { $groupName } else { "Inventory Item" }
      "$groupLabel | Qty $([int64][Math]::Round($quantityValue))"
    }

  Add-TypeIconFields -Object ([pscustomobject]@{
    itemKey = [string]$ItemKey
    typeID = $typeIdValue
    itemName = $itemName
    typeName = if ($catalogEntry) { $catalogEntry.name } elseif ($itemNameValue) { [string]$itemNameValue } else { "Type $typeIdValue" }
    quantity = $quantityValue
    quantityLabel = if ($categoryId -eq 6) { $groupName } else { "x$([int64][Math]::Round($quantityValue))" }
    categoryID = $categoryId
    groupID = $groupIdValue
    groupName = $groupName
    locationLabel = Resolve-ItemLocationLabel -Raw $Raw -RawLookup $RawLookup
    metaText = $metaText
    isShip = ($categoryId -eq 6)
    raw = $Raw
  }) -IconSpec (Resolve-ItemIconSpec -GroupName $groupName -CategoryID $categoryId -ItemName $itemName) -TypeId $typeIdValue
}

function Convert-ItemMapToList {
  param([Parameter(Mandatory = $true)][pscustomobject]$ItemsMap)

  $rawLookup = @{}
  foreach ($property in $ItemsMap.PSObject.Properties) {
    $rawLookup[[string]$property.Name] = ConvertTo-DeepClone $property.Value
  }

  return @(
    $ItemsMap.PSObject.Properties |
      ForEach-Object {
        Convert-RawItemToListEntry -ItemKey ([string]$_.Name) -Raw (ConvertTo-DeepClone $_.Value) -RawLookup $rawLookup
      } |
      Sort-Object itemName, itemKey
  )
}

function Get-PlayerDisplayEntry {
  param([Parameter(Mandatory = $true)][pscustomobject]$Player)

  Add-TypeIconFields -Object ([pscustomobject]@{
    characterId = [string]$Player.characterId
    characterName = [string]$Player.characterName
    accountName = [string]$Player.accountName
    shipName = [string]$Player.shipName
    shipTypeID = $Player.shipTypeID
    solarSystemName = [string]$Player.solarSystemName
    warningMessages = @($Player.warningMessages)
    searchText = [string]$Player.searchText
  }) -IconSpec (Resolve-ShipIconSpec -GroupName "" -ShipName $Player.shipName) -TypeId $Player.shipTypeID
}

function Search-DatabaseTypes {
  param(
    [Parameter(Mandatory = $true)][ValidateSet("ship", "item")][string]$Kind,
    [string]$Query = ""
  )

  if ($Kind -eq "ship" -and $script:DatabaseSnapshot -and $script:DatabaseSnapshot.shipCatalog) {
    $needle = $Query.Trim().ToLowerInvariant()
    return @(
      $script:DatabaseSnapshot.shipCatalog |
        Where-Object {
          if ($needle -eq "") { return $true }
          (("{0} {1}" -f $_.name, $_.groupName).ToLowerInvariant() -like "*$needle*")
        } |
        Select-Object -First 80
    )
  }

  return @(Invoke-ProjectCli -Command "database-type-search" -Arguments @($Kind, $Query))
}

function Convert-TypeSearchResultToDisplayEntry {
  param(
    [Parameter(Mandatory = $true)][ValidateSet("ship", "item")][string]$Kind,
    [Parameter(Mandatory = $true)][pscustomobject]$Result
  )

  $displayName = if ($Kind -eq "ship") { [string]$Result.name } else { [string]$Result.name }
  $metaText =
    if ($Kind -eq "ship") {
      "{0} | Cargo {1:N0} m3" -f $Result.groupName, [double]$Result.capacity
    } else {
      "{0} | Volume {1:N2} m3" -f $Result.groupName, [double]$Result.volume
    }

  Add-TypeIconFields -Object ([pscustomobject]@{
    typeID = [string]$Result.typeID
    name = $displayName
    groupName = [string]$Result.groupName
    categoryID = $Result.categoryID
    metaText = $metaText
    raw = $Result
  }) -IconSpec (
    if ($Kind -eq "ship") {
      Resolve-ShipIconSpec -GroupName $Result.groupName -ShipName $displayName
    } else {
      Resolve-ItemIconSpec -GroupName $Result.groupName -CategoryID $Result.categoryID -ItemName $displayName
    }
  ) -TypeId $Result.typeID
}

function Get-NextGeneratedItemId {
  if (-not $script:NextGeneratedItemId) {
    $script:NextGeneratedItemId =
      if ($script:DatabaseSnapshot -and $script:DatabaseSnapshot.nextItemIdSeed) {
        [int64]$script:DatabaseSnapshot.nextItemIdSeed
      } else {
        [int64]990000001
      }
  }

  $nextId = [int64]$script:NextGeneratedItemId
  $script:NextGeneratedItemId = $nextId + 1
  return $nextId
}

function New-LocationOption {
  param(
    [Parameter(Mandatory = $true)][string]$Key,
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][Int64]$LocationId,
    [Parameter(Mandatory = $true)][int]$FlagId,
    [string]$HelperText = ""
  )

  return [pscustomobject]@{
    key = $Key
    label = $Label
    locationID = $LocationId
    flagID = $FlagId
    helperText = $HelperText
  }
}

function Get-ShipLocationOptions {
  param([pscustomobject]$ExistingItem)

  $options = New-Object System.Collections.Generic.List[object]
  $seen = @{}
  $character = $script:DbWorkingPlayer.character
  $summary = $script:DbWorkingPlayer.summary

  if ($character.stationID) {
    $option = New-LocationOption -Key "station" -Label ("Station Hangar | {0}" -f $summary.stationName) -LocationId ([int64]$character.stationID) -FlagId 4 -HelperText "Safe default. The ship will appear in the pilot's station hangar."
    $seen[$option.key] = $true
    $options.Add($option)
  }

  if ($character.solarSystemID) {
    $option = New-LocationOption -Key "space" -Label ("In Space | {0}" -f $summary.solarSystemName) -LocationId ([int64]$character.solarSystemID) -FlagId 0 -HelperText "Places the ship in space in the pilot's current solar system."
    $seen[$option.key] = $true
    $options.Add($option)
  }

  if ($ExistingItem) {
    $currentKey = "current:{0}:{1}" -f [string]$ExistingItem.raw.locationID, [string]$ExistingItem.raw.flagID
    if (-not $seen.ContainsKey($currentKey)) {
      $options.Add((New-LocationOption -Key $currentKey -Label ("Keep Current | {0}" -f $ExistingItem.locationLabel) -LocationId ([int64]$ExistingItem.raw.locationID) -FlagId ([int]$ExistingItem.raw.flagID) -HelperText "Preserves the ship exactly where it already lives.")) | Out-Null
    }
  }

  return @($options)
}

function Get-ItemLocationOptions {
  param([pscustomobject]$ExistingItem)

  $options = New-Object System.Collections.Generic.List[object]
  $seen = @{}
  $character = $script:DbWorkingPlayer.character
  $summary = $script:DbWorkingPlayer.summary

  if ($character.stationID) {
    $option = New-LocationOption -Key "station" -Label ("Station Hangar | {0}" -f $summary.stationName) -LocationId ([int64]$character.stationID) -FlagId 4 -HelperText "Places the item directly in the pilot's station hangar."
    $seen[$option.key] = $true
    $options.Add($option)
  }

  foreach ($ship in @($script:DbWorkingPlayer.itemsList | Where-Object { [int]$_.categoryID -eq 6 })) {
    $option = New-LocationOption -Key ("cargo:{0}" -f $ship.itemKey) -Label ("Cargo | {0}" -f $ship.itemName) -LocationId ([int64]$ship.itemKey) -FlagId 5 -HelperText "Adds the item into this ship's cargo hold."
    if (-not $seen.ContainsKey($option.key)) {
      $seen[$option.key] = $true
      $options.Add($option)
    }
  }

  if ($ExistingItem) {
    $currentKey = "current:{0}:{1}" -f [string]$ExistingItem.raw.locationID, [string]$ExistingItem.raw.flagID
    if (-not $seen.ContainsKey($currentKey)) {
      $options.Add((New-LocationOption -Key $currentKey -Label ("Keep Current | {0}" -f $ExistingItem.locationLabel) -LocationId ([int64]$ExistingItem.raw.locationID) -FlagId ([int]$ExistingItem.raw.flagID) -HelperText "Preserves the current container or location for this item.")) | Out-Null
    }
  }

  return @($options)
}

function New-DefaultSpaceState {
  param([Parameter(Mandatory = $true)][Int64]$SystemId)

  return [pscustomobject]@{
    systemID = $SystemId
    position = [pscustomobject]@{ x = 0; y = 0; z = 0 }
    velocity = [pscustomobject]@{ x = 0; y = 0; z = 0 }
    direction = [pscustomobject]@{ x = 1; y = 0; z = 0 }
    targetPoint = [pscustomobject]@{ x = 0; y = 0; z = 0 }
    speedFraction = 0
    mode = "STOP"
    targetEntityID = $null
    followRange = 0
    orbitDistance = 0
    orbitNormal = [pscustomobject]@{ x = 0; y = 0; z = 1 }
    orbitSign = 1
    warpState = $null
  }
}

function New-DefaultConditionState {
  return [pscustomobject]@{
    damage = 0
    charge = 1
    armorDamage = 0
    shieldCharge = 1
    incapacitated = $false
  }
}

function Build-ShipRawFromType {
  param(
    [Parameter(Mandatory = $true)][pscustomobject]$TypeEntry,
    [Parameter(Mandatory = $true)][pscustomobject]$LocationOption,
    [Parameter(Mandatory = $true)][string]$DisplayName,
    [pscustomobject]$ExistingRaw
  )

  $raw = if ($ExistingRaw) { ConvertTo-DeepClone $ExistingRaw } else { [pscustomobject]@{} }
  $itemId = if ($ExistingRaw) { [int64]$ExistingRaw.itemID } else { Get-NextGeneratedItemId }
  $resolvedName = if ($DisplayName.Trim()) { $DisplayName.Trim() } else { [string]$TypeEntry.name }
  $spaceState =
    if ([int]$LocationOption.flagID -eq 0) {
      if ($ExistingRaw -and $ExistingRaw.spaceState) { ConvertTo-DeepClone $ExistingRaw.spaceState } else { New-DefaultSpaceState -SystemId ([int64]$LocationOption.locationID) }
    } else {
      $null
    }

  foreach ($pair in ([ordered]@{
    itemID = $itemId
    typeID = [int]$TypeEntry.typeID
    ownerID = [int64]$script:DbWorkingPlayer.characterId
    locationID = [int64]$LocationOption.locationID
    flagID = [int]$LocationOption.flagID
    quantity = -1
    stacksize = 1
    singleton = 1
    groupID = $TypeEntry.groupID
    categoryID = 6
    customInfo = ""
    itemName = $resolvedName
    mass = $TypeEntry.mass
    volume = $TypeEntry.volume
    capacity = $TypeEntry.capacity
    radius = $TypeEntry.radius
    spaceState = $spaceState
    conditionState = if ($ExistingRaw -and $ExistingRaw.conditionState) { ConvertTo-DeepClone $ExistingRaw.conditionState } else { New-DefaultConditionState }
    shipID = $itemId
    shipTypeID = [int]$TypeEntry.typeID
    shipName = $resolvedName
  }).GetEnumerator()) {
    Set-ObjectProperty -Object $raw -Name $pair.Key -Value $pair.Value
  }

  return $raw
}

function Build-InventoryItemRawFromType {
  param(
    [Parameter(Mandatory = $true)][pscustomobject]$TypeEntry,
    [Parameter(Mandatory = $true)][pscustomobject]$LocationOption,
    [Parameter(Mandatory = $true)][string]$DisplayName,
    [Parameter(Mandatory = $true)][Int64]$Quantity,
    [pscustomobject]$ExistingRaw
  )

  $raw = if ($ExistingRaw) { ConvertTo-DeepClone $ExistingRaw } else { [pscustomobject]@{} }
  $itemId = if ($ExistingRaw) { [int64]$ExistingRaw.itemID } else { Get-NextGeneratedItemId }
  $resolvedName = if ($DisplayName.Trim()) { $DisplayName.Trim() } else { [string]$TypeEntry.name }

  foreach ($pair in ([ordered]@{
    itemID = $itemId
    typeID = [int]$TypeEntry.typeID
    ownerID = [int64]$script:DbWorkingPlayer.characterId
    locationID = [int64]$LocationOption.locationID
    flagID = [int]$LocationOption.flagID
    quantity = $Quantity
    stacksize = $Quantity
    singleton = 0
    groupID = $TypeEntry.groupID
    categoryID = $TypeEntry.categoryID
    customInfo = ""
    itemName = $resolvedName
    mass = $TypeEntry.mass
    volume = $TypeEntry.volume
    capacity = $TypeEntry.capacity
    radius = $TypeEntry.radius
  }).GetEnumerator()) {
    Set-ObjectProperty -Object $raw -Name $pair.Key -Value $pair.Value
  }

  return $raw
}

function Update-SelectedShipReferences {
  param([Parameter(Mandatory = $true)][pscustomobject]$UpdatedEntry)

  if ([string]$UpdatedEntry.itemKey -ne [string]$script:DbWorkingPlayer.character.shipID) { return }

  Set-ObjectProperty -Object $script:DbWorkingPlayer.character -Name "shipID" -Value ([int64]$UpdatedEntry.itemKey)
  Set-ObjectProperty -Object $script:DbWorkingPlayer.character -Name "shipTypeID" -Value $UpdatedEntry.raw.shipTypeID
  Set-ObjectProperty -Object $script:DbWorkingPlayer.character -Name "shipName" -Value $UpdatedEntry.raw.shipName
  Set-ObjectProperty -Object $script:DbWorkingPlayer.summary -Name "shipName" -Value $UpdatedEntry.raw.shipName
}

function Update-ItemActionState {
  $hasSelection = $script:DbItemPreviewList -and $script:DbItemPreviewList.SelectedItem
  if ($script:DbEditItemButton) { $script:DbEditItemButton.IsEnabled = [bool]$hasSelection }
  if ($script:DbRemoveItemButton) { $script:DbRemoveItemButton.IsEnabled = [bool]$hasSelection }
}

function Open-ItemShipEditor {
  param(
    [Parameter(Mandatory = $true)][ValidateSet("ship", "item")][string]$Kind,
    [pscustomobject]$ExistingItem
  )

  if (-not $script:DbWorkingPlayer) { return }
  Sync-OverviewControlsToWorkingCopy

  $isEdit = ($null -ne $ExistingItem)
  $windowTitle =
    if ($Kind -eq "ship") {
      if ($isEdit) { "Edit Ship" } else { "Add Ship" }
    } else {
      if ($isEdit) { "Edit Item" } else { "Add Item" }
    }
  $helperText =
    if ($Kind -eq "ship") {
      "Pick a hull, give it a pilot-friendly name, and choose whether it lands in the hangar or current system."
    } else {
      "Search the item database, set quantity, and drop the stack into a hangar or ship cargo hold."
    }

  [xml]$editorXaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Width="1020" Height="700" MinWidth="900" MinHeight="620" WindowStartupLocation="CenterOwner" Background="{DynamicResource WindowBg}" FontFamily="Segoe UI">
  <Grid Margin="18">
    <Grid.RowDefinitions><RowDefinition Height="Auto" /><RowDefinition Height="*" /><RowDefinition Height="Auto" /></Grid.RowDefinitions>
    <Border Grid.Row="0" CornerRadius="22" Padding="22" Margin="0,0,0,16" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1">
      <StackPanel>
        <TextBlock x:Name="EditorHeroTitle" FontSize="28" FontWeight="SemiBold" Foreground="{DynamicResource TextPrimary}" />
        <TextBlock x:Name="EditorHeroText" Margin="0,8,0,0" FontSize="13" Foreground="{DynamicResource TextSecondary}" TextWrapping="Wrap" />
      </StackPanel>
    </Border>
    <Grid Grid.Row="1">
      <Grid.ColumnDefinitions><ColumnDefinition Width="360" /><ColumnDefinition Width="16" /><ColumnDefinition Width="*" /></Grid.ColumnDefinitions>
      <Border Grid.Column="0" CornerRadius="20" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" Padding="16">
        <DockPanel LastChildFill="True">
          <StackPanel DockPanel.Dock="Top">
            <TextBlock Text="Catalog Search" FontSize="18" FontWeight="SemiBold" Foreground="{DynamicResource TextPrimary}" />
            <TextBlock Text="Search by name or group." Margin="0,6,0,12" FontSize="12" Foreground="{DynamicResource TextMuted}" />
            <TextBox x:Name="EditorSearchBox" Height="38" Padding="10,6,10,6" BorderBrush="{DynamicResource BorderStrong}" BorderThickness="1" Background="{DynamicResource PanelInput}" Foreground="{DynamicResource TextPrimary}" />
          </StackPanel>
          <ListBox x:Name="EditorResultList" Margin="0,12,0,0" BorderThickness="0" Background="Transparent" />
        </DockPanel>
      </Border>
      <Border Grid.Column="2" CornerRadius="20" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" Padding="20">
        <Grid>
          <Grid.RowDefinitions><RowDefinition Height="Auto" /><RowDefinition Height="Auto" /><RowDefinition Height="Auto" /><RowDefinition Height="Auto" /><RowDefinition Height="*" /></Grid.RowDefinitions>
          <DockPanel Grid.Row="0">
            <Border x:Name="EditorIconCard" Width="54" Height="54" CornerRadius="16" BorderBrush="{DynamicResource Border}" BorderThickness="1" Background="{DynamicResource EditorIconBg}">
              <Grid>
                <TextBlock x:Name="EditorIconGlyph" FontFamily="Segoe MDL2 Assets" FontSize="24" Foreground="{DynamicResource TextAccent}" HorizontalAlignment="Center" VerticalAlignment="Center" />
                <Image x:Name="EditorIconImage" Stretch="Uniform" Margin="6" />
              </Grid>
            </Border>
            <StackPanel Margin="14,0,0,0">
              <TextBlock x:Name="EditorNameHeadline" FontSize="24" FontWeight="SemiBold" Foreground="{DynamicResource TextPrimary}" />
              <TextBlock x:Name="EditorMetaText" Margin="0,6,0,0" FontSize="12" Foreground="{DynamicResource TextMuted}" TextWrapping="Wrap" />
            </StackPanel>
          </DockPanel>
          <Border Grid.Row="1" Margin="0,16,0,0" CornerRadius="14" Background="{DynamicResource PanelSubtle}" BorderBrush="{DynamicResource Border}" BorderThickness="1" Padding="14">
            <TextBlock x:Name="EditorHelperText" FontSize="12" Foreground="{DynamicResource TextSecondary}" TextWrapping="Wrap" />
          </Border>
          <Grid Grid.Row="2" Margin="0,18,0,0">
            <Grid.ColumnDefinitions><ColumnDefinition Width="*" /><ColumnDefinition Width="*" /></Grid.ColumnDefinitions>
            <StackPanel Grid.Column="0" Margin="0,0,10,0">
              <TextBlock x:Name="EditorNameLabel" FontSize="12" FontWeight="SemiBold" Foreground="{DynamicResource TextMuted}" Margin="0,0,0,6" />
              <TextBox x:Name="EditorNameTextBox" Height="38" Padding="10,6,10,6" BorderBrush="{DynamicResource BorderStrong}" BorderThickness="1" Background="{DynamicResource PanelInput}" Foreground="{DynamicResource TextPrimary}" />
            </StackPanel>
            <StackPanel Grid.Column="1" Margin="10,0,0,0">
              <TextBlock x:Name="EditorQtyLabel" FontSize="12" FontWeight="SemiBold" Foreground="{DynamicResource TextMuted}" Margin="0,0,0,6" />
              <TextBox x:Name="EditorQtyTextBox" Height="38" Padding="10,6,10,6" BorderBrush="{DynamicResource BorderStrong}" BorderThickness="1" Background="{DynamicResource PanelInput}" Foreground="{DynamicResource TextPrimary}" />
            </StackPanel>
          </Grid>
          <StackPanel Grid.Row="3" Margin="0,18,0,0">
            <TextBlock Text="Where should it go?" FontSize="12" FontWeight="SemiBold" Foreground="{DynamicResource TextMuted}" Margin="0,0,0,6" />
            <ComboBox x:Name="EditorLocationCombo" Height="38" Padding="8,4,8,4" BorderBrush="{DynamicResource BorderStrong}" BorderThickness="1" Background="{DynamicResource PanelInput}" Foreground="{DynamicResource TextPrimary}" />
            <TextBlock x:Name="EditorLocationHelpText" Margin="0,8,0,0" FontSize="12" Foreground="{DynamicResource TextMuted}" TextWrapping="Wrap" />
          </StackPanel>
          <Border Grid.Row="4" Margin="0,18,0,0" CornerRadius="16" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" Padding="16">
            <StackPanel>
              <TextBlock Text="Power Notes" FontSize="13" FontWeight="SemiBold" Foreground="{DynamicResource TextPrimary}" />
              <TextBlock x:Name="EditorPowerText" Margin="0,8,0,0" FontSize="12" Foreground="{DynamicResource TextSecondary}" TextWrapping="Wrap" />
            </StackPanel>
          </Border>
        </Grid>
      </Border>
    </Grid>
    <Border Grid.Row="2" Margin="0,16,0,0" CornerRadius="18" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" Padding="16">
      <DockPanel LastChildFill="False">
        <TextBlock x:Name="EditorFooterText" VerticalAlignment="Center" FontSize="12" Foreground="{DynamicResource TextMuted}" Text="Changes are staged locally until you click Save Player Changes." />
        <StackPanel DockPanel.Dock="Right" Orientation="Horizontal">
          <Button x:Name="EditorCancelButton" Margin="0,0,10,0" Padding="14,10,14,10">Cancel</Button>
          <Button x:Name="EditorApplyButton" Padding="16,10,16,10">Stage Change</Button>
        </StackPanel>
      </DockPanel>
    </Border>
  </Grid>
</Window>
'@

  $editorWindow = [System.Windows.Markup.XamlReader]::Load([System.Xml.XmlNodeReader]::new($editorXaml))
  $editorWindow.Title = "EvEJS $windowTitle"
  $editorWindow.Owner = $script:Window
  $editorWindow.Add_SourceInitialized({ param($s, $e) Apply-WindowThemeChrome -Window $s })

  $editorHeroTitle = $editorWindow.FindName("EditorHeroTitle")
  $editorHeroText = $editorWindow.FindName("EditorHeroText")
  $editorSearchBox = $editorWindow.FindName("EditorSearchBox")
  $editorResultList = $editorWindow.FindName("EditorResultList")
  $editorIconCard = $editorWindow.FindName("EditorIconCard")
  $editorIconGlyph = $editorWindow.FindName("EditorIconGlyph")
  $editorIconImage = $editorWindow.FindName("EditorIconImage")
  $editorNameHeadline = $editorWindow.FindName("EditorNameHeadline")
  $editorMetaText = $editorWindow.FindName("EditorMetaText")
  $editorHelperText = $editorWindow.FindName("EditorHelperText")
  $editorNameLabel = $editorWindow.FindName("EditorNameLabel")
  $editorNameTextBox = $editorWindow.FindName("EditorNameTextBox")
  $editorQtyLabel = $editorWindow.FindName("EditorQtyLabel")
  $editorQtyTextBox = $editorWindow.FindName("EditorQtyTextBox")
  $editorLocationCombo = $editorWindow.FindName("EditorLocationCombo")
  $editorLocationHelpText = $editorWindow.FindName("EditorLocationHelpText")
  $editorPowerText = $editorWindow.FindName("EditorPowerText")
  $editorFooterText = $editorWindow.FindName("EditorFooterText")
  $editorCancelButton = $editorWindow.FindName("EditorCancelButton")
  $editorApplyButton = $editorWindow.FindName("EditorApplyButton")

  foreach ($button in @($editorCancelButton, $editorApplyButton)) { $button.Style = $script:Window.FindResource("SecondaryButtonStyle") }
  $editorApplyButton.Style = $script:Window.FindResource("PrimaryButtonStyle")
  Set-ButtonChrome -Button $editorCancelButton -Text "Cancel" -GlyphCode 0xE711 -IconKey "close"
  Set-ButtonChrome -Button $editorApplyButton -Text "Stage Change" -GlyphCode 0xE70B -IconKey "checkmark"

  $editorHeroTitle.Text = $windowTitle
  $editorHeroText.Text = $helperText
  $editorNameLabel.Text = if ($Kind -eq "ship") { "Ship Name" } else { "Display Name" }
  $editorQtyLabel.Text = if ($Kind -eq "ship") { "Hull Count" } else { "Quantity" }
  $editorQtyTextBox.Text = if ($Kind -eq "ship") { "1" } elseif ($ExistingItem) { [string][int64][Math]::Round([double]$ExistingItem.quantity) } else { "1" }
  if ($Kind -eq "ship") { $editorQtyTextBox.IsEnabled = $false; $editorQtyTextBox.Opacity = 0.55 }
  $editorPowerText.Text =
    if ($Kind -eq "ship") {
      "Editing the active ship updates the character ship name/type automatically. Removing the active ship is blocked on purpose."
    } else {
      "Use station hangar for safe storage, or cargo locations for immediate inventory placement on a ship."
    }
  $editorFooterText.Text = if ($isEdit) { "Editing $($ExistingItem.itemName). The change only hits disk when you save the player." } else { "This creates a new staged record for the selected player." }

  $editorResultList.SelectedValuePath = "typeID"
  $editorResultList.SetValue([System.Windows.Controls.ScrollViewer]::HorizontalScrollBarVisibilityProperty, [System.Windows.Controls.ScrollBarVisibility]::Disabled)
  $editorLocationCombo.Style = $script:Window.FindResource("ConfigComboBoxStyle")
  $editorLocationCombo.DisplayMemberPath = "label"
  $editorLocationCombo.SelectedValuePath = "key"
  $editorResultList.ItemContainerStyle = [System.Windows.Markup.XamlReader]::Parse(@'
<Style xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" TargetType="{x:Type ListBoxItem}">
  <Setter Property="Padding" Value="0" />
  <Setter Property="Margin" Value="0,0,0,10" />
  <Setter Property="HorizontalContentAlignment" Value="Stretch" />
  <Setter Property="Template"><Setter.Value><ControlTemplate TargetType="{x:Type ListBoxItem}"><Border x:Name="Card" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" CornerRadius="16"><ContentPresenter /></Border><ControlTemplate.Triggers><Trigger Property="IsMouseOver" Value="True"><Setter TargetName="Card" Property="Background" Value="{DynamicResource ListHoverBg}" /><Setter TargetName="Card" Property="BorderBrush" Value="{DynamicResource BorderSelSoft}" /></Trigger><Trigger Property="IsSelected" Value="True"><Setter TargetName="Card" Property="Background" Value="{DynamicResource ListSelBg}" /><Setter TargetName="Card" Property="BorderBrush" Value="{DynamicResource BorderSel}" /></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter>
</Style>
'@)
  $editorResultList.ItemTemplate = [System.Windows.Markup.XamlReader]::Parse(@'
<DataTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation">
  <Grid Margin="14,12">
    <Grid.ColumnDefinitions><ColumnDefinition Width="Auto" /><ColumnDefinition Width="12" /><ColumnDefinition Width="*" /></Grid.ColumnDefinitions>
    <Border Grid.Column="0" Width="40" Height="40" CornerRadius="12" Background="{Binding iconBackground}" BorderBrush="{Binding iconBorder}" BorderThickness="1">
      <Grid>
        <TextBlock Text="{Binding iconGlyph}" FontFamily="Segoe MDL2 Assets" FontSize="18" Foreground="{Binding iconForeground}" HorizontalAlignment="Center" VerticalAlignment="Center" />
        <Image Source="{Binding iconFilePath}" Stretch="Uniform" Margin="4" />
      </Grid>
    </Border>
    <StackPanel Grid.Column="2">
      <TextBlock Text="{Binding name}" FontSize="13" FontWeight="SemiBold" Foreground="{DynamicResource TextPrimary}" />
      <TextBlock Text="{Binding metaText}" Margin="0,4,0,0" FontSize="11" Foreground="{DynamicResource TextMuted}" TextWrapping="Wrap" />
    </StackPanel>
  </Grid>
</DataTemplate>
'@)

  $locationOptions = if ($Kind -eq "ship") { @(Get-ShipLocationOptions -ExistingItem $ExistingItem) } else { @(Get-ItemLocationOptions -ExistingItem $ExistingItem) }
  $editorLocationCombo.ItemsSource = $locationOptions
  if (@($locationOptions).Count -gt 0) { $editorLocationCombo.SelectedIndex = 0 }

  $selectedDisplayResult = $null
  $updateLocationHelp = {
    $selection = $editorLocationCombo.SelectedItem
    $editorLocationHelpText.Text = if ($selection) { [string]$selection.helperText } else { "" }
  }
  $refreshSelectionPanel = {
    $selection = $editorResultList.SelectedItem
    if (-not $selection) { return }
    $selectedDisplayResult = $selection
    $editorIconGlyph.Text = [string]$selection.iconGlyph
    $editorIconGlyph.Foreground = New-Brush ([string]$selection.iconForeground)
    $editorIconCard.Background = New-Brush ([string]$selection.iconBackground)
    $editorIconCard.BorderBrush = New-Brush ([string]$selection.iconBorder)
    $editorIconImage.Source = if ($selection.iconFilePath) { $selection.iconFilePath } else { $null }
    $editorNameHeadline.Text = [string]$selection.name
    $editorMetaText.Text = [string]$selection.metaText
    $editorHelperText.Text =
      if ($Kind -eq "ship") {
        "Type ID $($selection.typeID) | $($selection.groupName). Great for stocking replacement hulls or staging named admin ships."
      } else {
        "Type ID $($selection.typeID) | $($selection.groupName). Friendly editor mode keeps you out of raw JSON for normal inventory work."
      }
    if ([string]::IsNullOrWhiteSpace($editorNameTextBox.Text)) {
      $editorNameTextBox.Text = [string]$selection.name
    }
  }
  $refreshResults = {
    $results = @(Search-DatabaseTypes -Kind $Kind -Query $editorSearchBox.Text)
    $display = @($results | ForEach-Object { Convert-TypeSearchResultToDisplayEntry -Kind $Kind -Result $_ })
    $editorResultList.ItemsSource = $display
    if ($display.Count -gt 0) {
      $preferredTypeId =
        if ($ExistingItem) {
          [string](Get-JsonPropertyValue -Object $ExistingItem.raw -Name "typeID")
        } elseif ($selectedDisplayResult) {
          [string]$selectedDisplayResult.typeID
        } else {
          [string]$display[0].typeID
        }
      $resolved = ($display | Where-Object { [string]$_.typeID -eq $preferredTypeId } | Select-Object -First 1)
      $editorResultList.SelectedItem = if ($resolved) { $resolved } else { $display[0] }
    }
  }

  if ($ExistingItem) {
    $existingShipName = Get-JsonPropertyValue -Object $ExistingItem.raw -Name "shipName"
    $editorNameTextBox.Text = if ($existingShipName) { [string]$existingShipName } else { [string]$ExistingItem.itemName }
    foreach ($locationOption in @($locationOptions)) {
      $existingLocationId = [int64](Get-JsonPropertyValue -Object $ExistingItem.raw -Name "locationID")
      $existingFlagId = [int](Get-JsonPropertyValue -Object $ExistingItem.raw -Name "flagID")
      if ([int64]$locationOption.locationID -eq $existingLocationId -and [int]$locationOption.flagID -eq $existingFlagId) {
        $editorLocationCombo.SelectedValue = $locationOption.key
        break
      }
    }
    if ($Kind -eq "item") {
      $editorQtyTextBox.Text = [string][int64][Math]::Round([double]$ExistingItem.quantity)
    }
    $editorSearchBox.Text = [string]$ExistingItem.itemName
  }

  $editorSearchBox.Add_TextChanged({ & $refreshResults })
  $editorResultList.Add_SelectionChanged({ & $refreshSelectionPanel })
  $editorLocationCombo.Add_SelectionChanged({ & $updateLocationHelp })
  $editorCancelButton.Add_Click({ $editorWindow.Close() })
  $editorApplyButton.Add_Click({
    try {
      $selectedType = $editorResultList.SelectedItem
      if (-not $selectedType) { throw "Pick a ship or item type first." }
      $location = $editorLocationCombo.SelectedItem
      if (-not $location) { throw "Choose where the item should go." }

      $displayName = $editorNameTextBox.Text.Trim()
      if ([string]::IsNullOrWhiteSpace($displayName)) { $displayName = [string]$selectedType.name }
      $existingRaw = if ($ExistingItem) { $ExistingItem.raw } else { $null }

      $newRaw =
        if ($Kind -eq "ship") {
          Build-ShipRawFromType -TypeEntry $selectedType.raw -LocationOption $location -DisplayName $displayName -ExistingRaw $existingRaw
        } else {
          $quantity = [int64](Parse-NumericText -Text $editorQtyTextBox.Text -Label "Item quantity")
          if ($quantity -lt 1) { throw "Item quantity must be at least 1." }
          Build-InventoryItemRawFromType -TypeEntry $selectedType.raw -LocationOption $location -DisplayName $displayName -Quantity $quantity -ExistingRaw $existingRaw
        }

      $newEntry = Convert-RawItemToListEntry -ItemKey ([string]$newRaw.itemID) -Raw $newRaw

      if ($ExistingItem) {
        $script:DbWorkingPlayer.itemsList = @(
          foreach ($candidate in @($script:DbWorkingPlayer.itemsList)) {
            if ([string]$candidate.itemKey -eq [string]$ExistingItem.itemKey) { $newEntry } else { $candidate }
          }
        )
      } else {
        $script:DbWorkingPlayer.itemsList = @($script:DbWorkingPlayer.itemsList + $newEntry | Sort-Object itemName, itemKey)
      }

      if ($Kind -eq "ship") { Update-SelectedShipReferences -UpdatedEntry $newEntry }
      Update-WorkingPlayerDerivedData
      Render-DatabasePlayer
      Set-DatabaseDirtyState -Dirty $true -Message ("{0} {1} is staged in the database working copy." -f $(if ($isEdit) { "Updated" } else { "Added" }), $displayName)
      $editorWindow.DialogResult = $true
      $editorWindow.Close()
    } catch {
      [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Database Helper", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
    }
  })

  & $refreshResults
  & $updateLocationHelp
  $null = $editorWindow.ShowDialog()
}

function Remove-SelectedInventoryEntry {
  if (-not $script:DbItemPreviewList.SelectedItem) { return }

  $selectedItem = [pscustomobject]$script:DbItemPreviewList.SelectedItem
  if ([string]$selectedItem.itemKey -eq [string]$script:DbWorkingPlayer.character.shipID) {
    throw "The currently active ship cannot be removed from this helper. Switch the player to another ship first."
  }

  $decision = [System.Windows.MessageBox]::Show(
    "Remove $($selectedItem.itemName) from the staged player inventory?",
    "EvEJS Database Helper",
    [System.Windows.MessageBoxButton]::YesNo,
    [System.Windows.MessageBoxImage]::Warning
  )
  if ($decision -ne [System.Windows.MessageBoxResult]::Yes) { return }

  $script:DbWorkingPlayer.itemsList = @($script:DbWorkingPlayer.itemsList | Where-Object { [string]$_.itemKey -ne [string]$selectedItem.itemKey })
  Update-WorkingPlayerDerivedData
  Render-DatabasePlayer
  Set-DatabaseDirtyState -Dirty $true -Message "$($selectedItem.itemName) was removed from the staged inventory."
}

function Update-DatabaseSummary {
  if (-not $script:DbWorkingPlayer) { return }
  $summary = $script:DbWorkingPlayer.summary
  $script:DbPlayerHeadline.Text = "$($summary.characterName)  •  $($script:DbWorkingPlayer.accountName)"
  $script:DbPlayerMeta.Text = "$($summary.shipName) • $($summary.stationName) • $($summary.solarSystemName) • $($summary.corporationName)"
  $warnings = @($script:DbWorkingPlayer.warningMessages)
  $script:DbWarningText.Text = ($warnings -join " ")
  $script:DbWarningText.Visibility = if ($warnings.Count -gt 0) { [System.Windows.Visibility]::Visible } else { [System.Windows.Visibility]::Collapsed }

  $script:DbMetricPanel.Children.Clear()
  $script:DbMetricPanel.Children.Add((New-Badge -Text ("ISK: {0}" -f (Format-DisplayValue $summary.balance)) -Background (Get-ThemeHex 'BadgeBlueBg') -Foreground (Get-ThemeHex 'BadgeBlueFg'))) | Out-Null
  $script:DbMetricPanel.Children.Add((New-Badge -Text ("Skills: {0}" -f $summary.skillCount) -Background (Get-ThemeHex 'BadgeGreenBg') -Foreground (Get-ThemeHex 'BadgeGreenFg'))) | Out-Null
  $script:DbMetricPanel.Children.Add((New-Badge -Text ("Items: {0}" -f $summary.itemCount) -Background (Get-ThemeHex 'BadgePurpleBg') -Foreground (Get-ThemeHex 'BadgePurpleFg'))) | Out-Null
}

function Render-OverviewFields {
  if (-not $script:DbWorkingPlayer) { return }
  $account = $script:DbWorkingPlayer.account
  $character = $script:DbWorkingPlayer.character
  $summary = $script:DbWorkingPlayer.summary

  $script:DbAccountNameTextBox.Text = [string]$script:DbWorkingPlayer.accountName
  $script:DbBannedCheckBox.IsChecked = [bool]$account.banned
  $script:DbCharacterNameTextBox.Text = [string]$character.characterName
  $script:DbShipNameTextBox.Text = [string]$character.shipName
  $script:DbBalanceTextBox.Text = Format-DisplayValue $character.balance
  $script:DbPlexTextBox.Text = Format-DisplayValue $character.plexBalance
  $script:DbAurTextBox.Text = Format-DisplayValue $character.aurBalance
  $script:DbSecurityStatusTextBox.Text = Format-DisplayValue $character.securityStatus
  $script:DbDaysLeftTextBox.Text = Format-DisplayValue $character.daysLeft
  $script:DbDescriptionTextBox.Text = [string]$character.description
  $script:DbOverviewCorporationText.Text = [string]$summary.corporationName
  $script:DbOverviewStationText.Text = [string]$summary.stationName
  $script:DbOverviewSystemText.Text = [string]$summary.solarSystemName

  $script:DbSkillPreviewList.DisplayMemberPath = "label"
  $script:DbSkillPreviewList.ItemsSource = Build-DisplayItems -Items @($script:DbWorkingPlayer.skillsList) -KeyName "skillKey" -LabelBuilder {
    param($skill)
    "{0}  •  Level {1}" -f $skill.itemName, $skill.skillLevel
  }

  $script:DbItemPreviewList.DisplayMemberPath = "label"
  $script:DbItemPreviewList.ItemsSource = Build-DisplayItems -Items @($script:DbWorkingPlayer.itemsList) -KeyName "itemKey" -LabelBuilder {
    param($item)
    "{0}  •  {1}" -f $item.itemName, $item.locationLabel
  }
}

function Refresh-RawJsonEditors {
  if (-not $script:DbWorkingPlayer) { return }
  $script:DbAccountJsonTextBox.Text = ConvertTo-PrettyJson $script:DbWorkingPlayer.account
  $script:DbCharacterJsonTextBox.Text = ConvertTo-PrettyJson $script:DbWorkingPlayer.character
  $script:DbSkillsJsonTextBox.Text = ConvertTo-PrettyJson (Convert-SkillListToMap -SkillList @($script:DbWorkingPlayer.skillsList))
  $script:DbItemsJsonTextBox.Text = ConvertTo-PrettyJson (Convert-ItemListToMap -ItemList @($script:DbWorkingPlayer.itemsList))
  $script:DbRawJsonDirty = $false
}

function Sync-OverviewControlsToWorkingCopy {
  if (-not $script:DbWorkingPlayer) { return }
  $accountName = $script:DbAccountNameTextBox.Text.Trim()
  $characterName = $script:DbCharacterNameTextBox.Text.Trim()
  if ($accountName -eq "") { throw "Account name cannot be blank." }
  if ($characterName -eq "") { throw "Character name cannot be blank." }

  $script:DbWorkingPlayer.accountName = $accountName
  Set-ObjectProperty -Object $script:DbWorkingPlayer.account -Name "banned" -Value ([bool]$script:DbBannedCheckBox.IsChecked)
  Set-ObjectProperty -Object $script:DbWorkingPlayer.character -Name "characterName" -Value $characterName
  Set-ObjectProperty -Object $script:DbWorkingPlayer.character -Name "shipName" -Value $script:DbShipNameTextBox.Text.Trim()
  Set-ObjectProperty -Object $script:DbWorkingPlayer.character -Name "balance" -Value (Parse-NumericText -Text $script:DbBalanceTextBox.Text -Label "ISK balance")
  Set-ObjectProperty -Object $script:DbWorkingPlayer.character -Name "plexBalance" -Value (Parse-NumericText -Text $script:DbPlexTextBox.Text -Label "PLEX balance")
  Set-ObjectProperty -Object $script:DbWorkingPlayer.character -Name "aurBalance" -Value (Parse-NumericText -Text $script:DbAurTextBox.Text -Label "AUR balance")
  Set-ObjectProperty -Object $script:DbWorkingPlayer.character -Name "securityStatus" -Value (Parse-NumericText -Text $script:DbSecurityStatusTextBox.Text -Label "Security status")
  Set-ObjectProperty -Object $script:DbWorkingPlayer.character -Name "daysLeft" -Value (Parse-NumericText -Text $script:DbDaysLeftTextBox.Text -Label "Days left")
  Set-ObjectProperty -Object $script:DbWorkingPlayer.character -Name "description" -Value $script:DbDescriptionTextBox.Text

  Set-ObjectProperty -Object $script:DbWorkingPlayer.summary -Name "characterName" -Value $characterName
  Set-ObjectProperty -Object $script:DbWorkingPlayer.summary -Name "accountName" -Value $accountName
  Set-ObjectProperty -Object $script:DbWorkingPlayer.summary -Name "banned" -Value ([bool]$script:DbBannedCheckBox.IsChecked)
  Set-ObjectProperty -Object $script:DbWorkingPlayer.summary -Name "shipName" -Value $script:DbShipNameTextBox.Text.Trim()
  Set-ObjectProperty -Object $script:DbWorkingPlayer.summary -Name "balance" -Value $script:DbWorkingPlayer.character.balance
}

function Apply-RawJsonEditors {
  if (-not $script:DbWorkingPlayer) { return }
  $script:DbWorkingPlayer.account = Parse-JsonObjectText -Text $script:DbAccountJsonTextBox.Text -Label "Account JSON"
  $script:DbWorkingPlayer.character = Parse-JsonObjectText -Text $script:DbCharacterJsonTextBox.Text -Label "Character JSON"
  $skillsMap = Parse-JsonObjectText -Text $script:DbSkillsJsonTextBox.Text -Label "Skills JSON"
  $itemsMap = Parse-JsonObjectText -Text $script:DbItemsJsonTextBox.Text -Label "Items JSON"

  $script:DbWorkingPlayer.skillsList = @(
    $skillsMap.PSObject.Properties |
      ForEach-Object {
        $raw = ConvertTo-DeepClone $_.Value
        [pscustomobject]@{
          skillKey = [string]$_.Name
          itemName = if ($raw.itemName) { [string]$raw.itemName } else { "Skill $($_.Name)" }
          skillLevel = if ($null -ne $raw.skillLevel) { $raw.skillLevel } else { 0 }
          raw = $raw
        }
      } |
      Sort-Object itemName, skillKey
  )

  $script:DbWorkingPlayer.itemsList = @(
    $itemsMap.PSObject.Properties |
      ForEach-Object {
        $raw = ConvertTo-DeepClone $_.Value
        [pscustomobject]@{
          itemKey = [string]$_.Name
          itemName = if ($raw.itemName) { [string]$raw.itemName } else { "Item $($_.Name)" }
          locationLabel = if ($null -ne $raw.locationID) { "Location $($raw.locationID)" } else { "Unknown location" }
          raw = $raw
        }
      } |
      Sort-Object itemName, itemKey
  )

  Set-ObjectProperty -Object $script:DbWorkingPlayer.summary -Name "skillCount" -Value $script:DbWorkingPlayer.skillsList.Count
  Set-ObjectProperty -Object $script:DbWorkingPlayer.summary -Name "itemCount" -Value $script:DbWorkingPlayer.itemsList.Count
  $script:DbRawJsonDirty = $false
}

function Render-DatabasePlayer {
  if (-not $script:DbWorkingPlayer) { return }
  $script:IsRenderingDatabase = $true
  try {
    Update-DatabaseSummary
    Render-OverviewFields
    Refresh-RawJsonEditors
  } finally {
    $script:IsRenderingDatabase = $false
  }
}

function Update-PlayerListDisplay {
  $searchText = $script:DbSearchBox.Text.Trim().ToLowerInvariant()
  $players = @($script:DatabaseSnapshot.players)
  if ($searchText -ne "") {
    $players = @($players | Where-Object { [string]$_.searchText -like "*$searchText*" })
  }

  $displayItems = @(
    foreach ($player in $players) {
      [pscustomobject]@{
        key = [string]$player.characterId
        label = "{0}  •  {1}" -f $player.characterName, $player.accountName
      }
    }
  )

  $script:DbPlayerList.DisplayMemberPath = "label"
  $script:DbPlayerList.SelectedValuePath = "key"
  $script:DbPlayerList.ItemsSource = $displayItems
  if ($displayItems.Count -gt 0) {
    $selectedId = if ($script:DatabaseSnapshot.selectedCharacterId) { $script:DatabaseSnapshot.selectedCharacterId } else { $displayItems[0].key }
    $script:SuppressPlayerSelection = $true
    $script:DbPlayerList.SelectedValue = $selectedId
    $script:SuppressPlayerSelection = $false
  }
}

function Render-DatabaseSnapshot {
  param([Parameter(Mandatory = $true)][pscustomobject]$Snapshot, [string]$ReadyMessage = "Player database loaded and ready.")
  $script:IsRenderingDatabase = $true
  try {
    $script:DatabaseSnapshot = $Snapshot
    $script:DbPathText.Text = "SQLite player database: $($Snapshot.paths.databasePath)"
    $script:DbCountsText.Text = "$($Snapshot.playerCount) characters loaded"
    Update-PlayerListDisplay
    if ($Snapshot.selectedPlayer) {
      $script:DbWorkingPlayer = New-DatabaseWorkingCopy -SelectedPlayer $Snapshot.selectedPlayer
      Render-DatabasePlayer
    }
    Set-DatabaseDirtyState -Dirty $false -Message $ReadyMessage
  } finally {
    $script:IsRenderingDatabase = $false
  }
}

function Reload-DatabaseSnapshot {
  param([string]$CharacterId = "")
  $snapshot = if ($CharacterId) { Invoke-ProjectCli -Command "database-export" -Arguments @($CharacterId) } else { Invoke-ProjectCli -Command "database-export" }
  Render-DatabaseSnapshot -Snapshot $snapshot
}

function Save-DatabasePlayer {
  if (-not $script:DbWorkingPlayer) { return }
  $decision = [System.Windows.MessageBox]::Show(
    "EvEJS caches player records while the server is running. Stop the server before saving, or it can overwrite these SQLite changes. Continue only if the server is stopped.",
    "Save Live SQLite Player Data",
    [System.Windows.MessageBoxButton]::YesNo,
    [System.Windows.MessageBoxImage]::Warning
  )
  if ($decision -ne [System.Windows.MessageBoxResult]::Yes) { return }
  Sync-OverviewControlsToWorkingCopy
  if ($script:DbRawJsonDirty) { Apply-RawJsonEditors }
  $payload = @{
    characterId = $script:DbWorkingPlayer.characterId
    originalAccountKey = $script:DbWorkingPlayer.originalAccountKey
    accountName = $script:DbWorkingPlayer.accountName
    account = $script:DbWorkingPlayer.account
    character = $script:DbWorkingPlayer.character
    skills = Convert-SkillListToMap -SkillList @($script:DbWorkingPlayer.skillsList)
    items = Convert-ItemListToMap -ItemList @($script:DbWorkingPlayer.itemsList)
  }
  $snapshot = Invoke-ProjectCli -Command "database-save" -InputObject $payload
  $backupPath = if ($snapshot.PSObject.Properties["backupPath"]) { [string]$snapshot.backupPath } else { "" }
  $saveMessage = "Saved directly to gamestore.sqlite. Restart EvEJS before using the updated player data."
  if ($backupPath) { $saveMessage += " Backup: $backupPath" }
  Render-DatabaseSnapshot -Snapshot $snapshot -ReadyMessage $saveMessage
  Set-StatusUi -Message $saveMessage -Tone "success" -BadgeText "SQLite saved"
}

function Get-TextBoxNumericValue {
  param(
    [Parameter(Mandatory = $true)][System.Windows.Controls.TextBox]$TextBox,
    [double]$Fallback = 0,
    [string]$Label = "value"
  )

  $text = $TextBox.Text.Trim()
  if ($text -eq "") { return $Fallback }
  return Parse-NumericText -Text $text -Label $Label
}

function Invoke-NodeScript {
  param([Parameter(Mandatory = $true)][string]$ScriptPath)

  # Temporarily suppress $ErrorActionPreference = "Stop" so that native-command
  # stderr output does not raise a NativeCommandError before we can inspect
  # $LASTEXITCODE ourselves.
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & node $ScriptPath 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prevEap
  }

  if ($exitCode -ne 0) {
    $errText = ($output | ForEach-Object { "$_" }) -join "`n"
    throw "node $([System.IO.Path]::GetFileName($ScriptPath)) failed (exit $exitCode):`n$errText"
  }
}

function Invoke-AssetExtraction {
  $clientIconIndex = Join-Path $PSScriptRoot "assets\eve-icon-index.json"
  $uiIconIndex = Join-Path $PSScriptRoot "assets\ui-icon-index.json"

  $needsClient = -not (Test-Path $clientIconIndex)
  $needsUi = -not (Test-Path $uiIconIndex)
  if (-not $needsClient -and -not $needsUi) { return }

  $eveClientPath = $env:EVEJS_CLIENT_PATH
  if (-not $eveClientPath) {
    Write-Host "Skipping asset extraction: EVEJS_CLIENT_PATH is not set (run via OpenServerConfig.bat)."
    return
  }
  $resIndexPath = Join-Path $eveClientPath "resfileindex.txt"
  if (-not (Test-Path $resIndexPath)) {
    Write-Host "Skipping asset extraction: EVE client not found at $eveClientPath"
    return
  }

  Write-Host "Extracting assets from EVE client (first run)..."

  if ($needsClient) {
    Write-Host "  Extracting item/ship icons..."
    Invoke-NodeScript -ScriptPath (Join-Path $PSScriptRoot "extract-client-icons.js")
  }

  if ($needsUi) {
    Write-Host "  Extracting UI icons..."
    Invoke-NodeScript -ScriptPath (Join-Path $PSScriptRoot "extract-ui-icons.js")
  }

  Write-Host "  Asset extraction complete."
}

function Initialize-AppChrome {
  $script:Window.Title = "EvEJS Control Center"
  $script:FooterHintText.Text = "Player tools write only to gamestore.sqlite. Stop the server before saving and restart it afterward."
  $script:ThemeToggleButton.FontFamily = [System.Windows.Media.FontFamily]::new("Segoe UI Symbol")
  Update-ThemeToggleButton

  $buttonMap = @(
    @{ Button = $script:SettingsOpenFileButton; Text = "Open File"; Glyph = 0xE8A5; IconKey = "open_window" },
    @{ Button = $script:SettingsDefaultsButton; Text = "Load Defaults"; Glyph = 0xE777; IconKey = "randomize" },
    @{ Button = $script:SettingsReloadButton; Text = "Reload"; Glyph = 0xE72C; IconKey = "refresh" },
    @{ Button = $script:SettingsSaveButton; Text = "Save Changes"; Glyph = 0xE74E; IconKey = "save" },
    @{ Button = $script:DbOpenFolderButton; Text = "Open Database Folder"; Glyph = 0xE838; IconKey = "folder" },
    @{ Button = $script:DbReloadButton; Text = "Reload"; Glyph = 0xE72C; IconKey = "refresh" },
    @{ Button = $script:DbSkillStudioButton; Text = "Skill Studio"; Glyph = 0xE943; IconKey = "skillbook" },
    @{ Button = $script:DbSaveButton; Text = "Save Player Changes"; Glyph = 0xE74E; IconKey = "save" },
    @{ Button = $script:DbSkillStudioOverviewButton; Text = "Open Skill Studio"; Glyph = 0xE943; IconKey = "skillbook" },
    @{ Button = $script:DbGrantIskButton; Text = "+10M ISK"; Glyph = 0xEC1F; IconKey = "isk" },
    @{ Button = $script:DbAddGameTimeButton; Text = "+30 Days"; Glyph = 0xE823; IconKey = "time" },
    @{ Button = $script:DbMaxSecurityButton; Text = "Security 5.0"; Glyph = 0xE7BA; IconKey = "security" },
    @{ Button = $script:DbClearBanButton; Text = "Clear Ban"; Glyph = 0xE8FB; IconKey = "checkmark" },
    @{ Button = $script:DbMaxOwnedSkillsButton; Text = "Owned Skills V"; Glyph = 0xE76B; IconKey = "skillbook" },
    @{ Button = $script:DbAddShipButton; Text = "Add Ship"; Glyph = 0xE710; IconKey = "add" },
    @{ Button = $script:DbAddItemButton; Text = "Add Item"; Glyph = 0xE8FD; IconKey = "cargo" },
    @{ Button = $script:DbEditItemButton; Text = "Edit Selection"; Glyph = 0xE70F; IconKey = "edit" },
    @{ Button = $script:DbRemoveItemButton; Text = "Remove Selection"; Glyph = 0xE74D; IconKey = "delete" },
    @{ Button = $script:DbOpenRawButton; Text = "Raw JSON View"; Glyph = 0xE943; IconKey = "details" },
    @{ Button = $script:DbRefreshJsonButton; Text = "Refresh From Working Copy"; Glyph = 0xE72C; IconKey = "refresh" },
    @{ Button = $script:DbApplyJsonButton; Text = "Apply Raw JSON"; Glyph = 0xE70B; IconKey = "checkmark" }
  )

  foreach ($item in $buttonMap) {
    if ($item.Button) {
      Set-ButtonChrome -Button $item.Button -Text $item.Text -GlyphCode $item.Glyph -IconKey $item.IconKey
    }
  }

  $itemContainerStyle = [System.Windows.Markup.XamlReader]::Parse(@'
<Style xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
       xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
       TargetType="{x:Type ListBoxItem}">
  <Setter Property="Padding" Value="0" />
  <Setter Property="Margin" Value="0,0,0,10" />
  <Setter Property="HorizontalContentAlignment" Value="Stretch" />
  <Setter Property="Template">
    <Setter.Value>
      <ControlTemplate TargetType="{x:Type ListBoxItem}">
        <Border x:Name="Card" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" CornerRadius="16">
          <ContentPresenter />
        </Border>
        <ControlTemplate.Triggers>
          <Trigger Property="IsMouseOver" Value="True">
            <Setter TargetName="Card" Property="Background" Value="{DynamicResource ListHoverBg}" />
            <Setter TargetName="Card" Property="BorderBrush" Value="{DynamicResource BorderSelSoft}" />
          </Trigger>
          <Trigger Property="IsSelected" Value="True">
            <Setter TargetName="Card" Property="Background" Value="{DynamicResource ListSelBg}" />
            <Setter TargetName="Card" Property="BorderBrush" Value="{DynamicResource BorderSel}" />
          </Trigger>
        </ControlTemplate.Triggers>
      </ControlTemplate>
    </Setter.Value>
  </Setter>
</Style>
'@)

  $playerTemplate = [System.Windows.Markup.XamlReader]::Parse(@'
<DataTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation">
  <Grid Margin="14,12">
    <Grid.RowDefinitions>
      <RowDefinition Height="Auto" />
      <RowDefinition Height="Auto" />
      <RowDefinition Height="Auto" />
    </Grid.RowDefinitions>
    <Grid.ColumnDefinitions>
      <ColumnDefinition Width="Auto" />
      <ColumnDefinition Width="12" />
      <ColumnDefinition Width="*" />
    </Grid.ColumnDefinitions>
    <Border Grid.RowSpan="3" Width="42" Height="42" CornerRadius="13" Background="{Binding iconBackground}" BorderBrush="{Binding iconBorder}" BorderThickness="1">
      <Grid>
        <TextBlock Text="{Binding iconGlyph}" FontFamily="Segoe MDL2 Assets" FontSize="18" Foreground="{Binding iconForeground}" HorizontalAlignment="Center" VerticalAlignment="Center" />
        <Image Source="{Binding iconFilePath}" Stretch="Uniform" Margin="4" />
      </Grid>
    </Border>
    <TextBlock Grid.Row="0" Grid.Column="2" Text="{Binding characterName}" FontSize="14" FontWeight="SemiBold" Foreground="{DynamicResource TextPrimary}" />
    <TextBlock Grid.Row="1" Grid.Column="2" Text="{Binding accountName}" Margin="0,5,0,0" FontSize="12" Foreground="{DynamicResource TextMuted}" />
    <Grid Grid.Row="2" Grid.Column="2" Margin="0,8,0,0">
      <Grid.ColumnDefinitions>
        <ColumnDefinition Width="*" />
        <ColumnDefinition Width="Auto" />
      </Grid.ColumnDefinitions>
      <TextBlock Grid.Column="0" Text="{Binding shipName}" FontSize="11" Foreground="{DynamicResource TextAccent}" />
      <TextBlock Grid.Column="1" Text="{Binding solarSystemName}" FontSize="11" Foreground="{DynamicResource TextMuted}" />
    </Grid>
  </Grid>
</DataTemplate>
'@)

  $skillTemplate = [System.Windows.Markup.XamlReader]::Parse(@'
<DataTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation">
  <Grid Margin="14,12">
    <Grid.ColumnDefinitions>
      <ColumnDefinition Width="Auto" />
      <ColumnDefinition Width="12" />
      <ColumnDefinition Width="*" />
      <ColumnDefinition Width="Auto" />
    </Grid.ColumnDefinitions>
    <Border Grid.Column="0" Width="40" Height="40" CornerRadius="12" Background="{Binding iconBackground}" BorderBrush="{Binding iconBorder}" BorderThickness="1">
      <Grid>
        <TextBlock Text="{Binding iconGlyph}" FontFamily="Segoe MDL2 Assets" FontSize="18" Foreground="{Binding iconForeground}" HorizontalAlignment="Center" VerticalAlignment="Center" />
        <Image Source="{Binding iconFilePath}" Stretch="Uniform" Margin="4" />
      </Grid>
    </Border>
    <StackPanel Grid.Column="2">
      <TextBlock Text="{Binding itemName}" FontSize="13" FontWeight="SemiBold" Foreground="{DynamicResource TextPrimary}" />
      <TextBlock Text="{Binding groupName}" Margin="0,4,0,0" FontSize="11" Foreground="{DynamicResource TextMuted}" />
      <TextBlock Text="{Binding skillPoints, StringFormat=SP {0:N0}}" Margin="0,6,0,0" FontSize="11" Foreground="{DynamicResource TextAccent}" />
    </StackPanel>
    <TextBlock Grid.Column="3" Text="{Binding skillLevel, StringFormat=Level {0}}" Margin="10,0,0,0" VerticalAlignment="Top" FontSize="11" FontWeight="SemiBold" Foreground="{DynamicResource TextAccent}" />
  </Grid>
</DataTemplate>
'@)

  $itemTemplate = [System.Windows.Markup.XamlReader]::Parse(@'
<DataTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation">
  <Grid Margin="14,12">
    <Grid.ColumnDefinitions><ColumnDefinition Width="Auto" /><ColumnDefinition Width="12" /><ColumnDefinition Width="*" /></Grid.ColumnDefinitions>
    <Border Grid.Column="0" Width="40" Height="40" CornerRadius="12" Background="{Binding iconBackground}" BorderBrush="{Binding iconBorder}" BorderThickness="1">
      <Grid>
        <TextBlock Text="{Binding iconGlyph}" FontFamily="Segoe MDL2 Assets" FontSize="18" Foreground="{Binding iconForeground}" HorizontalAlignment="Center" VerticalAlignment="Center" />
        <Image Source="{Binding iconFilePath}" Stretch="Uniform" Margin="4" />
      </Grid>
    </Border>
    <StackPanel Grid.Column="2">
      <TextBlock Text="{Binding itemName}" FontSize="13" FontWeight="SemiBold" Foreground="{DynamicResource TextPrimary}" />
      <TextBlock Text="{Binding metaText}" Margin="0,4,0,0" FontSize="11" Foreground="{DynamicResource TextAccent}" />
      <TextBlock Text="{Binding locationLabel}" Margin="0,5,0,0" FontSize="11" Foreground="{DynamicResource TextMuted}" TextWrapping="Wrap" />
    </StackPanel>
  </Grid>
</DataTemplate>
'@)

  foreach ($listBox in @($script:DbPlayerList, $script:DbSkillPreviewList, $script:DbItemPreviewList)) {
    $listBox.BorderThickness = [System.Windows.Thickness]::new(0)
    $listBox.Background = $script:Brushes.White
    $listBox.ItemContainerStyle = $itemContainerStyle
    $listBox.SetValue([System.Windows.Controls.ScrollViewer]::HorizontalScrollBarVisibilityProperty, [System.Windows.Controls.ScrollBarVisibility]::Disabled)
  }

  $script:DbPlayerList.ItemTemplate = $playerTemplate
  $script:DbSkillPreviewList.ItemTemplate = $skillTemplate
  $script:DbItemPreviewList.ItemTemplate = $itemTemplate

  if ($script:MarketOrdersList) {
    $script:MarketOrdersList.ItemContainerStyle = $itemContainerStyle
    $script:MarketOrdersList.SetValue([System.Windows.Controls.ScrollViewer]::HorizontalScrollBarVisibilityProperty, [System.Windows.Controls.ScrollBarVisibility]::Disabled)
    $script:MarketOrdersList.ItemTemplate = [System.Windows.Markup.XamlReader]::Parse(@'
<DataTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation">
  <Grid Margin="14,10">
    <Grid.ColumnDefinitions>
      <ColumnDefinition Width="Auto" />
      <ColumnDefinition Width="14" />
      <ColumnDefinition Width="*" />
      <ColumnDefinition Width="Auto" />
    </Grid.ColumnDefinitions>
    <Border Grid.Column="0" CornerRadius="8" Padding="10,4,10,4" VerticalAlignment="Center" Background="{Binding sideBg}">
      <TextBlock Text="{Binding sideLabel}" FontSize="11" FontWeight="SemiBold" Foreground="{Binding sideFg}" />
    </Border>
    <StackPanel Grid.Column="2">
      <TextBlock Text="{Binding typeName}" FontSize="14" FontWeight="SemiBold" Foreground="{DynamicResource TextPrimary}" />
      <TextBlock Text="{Binding locationText}" Margin="0,3,0,0" FontSize="11" Foreground="{DynamicResource TextMuted}" TextWrapping="Wrap" />
      <TextBlock Text="{Binding metaText}" Margin="0,2,0,0" FontSize="11" Foreground="{DynamicResource TextAccent}" />
    </StackPanel>
    <StackPanel Grid.Column="3" VerticalAlignment="Center" HorizontalAlignment="Right">
      <TextBlock Text="{Binding priceText}" FontSize="14" FontWeight="SemiBold" HorizontalAlignment="Right" Foreground="{DynamicResource TextPrimary}" />
      <TextBlock Text="{Binding qtyText}" Margin="0,3,0,0" FontSize="11" HorizontalAlignment="Right" Foreground="{DynamicResource TextMuted}" />
    </StackPanel>
  </Grid>
</DataTemplate>
'@)
  }
}

function Initialize-Market {
  if (-not $script:MarketOwnerCombo) { return }
  $players = @()
  if ($script:DatabaseSnapshot) {
    foreach ($player in @($script:DatabaseSnapshot.players)) {
      $characterId = [string]$player.characterId
      if (-not $characterId) { continue }
      $label = "{0}  ({1})" -f ([string]$player.characterName), $characterId
      $players += [pscustomobject]@{ label = $label; value = $characterId }
    }
  }
  $script:MarketOwnerCombo.DisplayMemberPath = "label"
  $script:MarketOwnerCombo.SelectedValuePath = "value"
  $script:MarketOwnerCombo.ItemsSource = $players
  if ($script:MarketBookTypeCombo) {
    $script:MarketBookTypeCombo.DisplayMemberPath = "label"
    $script:MarketBookTypeCombo.SelectedValuePath = "typeID"
  }
  if (@($players).Count -gt 0) {
    $selectedCharacterId = if ($script:DatabaseSnapshot) { [string]$script:DatabaseSnapshot.selectedCharacterId } else { "" }
    if ($selectedCharacterId) { $script:MarketOwnerCombo.SelectedValue = $selectedCharacterId }
    if (-not $script:MarketOwnerCombo.SelectedItem) { $script:MarketOwnerCombo.SelectedIndex = 0 }
  }
  Refresh-MarketStatus | Out-Null
}

function Open-SkillStudio {
  if (-not $script:DbWorkingPlayer) { return }

  if ($script:DbRawJsonDirty) {
    $decision = [System.Windows.MessageBox]::Show(
      "Raw JSON changes are still pending. Click Yes to apply them first, No to discard those raw JSON edits, or Cancel to stay here.",
      "EvEJS Skill Studio",
      [System.Windows.MessageBoxButton]::YesNoCancel,
      [System.Windows.MessageBoxImage]::Question
    )
    if ($decision -eq [System.Windows.MessageBoxResult]::Cancel) { return }
    if ($decision -eq [System.Windows.MessageBoxResult]::Yes) {
      Apply-RawJsonEditors
      Render-DatabasePlayer
    } else {
      $script:IsRenderingDatabase = $true
      try { Refresh-RawJsonEditors } finally { $script:IsRenderingDatabase = $false }
    }
  }

  Sync-OverviewControlsToWorkingCopy
  $catalog = New-DatabaseSkillCatalog
  if (@($catalog).Count -eq 0) { return }

  $catalogByKey = @{}
  foreach ($entry in @($catalog)) { $catalogByKey[[string]$entry.skillKey] = ConvertTo-DeepClone $entry }
  $originalSkillStore = @{}
  foreach ($skill in @($script:DbWorkingPlayer.skillsList)) { $originalSkillStore[[string]$skill.skillKey] = ConvertTo-DeepClone $skill.raw }
  $skillStore = @{}
  foreach ($entry in $originalSkillStore.GetEnumerator()) { $skillStore[[string]$entry.Key] = ConvertTo-DeepClone $entry.Value }

  [xml]$studioXaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Title="EvEJS Skill Studio" Width="1080" Height="740" MinWidth="980" MinHeight="660" WindowStartupLocation="CenterOwner" Background="{DynamicResource WindowBg}" FontFamily="Segoe UI">
  <Grid Margin="18">
    <Grid.RowDefinitions><RowDefinition Height="Auto" /><RowDefinition Height="*" /><RowDefinition Height="Auto" /></Grid.RowDefinitions>
    <Border Grid.Row="0" CornerRadius="16" Padding="24" Margin="0,0,0,16" Background="{DynamicResource HeroBg}" BorderBrush="{DynamicResource BorderSel}" BorderThickness="1"><StackPanel><TextBlock Text="Skill Studio" FontSize="28" FontWeight="SemiBold" Foreground="{DynamicResource TextPrimary}" /><TextBlock Text="Search every known skill, set clean levels instantly, and stage changes before saving the player database." Margin="0,8,0,0" FontSize="13" Foreground="{DynamicResource TextSecondary}" TextWrapping="Wrap" /></StackPanel></Border>
    <Grid Grid.Row="1"><Grid.ColumnDefinitions><ColumnDefinition Width="360" /><ColumnDefinition Width="14" /><ColumnDefinition Width="*" /></Grid.ColumnDefinitions>
      <Border Grid.Column="0" CornerRadius="20" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" Padding="16"><DockPanel LastChildFill="True"><StackPanel DockPanel.Dock="Top"><TextBlock Text="Skill Catalog" FontSize="18" FontWeight="SemiBold" Foreground="{DynamicResource TextPrimary}" /><TextBlock Text="Search by skill or group. Untrained skills can be added instantly." Margin="0,6,0,12" FontSize="12" Foreground="{DynamicResource TextMuted}" TextWrapping="Wrap" /><TextBox x:Name="StudioSearchBox" Height="38" Margin="0,0,0,10" Padding="10,6,10,6" BorderBrush="{DynamicResource BorderStrong}" BorderThickness="1" Background="{DynamicResource PanelInput}" Foreground="{DynamicResource TextPrimary}" /><ComboBox x:Name="StudioGroupCombo" Height="38" Margin="0,0,0,12" Padding="8,4,8,4" BorderBrush="{DynamicResource BorderStrong}" BorderThickness="1" Background="{DynamicResource PanelInput}" Foreground="{DynamicResource TextPrimary}" /><WrapPanel Margin="0,0,0,12"><Button x:Name="StudioFilteredIIIButton" Content="Filtered to III" Margin="0,0,8,8" Padding="12,8,12,8" /><Button x:Name="StudioFilteredVButton" Content="Filtered to V" Margin="0,0,8,8" Padding="12,8,12,8" /></WrapPanel></StackPanel><ListBox x:Name="StudioSkillList" BorderThickness="0" Background="Transparent" /></DockPanel></Border>
      <Border Grid.Column="2" CornerRadius="20" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" Padding="20"><Grid><Grid.RowDefinitions><RowDefinition Height="Auto" /><RowDefinition Height="Auto" /><RowDefinition Height="Auto" /><RowDefinition Height="Auto" /><RowDefinition Height="*" /></Grid.RowDefinitions><TextBlock x:Name="StudioSkillHeadline" Text="Pick a skill" FontSize="24" FontWeight="SemiBold" Foreground="{DynamicResource TextPrimary}" /><TextBlock x:Name="StudioSkillMeta" Grid.Row="1" Margin="0,8,0,0" FontSize="13" Foreground="{DynamicResource TextMuted}" TextWrapping="Wrap" /><WrapPanel x:Name="StudioBadgePanel" Grid.Row="2" Margin="0,14,0,0" /><Grid Grid.Row="3" Margin="0,16,0,0"><Grid.ColumnDefinitions><ColumnDefinition Width="*" /><ColumnDefinition Width="*" /><ColumnDefinition Width="*" /></Grid.ColumnDefinitions><StackPanel Grid.Column="0" Margin="0,0,10,0"><TextBlock Text="Level" FontSize="12" FontWeight="SemiBold" Foreground="{DynamicResource TextMuted}" Margin="0,0,0,6" /><TextBox x:Name="StudioLevelTextBox" Height="38" Padding="10,6,10,6" BorderBrush="{DynamicResource BorderStrong}" BorderThickness="1" Background="{DynamicResource PanelInput}" Foreground="{DynamicResource TextPrimary}" /></StackPanel><StackPanel Grid.Column="1" Margin="10,0,10,0"><TextBlock Text="Skill Points" FontSize="12" FontWeight="SemiBold" Foreground="{DynamicResource TextMuted}" Margin="0,0,0,6" /><TextBox x:Name="StudioSkillPointsTextBox" Height="38" Padding="10,6,10,6" BorderBrush="{DynamicResource BorderStrong}" BorderThickness="1" Background="{DynamicResource PanelInput}" Foreground="{DynamicResource TextPrimary}" /></StackPanel><StackPanel Grid.Column="2" Margin="10,0,0,0"><TextBlock Text="Training" FontSize="12" FontWeight="SemiBold" Foreground="{DynamicResource TextMuted}" Margin="0,0,0,6" /><CheckBox x:Name="StudioTrainingCheckBox" Content="Currently training" FontSize="13" Foreground="{DynamicResource TextPrimary}" VerticalAlignment="Center" /></StackPanel></Grid><StackPanel Grid.Row="4" Margin="0,18,0,0"><TextBlock Text="Level Deck" FontSize="12" FontWeight="SemiBold" Foreground="{DynamicResource TextMuted}" Margin="0,0,0,8" /><WrapPanel><Button x:Name="StudioLevel0Button" Content="Level 0" Margin="0,0,8,8" Padding="12,8,12,8" /><Button x:Name="StudioLevel1Button" Content="Level I" Margin="0,0,8,8" Padding="12,8,12,8" /><Button x:Name="StudioLevel2Button" Content="Level II" Margin="0,0,8,8" Padding="12,8,12,8" /><Button x:Name="StudioLevel3Button" Content="Level III" Margin="0,0,8,8" Padding="12,8,12,8" /><Button x:Name="StudioLevel4Button" Content="Level IV" Margin="0,0,8,8" Padding="12,8,12,8" /><Button x:Name="StudioLevel5Button" Content="Level V" Margin="0,0,8,8" Padding="12,8,12,8" /></WrapPanel><WrapPanel Margin="0,18,0,0"><Button x:Name="StudioApplyButton" Content="Apply to Selected Skill" Margin="0,0,8,8" Padding="14,10,14,10" /><Button x:Name="StudioResetButton" Content="Restore Original" Margin="0,0,8,8" Padding="14,10,14,10" /><Button x:Name="StudioRemoveButton" Content="Remove Skill" Margin="0,0,8,8" Padding="14,10,14,10" /></WrapPanel><TextBlock x:Name="StudioStatusText" Margin="0,12,0,0" FontSize="12" Foreground="{DynamicResource TextAccent}" TextWrapping="Wrap" /></StackPanel></Grid></Border>
    </Grid>
    <Border Grid.Row="2" Margin="0,16,0,0" CornerRadius="18" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" Padding="16"><DockPanel LastChildFill="False"><TextBlock x:Name="StudioFooterText" VerticalAlignment="Center" FontSize="12" Foreground="{DynamicResource TextMuted}" Text="Skill changes stay staged here until you click Apply To Player." /><StackPanel DockPanel.Dock="Right" Orientation="Horizontal"><Button x:Name="StudioCancelButton" Content="Cancel" Margin="0,0,10,0" Padding="14,10,14,10" /><Button x:Name="StudioSaveButton" Content="Apply To Player" Padding="16,10,16,10" /></StackPanel></DockPanel></Border>
  </Grid>
</Window>
'@

  $studioWindow = [System.Windows.Markup.XamlReader]::Load([System.Xml.XmlNodeReader]::new($studioXaml))
  $studioWindow.Owner = $script:Window
  $studioWindow.Add_SourceInitialized({ param($s, $e) Apply-WindowThemeChrome -Window $s })
  $studioSearchBox = $studioWindow.FindName("StudioSearchBox")
  $studioGroupCombo = $studioWindow.FindName("StudioGroupCombo")
  $studioSkillList = $studioWindow.FindName("StudioSkillList")
  $studioSkillHeadline = $studioWindow.FindName("StudioSkillHeadline")
  $studioSkillMeta = $studioWindow.FindName("StudioSkillMeta")
  $studioBadgePanel = $studioWindow.FindName("StudioBadgePanel")
  $studioLevelTextBox = $studioWindow.FindName("StudioLevelTextBox")
  $studioSkillPointsTextBox = $studioWindow.FindName("StudioSkillPointsTextBox")
  $studioTrainingCheckBox = $studioWindow.FindName("StudioTrainingCheckBox")
  $studioStatusText = $studioWindow.FindName("StudioStatusText")
  $studioFooterText = $studioWindow.FindName("StudioFooterText")
  $studioApplyButton = $studioWindow.FindName("StudioApplyButton")
  $studioResetButton = $studioWindow.FindName("StudioResetButton")
  $studioRemoveButton = $studioWindow.FindName("StudioRemoveButton")
  $studioFilteredIIIButton = $studioWindow.FindName("StudioFilteredIIIButton")
  $studioFilteredVButton = $studioWindow.FindName("StudioFilteredVButton")
  $studioCancelButton = $studioWindow.FindName("StudioCancelButton")
  $studioSaveButton = $studioWindow.FindName("StudioSaveButton")

  $studioSkillList.SelectedValuePath = "skillKey"
  $studioSkillList.SetValue([System.Windows.Controls.ScrollViewer]::HorizontalScrollBarVisibilityProperty, [System.Windows.Controls.ScrollBarVisibility]::Disabled)
  $studioGroupCombo.DisplayMemberPath = "label"
  $studioGroupCombo.SelectedValuePath = "value"
  $studioGroupCombo.ItemsSource = @([pscustomobject]@{ label = "All Groups"; value = "" }) + @($catalog | Where-Object { $_.groupName } | Select-Object -ExpandProperty groupName -Unique | Sort-Object | ForEach-Object { [pscustomobject]@{ label = $_; value = $_ } })
  $studioGroupCombo.SelectedIndex = 0
  $studioGroupCombo.Style = $script:Window.FindResource("ConfigComboBoxStyle")
  foreach ($button in @($studioApplyButton, $studioResetButton, $studioRemoveButton, $studioFilteredIIIButton, $studioFilteredVButton, $studioCancelButton, $studioSaveButton)) { $button.Style = $script:Window.FindResource("SecondaryButtonStyle") }
  $studioSaveButton.Style = $script:Window.FindResource("PrimaryButtonStyle")
  $studioSkillList.ItemContainerStyle = [System.Windows.Markup.XamlReader]::Parse(@'
<Style xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" TargetType="{x:Type ListBoxItem}">
  <Setter Property="Padding" Value="0" />
  <Setter Property="Margin" Value="0,0,0,10" />
  <Setter Property="HorizontalContentAlignment" Value="Stretch" />
  <Setter Property="Template"><Setter.Value><ControlTemplate TargetType="{x:Type ListBoxItem}"><Border x:Name="Card" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" CornerRadius="16"><ContentPresenter /></Border><ControlTemplate.Triggers><Trigger Property="IsMouseOver" Value="True"><Setter TargetName="Card" Property="Background" Value="{DynamicResource ListHoverBg}" /><Setter TargetName="Card" Property="BorderBrush" Value="{DynamicResource BorderSel}" /></Trigger><Trigger Property="IsSelected" Value="True"><Setter TargetName="Card" Property="Background" Value="{DynamicResource ListSelBg}" /><Setter TargetName="Card" Property="BorderBrush" Value="{DynamicResource Accent}" /></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter>
</Style>
'@)
  $studioSkillList.ItemTemplate = [System.Windows.Markup.XamlReader]::Parse(@'
<DataTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation">
  <Grid Margin="14,12">
    <Grid.ColumnDefinitions><ColumnDefinition Width="Auto" /><ColumnDefinition Width="12" /><ColumnDefinition Width="*" /><ColumnDefinition Width="Auto" /></Grid.ColumnDefinitions>
    <Border Grid.Column="0" Width="40" Height="40" CornerRadius="12" Background="{Binding iconBackground}" BorderBrush="{Binding iconBorder}" BorderThickness="1">
      <Grid>
        <TextBlock Text="{Binding iconGlyph}" FontFamily="Segoe MDL2 Assets" FontSize="18" Foreground="{Binding iconForeground}" HorizontalAlignment="Center" VerticalAlignment="Center" />
        <Image Source="{Binding iconFilePath}" Stretch="Uniform" Margin="4" />
      </Grid>
    </Border>
    <StackPanel Grid.Column="2">
      <TextBlock Text="{Binding itemName}" FontSize="13" FontWeight="SemiBold" Foreground="{DynamicResource TextPrimary}" />
      <TextBlock Text="{Binding groupName}" Margin="0,4,0,0" FontSize="11" Foreground="{DynamicResource TextMuted}" />
      <TextBlock Text="{Binding statusText}" Margin="0,6,0,0" FontSize="11" Foreground="{DynamicResource TextAccent}" />
    </StackPanel>
    <TextBlock Grid.Column="3" Text="{Binding currentLevel, StringFormat=Level {0}}" Margin="10,0,0,0" VerticalAlignment="Top" FontSize="11" FontWeight="SemiBold" Foreground="{DynamicResource TextAccent}" />
  </Grid>
</DataTemplate>
'@)
  Set-ButtonChrome -Button $studioFilteredIIIButton -Text "Filtered to III" -GlyphCode 0xE76B -IconKey "skillbook"
  Set-ButtonChrome -Button $studioFilteredVButton -Text "Filtered to V" -GlyphCode 0xE76B -IconKey "skillbook"
  Set-ButtonChrome -Button $studioApplyButton -Text "Apply to Selected Skill" -GlyphCode 0xE70B -IconKey "checkmark"
  Set-ButtonChrome -Button $studioResetButton -Text "Restore Original" -GlyphCode 0xE777 -IconKey "randomize"
  Set-ButtonChrome -Button $studioRemoveButton -Text "Remove Skill" -GlyphCode 0xE74D -IconKey "delete"
  Set-ButtonChrome -Button $studioCancelButton -Text "Cancel" -GlyphCode 0xE711 -IconKey "close"
  Set-ButtonChrome -Button $studioSaveButton -Text "Apply To Player" -GlyphCode 0xE74E -IconKey "save"

  $selectedSkillKey = ""
  $refreshSkillList = {
    $search = $studioSearchBox.Text.Trim().ToLowerInvariant()
    $group = [string]$studioGroupCombo.SelectedValue
    $items = @($catalog | Where-Object { (-not $group -or $_.groupName -eq $group) -and (-not $search -or (("{0} {1}" -f $_.itemName, $_.groupName).ToLowerInvariant() -like "*$search*")) } | ForEach-Object {
      $raw = if ($skillStore.ContainsKey([string]$_.skillKey)) { $skillStore[[string]$_.skillKey] } else { $null }
      Add-TypeIconFields -Object ([pscustomobject]@{
        skillKey = [string]$_.skillKey
        typeID = $_.typeID
        itemName = $_.itemName
        groupName = if ($_.groupName) { $_.groupName } else { "Ungrouped" }
        currentLevel = if ($raw) { [int]$raw.skillLevel } else { 0 }
        statusText = if ($raw) { "Active | SP $('{0:N0}' -f [int64]$raw.skillPoints)" } else { "Not trained yet" }
      }) -IconSpec (Resolve-SkillIconSpec -GroupName $_.groupName -ItemName $_.itemName) -TypeId $_.typeID
    })
    $studioSkillList.ItemsSource = $items
    if ($items.Count -gt 0) {
      $resolved = if ($selectedSkillKey -and ($items | Where-Object { $_.skillKey -eq $selectedSkillKey })) { $selectedSkillKey } else { $items[0].skillKey }
      $studioSkillList.SelectedValue = $resolved
    }
    $studioFooterText.Text = "{0} skills in view | {1} currently trained on this player" -f $items.Count, @($skillStore.Keys).Count
  }

  $updateSelectedSkillPanel = {
    $selectedSkillKey = [string]$studioSkillList.SelectedValue
    if (-not $selectedSkillKey) { return }
    $catalogEntry = $catalogByKey[$selectedSkillKey]
    $raw = if ($skillStore.ContainsKey($selectedSkillKey)) { $skillStore[$selectedSkillKey] } else { $null }
    $level = if ($raw) { [int]$raw.skillLevel } else { 0 }
    $points = if ($raw) { [int64]$raw.skillPoints } else { Get-SkillPointsForLevel -Rank $catalogEntry.skillRank -Level $level }
    $groupLabel = if ($catalogEntry.groupName) { [string]$catalogEntry.groupName } else { "Ungrouped" }
    $ownedLabel = if ($raw) { "Yes" } else { "No" }
    $studioSkillHeadline.Text = [string]$catalogEntry.itemName
    $studioSkillMeta.Text = "{0} | Rank {1} | Type {2}" -f $groupLabel, $catalogEntry.skillRank, $catalogEntry.typeID
    $studioLevelTextBox.Text = [string]$level
    $studioSkillPointsTextBox.Text = [string]$points
    $studioTrainingCheckBox.IsChecked = if ($raw) { [bool]$raw.inTraining } else { $false }
    $studioBadgePanel.Children.Clear()
    $skillIcon = Resolve-SkillIconSpec -GroupName $catalogEntry.groupName -ItemName $catalogEntry.itemName
    $studioBadgePanel.Children.Add((New-Badge -Text ("Owned {0}" -f $ownedLabel) -Background (Get-ThemeHex 'BadgeBlueBg') -Foreground (Get-ThemeHex 'BadgeBlueFg') -Glyph $skillIcon.glyph)) | Out-Null
    $studioBadgePanel.Children.Add((New-Badge -Text ("Recommended V SP {0:N0}" -f (Get-SkillPointsForLevel -Rank $catalogEntry.skillRank -Level 5)) -Background (Get-ThemeHex 'BadgeGreenBg') -Foreground (Get-ThemeHex 'BadgeGreenFg') -Glyph ([string][char]0xE76B))) | Out-Null
  }

  $applySelectedSkill = {
    $selectedSkillKey = [string]$studioSkillList.SelectedValue
    if (-not $selectedSkillKey) { return }
    $catalogEntry = $catalogByKey[$selectedSkillKey]
    $level = [int](Parse-NumericText -Text $studioLevelTextBox.Text -Label "Skill level")
    if ($level -lt 0 -or $level -gt 5) { throw "Skill level must be between 0 and 5." }
    $raw = if ($skillStore.ContainsKey($selectedSkillKey)) { ConvertTo-DeepClone $skillStore[$selectedSkillKey] } else { New-SkillRawFromCatalog -CatalogEntry $catalogEntry -CharacterId $script:DbWorkingPlayer.characterId -Level $level }
    $points = Get-TextBoxNumericValue -TextBox $studioSkillPointsTextBox -Fallback (Get-SkillPointsForLevel -Rank $catalogEntry.skillRank -Level $level) -Label "Skill points"
    foreach ($pair in @{ typeID = $catalogEntry.typeID; groupID = $catalogEntry.groupID; groupName = $catalogEntry.groupName; itemName = $catalogEntry.itemName; skillRank = $catalogEntry.skillRank; skillLevel = $level; trainedSkillLevel = $level; effectiveSkillLevel = $level; skillPoints = $points; trainedSkillPoints = $points; trainingStartSP = $points; trainingDestinationSP = $points; inTraining = [bool]$studioTrainingCheckBox.IsChecked }.GetEnumerator()) { Set-ObjectProperty -Object $raw -Name $pair.Key -Value $pair.Value }
    $skillStore[$selectedSkillKey] = $raw
    $studioStatusText.Text = "{0} staged at level {1}." -f $catalogEntry.itemName, $level
    & $refreshSkillList
    & $updateSelectedSkillPanel
  }

  $studioSearchBox.Add_TextChanged({ & $refreshSkillList })
  $studioGroupCombo.Add_SelectionChanged({ & $refreshSkillList })
  $studioSkillList.Add_SelectionChanged({ & $updateSelectedSkillPanel })
  $studioFilteredIIIButton.Add_Click({ foreach ($entry in @($studioSkillList.ItemsSource)) { $skillStore[[string]$entry.skillKey] = New-SkillRawFromCatalog -CatalogEntry $catalogByKey[[string]$entry.skillKey] -CharacterId $script:DbWorkingPlayer.characterId -Level 3 }; $studioStatusText.Text = "Applied level III to every skill in the current filtered list."; & $refreshSkillList; & $updateSelectedSkillPanel })
  $studioFilteredVButton.Add_Click({ foreach ($entry in @($studioSkillList.ItemsSource)) { $skillStore[[string]$entry.skillKey] = New-SkillRawFromCatalog -CatalogEntry $catalogByKey[[string]$entry.skillKey] -CharacterId $script:DbWorkingPlayer.characterId -Level 5 }; $studioStatusText.Text = "Applied level V to every skill in the current filtered list."; & $refreshSkillList; & $updateSelectedSkillPanel })
  $studioApplyButton.Add_Click({ try { & $applySelectedSkill } catch { [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Skill Studio", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null } })
  $studioResetButton.Add_Click({ $selectedSkillKey = [string]$studioSkillList.SelectedValue; if ($selectedSkillKey) { if ($originalSkillStore.ContainsKey($selectedSkillKey)) { $skillStore[$selectedSkillKey] = ConvertTo-DeepClone $originalSkillStore[$selectedSkillKey] } elseif ($skillStore.ContainsKey($selectedSkillKey)) { $null = $skillStore.Remove($selectedSkillKey) }; $studioStatusText.Text = "Restored the original skill values."; & $refreshSkillList; & $updateSelectedSkillPanel } })
  $studioRemoveButton.Add_Click({ $selectedSkillKey = [string]$studioSkillList.SelectedValue; if ($selectedSkillKey -and $skillStore.ContainsKey($selectedSkillKey)) { $null = $skillStore.Remove($selectedSkillKey); $studioStatusText.Text = "Removed the selected skill from the staged player."; & $refreshSkillList; & $updateSelectedSkillPanel } })
  foreach ($levelButton in 0..5) {
    $button = $studioWindow.FindName("StudioLevel{0}Button" -f $levelButton)
    $button.Style = $script:Window.FindResource("SecondaryButtonStyle")
    Set-ButtonChrome -Button $button -Text ("Level {0}" -f $(if ($levelButton -eq 0) { "0" } elseif ($levelButton -eq 1) { "I" } elseif ($levelButton -eq 2) { "II" } elseif ($levelButton -eq 3) { "III" } elseif ($levelButton -eq 4) { "IV" } else { "V" })) -GlyphCode 0xE76B -IconKey "skillbook" -IconSize 14
    $capturedLevel = $levelButton
    $button.Add_Click({
      $selectedSkillKey = [string]$studioSkillList.SelectedValue
      if ($selectedSkillKey) {
        $studioLevelTextBox.Text = [string]$capturedLevel
        $studioSkillPointsTextBox.Text = [string](Get-SkillPointsForLevel -Rank $catalogByKey[$selectedSkillKey].skillRank -Level $capturedLevel)
        & $applySelectedSkill
      }
    }.GetNewClosure())
  }
  $studioCancelButton.Add_Click({ $studioWindow.Close() })
  $studioSaveButton.Add_Click({
    if ($studioSkillList.SelectedValue -and $studioLevelTextBox.Text.Trim() -ne "") {
      try { & $applySelectedSkill } catch { [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Skill Studio", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null; return }
    }
    $script:DbWorkingPlayer.skillsList = @(Convert-SkillStoreToList -SkillStore $skillStore -CatalogByKey $catalogByKey)
    Update-WorkingPlayerDerivedData
    Render-DatabasePlayer
    Set-DatabaseDirtyState -Dirty $true -Message "Skill Studio changes are staged in the working copy."
    $studioWindow.DialogResult = $true
    $studioWindow.Close()
  })

  & $refreshSkillList
  & $updateSelectedSkillPanel
  $null = $studioWindow.ShowDialog()
}

function Update-DatabaseSummary {
  if (-not $script:DbWorkingPlayer) { return }
  Update-WorkingPlayerDerivedData
  $summary = $script:DbWorkingPlayer.summary
  $script:DbPlayerHeadline.Text = "$($summary.characterName)  |  $($script:DbWorkingPlayer.accountName)"
  $script:DbPlayerMeta.Text = "$($summary.shipName) | $($summary.stationName) | $($summary.solarSystemName) | $($summary.corporationName)"
  $warnings = @($script:DbWorkingPlayer.warningMessages)
  $script:DbWarningText.Text = ($warnings -join " ")
  $script:DbWarningText.Visibility = if ($warnings.Count -gt 0) { [System.Windows.Visibility]::Visible } else { [System.Windows.Visibility]::Collapsed }
  $iskIcon = Resolve-WalletIconSpec -CurrencyKey "isk"
  $plexIcon = Resolve-WalletIconSpec -CurrencyKey "plex"
  $aurIcon = Resolve-WalletIconSpec -CurrencyKey "aur"
  $skillIcon = Resolve-SkillIconSpec -GroupName "Spaceship Command"
  $itemIcon = Resolve-ItemIconSpec -GroupName "" -CategoryID 4 -ItemName "Inventory"
  $shipIcon = Resolve-ShipIconSpec -GroupName "" -ShipName $summary.shipName
  $walletBadgeIconPath = Resolve-UiIconPath -Key "wallet"
  $iskBadgeIconPath = Resolve-UiIconPath -Key "isk"
  $plexBadgeIconPath = Resolve-UiIconPath -Key "plex"
  $aurBadgeIconPath = Resolve-UiIconPath -Key "aur"
  $skillBadgeIconPath = Resolve-UiIconPath -Key "skillbook"
  $itemBadgeIconPath = Resolve-UiIconPath -Key "cargo"
  $iskMetricIconPath = $iskBadgeIconPath
  if ([string]::IsNullOrWhiteSpace($iskMetricIconPath)) {
    $iskMetricIconPath = $walletBadgeIconPath
  }
  $script:DbMetricPanel.Children.Clear()
  $script:DbMetricPanel.Children.Add((New-Badge -Text ("ISK {0}" -f (Format-CompactNumber $summary.balance)) -Background $iskIcon.background -Foreground $iskIcon.foreground -Glyph $iskIcon.glyph -ImagePath $iskMetricIconPath -ImageSize 16)) | Out-Null
  $script:DbMetricPanel.Children.Add((New-Badge -Text ("PLEX {0}" -f (Format-CompactNumber $script:DbWorkingPlayer.character.plexBalance)) -Background $plexIcon.background -Foreground $plexIcon.foreground -Glyph $plexIcon.glyph -ImagePath $plexBadgeIconPath -ImageSize 16)) | Out-Null
  $script:DbMetricPanel.Children.Add((New-Badge -Text ("AUR {0}" -f (Format-CompactNumber $script:DbWorkingPlayer.character.aurBalance)) -Background $aurIcon.background -Foreground $aurIcon.foreground -Glyph $aurIcon.glyph -ImagePath $aurBadgeIconPath -ImageSize 16)) | Out-Null
  $script:DbMetricPanel.Children.Add((New-Badge -Text ("SP {0}" -f (Format-CompactNumber $summary.skillPoints)) -Background (Get-ThemeHex 'BadgeGreenBg') -Foreground (Get-ThemeHex 'BadgeGreenFg') -Glyph $skillIcon.glyph -ImagePath $skillBadgeIconPath -ImageSize 16)) | Out-Null
  $script:DbMetricPanel.Children.Add((New-Badge -Text ("Ships {0}" -f $summary.shipCount) -Background $shipIcon.background -Foreground $shipIcon.foreground -Glyph $shipIcon.glyph)) | Out-Null
  $script:DbMetricPanel.Children.Add((New-Badge -Text ("Items {0}" -f $summary.itemCount) -Background $itemIcon.background -Foreground $itemIcon.foreground -Glyph $itemIcon.glyph -ImagePath $itemBadgeIconPath -ImageSize 16)) | Out-Null
}

function Render-OverviewFields {
  if (-not $script:DbWorkingPlayer) { return }
  $account = $script:DbWorkingPlayer.account
  $character = $script:DbWorkingPlayer.character
  $summary = $script:DbWorkingPlayer.summary
  $script:DbAccountNameTextBox.Text = [string]$script:DbWorkingPlayer.accountName
  $script:DbBannedCheckBox.IsChecked = [bool]$account.banned
  $script:DbCharacterNameTextBox.Text = [string]$character.characterName
  $script:DbShipNameTextBox.Text = [string]$character.shipName
  $script:DbBalanceTextBox.Text = Format-DisplayValue $character.balance
  $script:DbPlexTextBox.Text = Format-DisplayValue $character.plexBalance
  $script:DbAurTextBox.Text = Format-DisplayValue $character.aurBalance
  $script:DbSecurityStatusTextBox.Text = Format-DisplayValue $character.securityStatus
  $script:DbDaysLeftTextBox.Text = Format-DisplayValue $character.daysLeft
  $script:DbDescriptionTextBox.Text = [string]$character.description
  $script:DbOverviewCorporationText.Text = [string]$summary.corporationName
  $script:DbOverviewStationText.Text = [string]$summary.stationName
  $script:DbOverviewSystemText.Text = [string]$summary.solarSystemName
  $script:DbSkillPreviewList.DisplayMemberPath = ""
  $script:DbItemPreviewList.DisplayMemberPath = ""
  $script:DbItemPreviewList.SelectedValuePath = "itemKey"
  $script:DbSkillPreviewList.ItemsSource = @($script:DbWorkingPlayer.skillsList)
  $script:DbItemPreviewList.ItemsSource = @($script:DbWorkingPlayer.itemsList)
  Update-ItemActionState
}

function Apply-RawJsonEditors {
  if (-not $script:DbWorkingPlayer) { return }
  $script:DbWorkingPlayer.account = Parse-JsonObjectText -Text $script:DbAccountJsonTextBox.Text -Label "Account JSON"
  $script:DbWorkingPlayer.character = Parse-JsonObjectText -Text $script:DbCharacterJsonTextBox.Text -Label "Character JSON"
  $skillsMap = Parse-JsonObjectText -Text $script:DbSkillsJsonTextBox.Text -Label "Skills JSON"
  $itemsMap = Parse-JsonObjectText -Text $script:DbItemsJsonTextBox.Text -Label "Items JSON"
  $catalogByKey = @{}
  foreach ($entry in @(New-DatabaseSkillCatalog)) { $catalogByKey[[string]$entry.skillKey] = $entry }
  $skillStore = @{}
  foreach ($property in $skillsMap.PSObject.Properties) { $skillStore[[string]$property.Name] = ConvertTo-DeepClone $property.Value }
  $script:DbWorkingPlayer.skillsList = @(Convert-SkillStoreToList -SkillStore $skillStore -CatalogByKey $catalogByKey)
  $script:DbWorkingPlayer.itemsList = @(Convert-ItemMapToList -ItemsMap $itemsMap)
  Update-WorkingPlayerDerivedData
  $script:DbRawJsonDirty = $false
}

function Update-PlayerListDisplay {
  $searchText = $script:DbSearchBox.Text.Trim().ToLowerInvariant()
  $players = @($script:DatabaseSnapshot.players)
  if ($searchText -ne "") { $players = @($players | Where-Object { [string]$_.searchText -like "*$searchText*" }) }
  $script:DbPlayerList.SelectedValuePath = "characterId"
  $script:DbPlayerList.ItemsSource = @($players | ForEach-Object { Get-PlayerDisplayEntry -Player $_ })
  if (@($players).Count -gt 0) {
    $selectedId = if ($script:DatabaseSnapshot.selectedCharacterId) { $script:DatabaseSnapshot.selectedCharacterId } else { $players[0].characterId }
    $script:SuppressPlayerSelection = $true
    $script:DbPlayerList.SelectedValue = $selectedId
    $script:SuppressPlayerSelection = $false
  }
}

function Render-DatabaseSnapshot {
  param([Parameter(Mandatory = $true)][pscustomobject]$Snapshot, [string]$ReadyMessage = "Player database loaded and ready.")
  $script:IsRenderingDatabase = $true
  try {
    $script:DatabaseSnapshot = $Snapshot
    $script:NextGeneratedItemId = if ($Snapshot.nextItemIdSeed) { [int64]$Snapshot.nextItemIdSeed } else { [int64]990000001 }
    $script:DbPathText.Text = "SQLite player database: $($Snapshot.paths.databasePath)"
    $script:DbCountsText.Text = "$($Snapshot.playerCount) characters loaded | $(@($Snapshot.skillCatalog).Count) skills ready in Skill Studio"
    Update-PlayerListDisplay
    if ($Snapshot.selectedPlayer) {
      $script:DbWorkingPlayer = New-DatabaseWorkingCopy -SelectedPlayer $Snapshot.selectedPlayer
      $script:DbWorkingPlayer.itemsList = @(Convert-ItemMapToList -ItemsMap (Convert-ItemListToMap -ItemList @($script:DbWorkingPlayer.itemsList)))
      Render-DatabasePlayer
    }
    Set-DatabaseDirtyState -Dirty $false -Message $ReadyMessage
  } finally {
    $script:IsRenderingDatabase = $false
  }
}

# ---------------------------------------------------------------------------
# Market Orders (external market daemon)
# ---------------------------------------------------------------------------
function Set-MarketActionsEnabled {
  param([bool]$Enabled)
  foreach ($button in @($script:MarketNewButton, $script:MarketModifyButton, $script:MarketCancelButton, $script:MarketLoadButton)) {
    if ($button) { $button.IsEnabled = $Enabled }
  }
}

function Set-MarketStatusUi {
  param([bool]$Reachable, [string]$DaemonHost = "127.0.0.1", [int]$Port = 40111, [string]$ErrorText = "")
  if ($Reachable) {
    $script:MarketStatusBadge.Background = (Get-ThemeBrush 'SuccessBg')
    $script:MarketStatusBadgeText.Foreground = (Get-ThemeBrush 'SuccessFg')
    $script:MarketStatusBadgeText.Text = "ONLINE"
    $script:MarketStatusText.Text = "Market daemon connected"
    $script:MarketStatusDetail.Text = ("Connected to {0}:{1}" -f $DaemonHost, $Port)
  } else {
    $script:MarketStatusBadge.Background = (Get-ThemeBrush 'DangerBg')
    $script:MarketStatusBadgeText.Foreground = (Get-ThemeBrush 'DangerFg')
    $script:MarketStatusBadgeText.Text = "OFFLINE"
    $script:MarketStatusText.Text = "Market daemon offline"
    $detail = "Start the market daemon at {0}:{1} to view or manage orders." -f $DaemonHost, $Port
    if ($ErrorText) { $detail = "{0}  ({1})" -f $detail, $ErrorText }
    $script:MarketStatusDetail.Text = $detail
  }
  Set-MarketActionsEnabled -Enabled $Reachable
}

function Refresh-MarketStatus {
  try {
    $status = Invoke-ProjectCli -Command "market-status"
    $script:MarketStatus = $status
    # StrictMode throws on missing properties, and the "error" field is absent
    # when the daemon is reachable - read every field through the safe accessor.
    $reachable = [bool](Get-JsonPropertyValue -Object $status -Name "reachable")
    $daemonHost = [string](Get-JsonPropertyValue -Object $status -Name "host")
    $port = [int](Get-JsonPropertyValue -Object $status -Name "port")
    $errorText = [string](Get-JsonPropertyValue -Object $status -Name "error")
    Set-MarketStatusUi -Reachable $reachable -DaemonHost $daemonHost -Port $port -ErrorText $errorText
    return $reachable
  } catch {
    $script:MarketStatus = $null
    Set-MarketStatusUi -Reachable $false -ErrorText $_.Exception.Message
    return $false
  }
}

function Get-SelectedMarketOwnerId {
  $idText = ([string]$script:MarketOwnerIdBox.Text).Trim()
  if ($idText -match '^\d+$') { return [int64]$idText }
  $selectedValue = $script:MarketOwnerCombo.SelectedValue
  if ($selectedValue) { return [int64]$selectedValue }
  return [int64]0
}

function New-MarketOrderDisplay {
  param([Parameter(Mandatory = $true)][pscustomobject]$Order)
  $isBuy = [bool]$Order.bid
  $stationText = if ([string]$Order.stationName) { [string]$Order.stationName } else { "Station {0}" -f $Order.stationId }
  $regionText = if ([string]$Order.regionName) { [string]$Order.regionName } else { "Region {0}" -f $Order.regionId }
  $systemText = if ([string]$Order.solarSystemName) { [string]$Order.solarSystemName } else { "System {0}" -f $Order.solarSystemId }
  return [pscustomobject]@{
    orderId = [string]$Order.orderId
    typeName = [string]$Order.typeName
    sideLabel = if ($isBuy) { "BUY" } else { "SELL" }
    sideBg = if ($isBuy) { Get-ThemeHex 'BadgeGreenBg' } else { Get-ThemeHex 'BadgeBlueBg' }
    sideFg = if ($isBuy) { Get-ThemeHex 'BadgeGreenFg' } else { Get-ThemeHex 'BadgeBlueFg' }
    priceText = ("{0:N2} ISK" -f [double]$Order.price)
    qtyText = ("{0:N0} left of {1:N0}  (min {2:N0})" -f [double]$Order.volRemaining, [double]$Order.volEntered, [double]$Order.minVolume)
    locationText = ("{0}  |  {1}  |  {2}" -f $stationText, $regionText, $systemText)
    metaText = ("{0}  |  {1} day(s)  |  order {2}" -f $(if ([string]$Order.source) { [string]$Order.source } else { "unknown source" }), [int]$Order.durationDays, $Order.orderId)
    raw = $Order
  }
}

function Set-MarketOrdersList {
  param([object[]]$Orders, [string]$Summary)
  $display = @(@($Orders) | ForEach-Object { New-MarketOrderDisplay -Order $_ })
  $script:MarketOrdersList.ItemsSource = $display
  $buyCount = @($display | Where-Object { $_.sideLabel -eq "BUY" }).Count
  $sellCount = @($display | Where-Object { $_.sideLabel -eq "SELL" }).Count
  $seedCount = @($display | Where-Object { [string]$_.raw.source -eq "seed" }).Count
  $script:MarketOrdersSummary.Text = ("{0}   |   {1} buy   |   {2} sell   |   {3} seeded" -f $Summary, $buyCount, $sellCount, $seedCount)
}

function Load-MarketOrders {
  $ownerId = Get-SelectedMarketOwnerId
  if ($ownerId -le 0) {
    $script:MarketLastQuery = $null
    $script:MarketOrdersList.ItemsSource = @()
    $script:MarketOrdersSummary.Text = "Pick a character or enter an owner id, then click Load Orders."
    return
  }
  try {
    $result = Invoke-ProjectCli -Command "market-orders" -Arguments @([string]$ownerId)
    $script:MarketLastQuery = [pscustomobject]@{ mode = "owner"; ownerId = $ownerId }
    Set-MarketOrdersList -Orders @($result.orders) -Summary ("{0} order(s) for owner {1}" -f @($result.orders).Count, $ownerId)
    Set-StatusUi -Message ("Loaded market orders for owner {0}." -f $ownerId) -Tone "success" -BadgeText "Market"
  } catch {
    $script:MarketOrdersList.ItemsSource = @()
    $script:MarketOrdersSummary.Text = "Could not load orders: $($_.Exception.Message)"
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
  }
}

function Load-MarketBook {
  $regionText = ([string]$script:MarketRegionBox.Text).Trim()
  if ($regionText -notmatch '^\d+$') {
    Set-StatusUi -Message "Enter a numeric region id to browse the market book." -Tone "info" -BadgeText "Market"
    return
  }
  $typeId = [int64]$script:MarketBookTypeId
  if ($typeId -le 0) {
    Set-StatusUi -Message "Search for and select an item type to browse the market book." -Tone "info" -BadgeText "Market"
    return
  }
  $regionId = [int64]$regionText
  try {
    $book = Invoke-ProjectCli -Command "market-book" -Arguments @([string]$regionId, [string]$typeId)
    $script:MarketLastQuery = [pscustomobject]@{ mode = "book"; regionId = $regionId; typeId = $typeId }
    $all = @(@($book.sells) + @($book.buys))
    $regionName = [string](Get-JsonPropertyValue -Object $book -Name "regionName")
    $regionLabel = if ($regionName) { $regionName } else { "region {0}" -f $regionId }
    Set-MarketOrdersList -Orders $all -Summary ("{0}: {1} order(s) in {2}" -f [string]$book.typeName, $all.Count, $regionLabel)
    Set-StatusUi -Message ("Loaded market book for {0}." -f [string]$book.typeName) -Tone "success" -BadgeText "Market"
  } catch {
    $script:MarketOrdersList.ItemsSource = @()
    $script:MarketOrdersSummary.Text = "Could not load book: $($_.Exception.Message)"
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
  }
}

function Reload-MarketList {
  if (-not $script:MarketLastQuery) { return }
  if ([string]$script:MarketLastQuery.mode -eq "book") { Load-MarketBook } else { Load-MarketOrders }
}

function Refresh-Market {
  $reachable = Refresh-MarketStatus
  if ($reachable) {
    if ($script:MarketLastQuery) { Reload-MarketList } else { Load-MarketOrders }
  } else {
    $script:MarketOrdersList.ItemsSource = @()
    $script:MarketOrdersSummary.Text = "Market daemon is offline - no orders to show."
  }
}

function Remove-SelectedMarketOrder {
  $selected = $script:MarketOrdersList.SelectedItem
  if (-not $selected) {
    Set-StatusUi -Message "Select an order first, then click Cancel Selected." -Tone "info" -BadgeText "Market"
    return
  }
  $isSeed = [string]$selected.raw.source -eq "seed"
  $prompt = if ($isSeed) {
    ("Remove seeded stock for {0} at station {1}?`n`nThis sets its seed quantity to 0." -f $selected.typeName, $selected.raw.stationId)
  } else {
    ("Cancel market order {0}?`n`n{1} {2}`n{3}" -f $selected.orderId, $selected.sideLabel, $selected.typeName, $selected.priceText)
  }
  $confirm = [System.Windows.MessageBox]::Show($prompt, "EvEJS Market", [System.Windows.MessageBoxButton]::YesNo, [System.Windows.MessageBoxImage]::Warning)
  if ($confirm -ne [System.Windows.MessageBoxResult]::Yes) { return }
  try {
    if ($isSeed) {
      $payload = @{
        stationId = [int64]$selected.raw.stationId
        typeId = [int64]$selected.raw.typeId
        deltaQuantity = -[int64]$selected.raw.volRemaining
        reason = "config_editor_remove_seed"
      }
      Invoke-ProjectCli -Command "market-adjust-seed" -InputObject $payload | Out-Null
      Set-StatusUi -Message ("Zeroed seeded stock for {0}." -f $selected.typeName) -Tone "success" -BadgeText "Market"
    } else {
      Invoke-ProjectCli -Command "market-cancel" -Arguments @([string]$selected.orderId) | Out-Null
      Set-StatusUi -Message ("Cancelled market order {0}." -f $selected.orderId) -Tone "success" -BadgeText "Market"
    }
    Reload-MarketList
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Market", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
}

function Invoke-MarketModifySelected {
  $selected = $script:MarketOrdersList.SelectedItem
  if (-not $selected) {
    Set-StatusUi -Message "Select an order to modify." -Tone "info" -BadgeText "Market"
    return
  }
  try {
    if ([string]$selected.raw.source -eq "seed") {
      Open-SeedOrderEditor -SeedOrder $selected
    } else {
      Open-MarketOrderEditor -ExistingOrder $selected
    }
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Market", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
}

function Open-SeedOrderEditor {
  param([Parameter(Mandatory = $true)][pscustomobject]$SeedOrder)

  if (-not $script:MarketStatus -or -not $script:MarketStatus.reachable) {
    [System.Windows.MessageBox]::Show("The market daemon is offline.", "EvEJS Market", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Warning) | Out-Null
    return
  }
  $raw = $SeedOrder.raw

  [xml]$seedXaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Title="EvEJS Seed Order" Width="520" Height="420" WindowStartupLocation="CenterOwner" Background="{DynamicResource WindowBg}" FontFamily="Segoe UI">
  <Grid Margin="18">
    <Grid.RowDefinitions><RowDefinition Height="Auto" /><RowDefinition Height="*" /><RowDefinition Height="Auto" /></Grid.RowDefinitions>
    <Border Grid.Row="0" CornerRadius="14" Padding="16,12,16,12" Margin="0,0,0,12" Background="{DynamicResource HeroBg}" BorderBrush="{DynamicResource BorderSel}" BorderThickness="1">
      <StackPanel>
        <TextBlock x:Name="SeedTitle" FontSize="20" FontWeight="SemiBold" Foreground="{DynamicResource TextPrimary}" />
        <TextBlock x:Name="SeedMeta" Margin="0,4,0,0" FontSize="12" Foreground="{DynamicResource TextMuted}" TextWrapping="Wrap" />
      </StackPanel>
    </Border>
    <Border Grid.Row="1" CornerRadius="14" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" Padding="16">
      <StackPanel>
        <TextBlock x:Name="SeedCurrent" FontSize="12" Foreground="{DynamicResource TextAccent}" Margin="0,0,0,14" TextWrapping="Wrap" />
        <TextBlock Text="New Price (ISK)" FontSize="12" FontWeight="SemiBold" Foreground="{DynamicResource TextMuted}" Margin="0,0,0,6" />
        <TextBox x:Name="SeedPriceBox" Height="36" Margin="0,0,0,14" VerticalContentAlignment="Center" />
        <TextBlock Text="New Quantity" FontSize="12" FontWeight="SemiBold" Foreground="{DynamicResource TextMuted}" Margin="0,0,0,6" />
        <TextBox x:Name="SeedQtyBox" Height="36" VerticalContentAlignment="Center" />
      </StackPanel>
    </Border>
    <Border Grid.Row="2" Margin="0,12,0,0" CornerRadius="14" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" Padding="14,10,14,10">
      <StackPanel Orientation="Horizontal" HorizontalAlignment="Right">
        <Button x:Name="SeedCancelButton" Content="Cancel" Margin="0,0,10,0" Padding="14,8,14,8" />
        <Button x:Name="SeedSaveButton" Content="Apply Changes" Padding="16,8,16,8" />
      </StackPanel>
    </Border>
  </Grid>
</Window>
'@

  $seedWindow = [System.Windows.Markup.XamlReader]::Load([System.Xml.XmlNodeReader]::new($seedXaml))
  $seedWindow.Owner = $script:Window
  $seedWindow.Add_SourceInitialized({ param($s, $e) Apply-WindowThemeChrome -Window $s })

  $seedTitle = $seedWindow.FindName("SeedTitle")
  $seedMeta = $seedWindow.FindName("SeedMeta")
  $seedCurrent = $seedWindow.FindName("SeedCurrent")
  $seedPriceBox = $seedWindow.FindName("SeedPriceBox")
  $seedQtyBox = $seedWindow.FindName("SeedQtyBox")
  $seedCancelButton = $seedWindow.FindName("SeedCancelButton")
  $seedSaveButton = $seedWindow.FindName("SeedSaveButton")

  $seedPriceBox.Style = $script:Window.FindResource("ConfigTextBoxStyle")
  $seedQtyBox.Style = $script:Window.FindResource("ConfigTextBoxStyle")
  $seedCancelButton.Style = $script:Window.FindResource("SecondaryButtonStyle")
  $seedSaveButton.Style = $script:Window.FindResource("PrimaryButtonStyle")

  $currentPrice = [double]$raw.price
  $currentQty = [int64]$raw.volRemaining
  $seedStation = if ([string]$raw.stationName) { [string]$raw.stationName } else { "Station {0}" -f $raw.stationId }
  $seedRegion = if ([string]$raw.regionName) { [string]$raw.regionName } else { "Region {0}" -f $raw.regionId }
  $seedSystem = if ([string]$raw.solarSystemName) { [string]$raw.solarSystemName } else { "System {0}" -f $raw.solarSystemId }
  $seedTitle.Text = "Modify Seeded Order"
  $seedMeta.Text = ("{0}  |  {1}  |  {2}  |  {3}" -f $SeedOrder.typeName, $seedStation, $seedRegion, $seedSystem)
  $seedCurrent.Text = ("Current seed: {0:N2} ISK  x  {1:N0} units" -f $currentPrice, $currentQty)
  $seedPriceBox.Text = [string]$currentPrice
  $seedQtyBox.Text = [string]$currentQty

  $seedCancelButton.Add_Click({ $seedWindow.DialogResult = $false; $seedWindow.Close() })
  $seedSaveButton.Add_Click({
    try {
      $newPrice = Parse-NumericText -Text $seedPriceBox.Text -Label "New price"
      $newQty = [int64](Parse-NumericText -Text $seedQtyBox.Text -Label "New quantity")
      $delta = $newQty - $currentQty
      $payload = @{
        stationId = [int64]$raw.stationId
        typeId = [int64]$raw.typeId
        deltaQuantity = $delta
        newPrice = $newPrice
        reason = "config_editor_modify_seed"
      }
      Invoke-ProjectCli -Command "market-adjust-seed" -InputObject $payload | Out-Null
      $seedWindow.DialogResult = $true
      $seedWindow.Close()
    } catch {
      [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Market", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
    }
  })

  if ($seedWindow.ShowDialog() -eq $true) {
    Set-StatusUi -Message ("Updated seeded stock for {0}." -f $SeedOrder.typeName) -Tone "success" -BadgeText "Market"
    Reload-MarketList
  }
}

function Open-MarketOrderEditor {
  param([pscustomobject]$ExistingOrder = $null)

  if (-not $script:MarketStatus -or -not $script:MarketStatus.reachable) {
    [System.Windows.MessageBox]::Show("The market daemon is offline. Start it before adding or modifying orders.", "EvEJS Market", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Warning) | Out-Null
    return
  }

  $isModify = $null -ne $ExistingOrder
  $windowTitle = if ($isModify) { "Modify Market Order" } else { "New Market Order" }

  [xml]$orderXaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Width="920" Height="700" MinWidth="820" MinHeight="620" WindowStartupLocation="CenterOwner" Background="{DynamicResource WindowBg}" FontFamily="Segoe UI">
  <Grid Margin="18">
    <Grid.RowDefinitions><RowDefinition Height="Auto" /><RowDefinition Height="*" /><RowDefinition Height="Auto" /></Grid.RowDefinitions>
    <Border Grid.Row="0" CornerRadius="14" Padding="18,14,18,14" Margin="0,0,0,14" Background="{DynamicResource HeroBg}" BorderBrush="{DynamicResource BorderSel}" BorderThickness="1">
      <StackPanel>
        <TextBlock x:Name="MoeTitle" FontSize="22" FontWeight="SemiBold" Foreground="{DynamicResource TextPrimary}" />
        <TextBlock Text="Orders are placed directly on the running market daemon." Margin="0,4,0,0" FontSize="12" Foreground="{DynamicResource TextMuted}" />
      </StackPanel>
    </Border>
    <Grid Grid.Row="1">
      <Grid.ColumnDefinitions><ColumnDefinition Width="*" /><ColumnDefinition Width="14" /><ColumnDefinition Width="360" /></Grid.ColumnDefinitions>
      <Border Grid.Column="0" CornerRadius="14" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" Padding="16">
        <DockPanel LastChildFill="True">
          <StackPanel DockPanel.Dock="Top">
            <TextBlock Text="Item Type" FontSize="16" FontWeight="SemiBold" Foreground="{DynamicResource TextPrimary}" />
            <TextBlock x:Name="MoeSelectedType" Margin="0,4,0,10" FontSize="12" Foreground="{DynamicResource TextAccent}" TextWrapping="Wrap" Text="No type selected" />
            <TextBox x:Name="MoeSearchBox" Height="36" Margin="0,0,0,10" VerticalContentAlignment="Center" />
          </StackPanel>
          <ListBox x:Name="MoeTypeList" BorderThickness="0" Background="Transparent" Foreground="{DynamicResource TextPrimary}" />
        </DockPanel>
      </Border>
      <Border Grid.Column="2" CornerRadius="14" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" Padding="16">
        <StackPanel>
          <TextBlock Text="Order Side" FontSize="12" FontWeight="SemiBold" Foreground="{DynamicResource TextMuted}" Margin="0,0,0,6" />
          <ComboBox x:Name="MoeSideCombo" Height="34" Margin="0,0,0,12" />
          <Grid Margin="0,0,0,12">
            <Grid.ColumnDefinitions><ColumnDefinition Width="*" /><ColumnDefinition Width="12" /><ColumnDefinition Width="*" /></Grid.ColumnDefinitions>
            <StackPanel Grid.Column="0"><TextBlock Text="Price (ISK)" FontSize="12" FontWeight="SemiBold" Foreground="{DynamicResource TextMuted}" Margin="0,0,0,6" /><TextBox x:Name="MoePriceBox" Height="34" VerticalContentAlignment="Center" /></StackPanel>
            <StackPanel Grid.Column="2"><TextBlock Text="Quantity" FontSize="12" FontWeight="SemiBold" Foreground="{DynamicResource TextMuted}" Margin="0,0,0,6" /><TextBox x:Name="MoeQtyBox" Height="34" VerticalContentAlignment="Center" /></StackPanel>
          </Grid>
          <Grid Margin="0,0,0,12">
            <Grid.ColumnDefinitions><ColumnDefinition Width="*" /><ColumnDefinition Width="12" /><ColumnDefinition Width="*" /></Grid.ColumnDefinitions>
            <StackPanel Grid.Column="0"><TextBlock Text="Min Volume" FontSize="12" FontWeight="SemiBold" Foreground="{DynamicResource TextMuted}" Margin="0,0,0,6" /><TextBox x:Name="MoeMinVolBox" Height="34" VerticalContentAlignment="Center" /></StackPanel>
            <StackPanel Grid.Column="2"><TextBlock Text="Duration (days)" FontSize="12" FontWeight="SemiBold" Foreground="{DynamicResource TextMuted}" Margin="0,0,0,6" /><TextBox x:Name="MoeDurationBox" Height="34" VerticalContentAlignment="Center" /></StackPanel>
          </Grid>
          <Grid Margin="0,0,0,12">
            <Grid.ColumnDefinitions><ColumnDefinition Width="*" /><ColumnDefinition Width="12" /><ColumnDefinition Width="*" /></Grid.ColumnDefinitions>
            <StackPanel Grid.Column="0"><TextBlock Text="Range" FontSize="12" FontWeight="SemiBold" Foreground="{DynamicResource TextMuted}" Margin="0,0,0,6" /><TextBox x:Name="MoeRangeBox" Height="34" VerticalContentAlignment="Center" /></StackPanel>
            <StackPanel Grid.Column="2"><TextBlock Text="Source" FontSize="12" FontWeight="SemiBold" Foreground="{DynamicResource TextMuted}" Margin="0,0,0,6" /><ComboBox x:Name="MoeSourceCombo" Height="34" /></StackPanel>
          </Grid>
          <TextBlock Text="Station ID" FontSize="12" FontWeight="SemiBold" Foreground="{DynamicResource TextMuted}" Margin="0,0,0,6" />
          <TextBox x:Name="MoeStationBox" Height="34" Margin="0,0,0,12" VerticalContentAlignment="Center" />
          <TextBlock Text="Owner (character) ID" FontSize="12" FontWeight="SemiBold" Foreground="{DynamicResource TextMuted}" Margin="0,0,0,6" />
          <TextBox x:Name="MoeOwnerBox" Height="34" VerticalContentAlignment="Center" />
        </StackPanel>
      </Border>
    </Grid>
    <Border Grid.Row="2" Margin="0,14,0,0" CornerRadius="14" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" Padding="14,10,14,10">
      <DockPanel LastChildFill="False">
        <TextBlock x:Name="MoeFooter" VerticalAlignment="Center" FontSize="12" Foreground="{DynamicResource TextMuted}" />
        <StackPanel DockPanel.Dock="Right" Orientation="Horizontal">
          <Button x:Name="MoeCancelButton" Content="Cancel" Margin="0,0,10,0" Padding="14,8,14,8" />
          <Button x:Name="MoeSaveButton" Content="Place Order" Padding="16,8,16,8" />
        </StackPanel>
      </DockPanel>
    </Border>
  </Grid>
</Window>
'@

  $orderWindow = [System.Windows.Markup.XamlReader]::Load([System.Xml.XmlNodeReader]::new($orderXaml))
  $orderWindow.Owner = $script:Window
  $orderWindow.Title = "EvEJS $windowTitle"
  $orderWindow.Add_SourceInitialized({ param($s, $e) Apply-WindowThemeChrome -Window $s })

  $moeTitle = $orderWindow.FindName("MoeTitle")
  $moeSelectedType = $orderWindow.FindName("MoeSelectedType")
  $moeSearchBox = $orderWindow.FindName("MoeSearchBox")
  $moeTypeList = $orderWindow.FindName("MoeTypeList")
  $moeSideCombo = $orderWindow.FindName("MoeSideCombo")
  $moePriceBox = $orderWindow.FindName("MoePriceBox")
  $moeQtyBox = $orderWindow.FindName("MoeQtyBox")
  $moeMinVolBox = $orderWindow.FindName("MoeMinVolBox")
  $moeDurationBox = $orderWindow.FindName("MoeDurationBox")
  $moeRangeBox = $orderWindow.FindName("MoeRangeBox")
  $moeSourceCombo = $orderWindow.FindName("MoeSourceCombo")
  $moeStationBox = $orderWindow.FindName("MoeStationBox")
  $moeOwnerBox = $orderWindow.FindName("MoeOwnerBox")
  $moeFooter = $orderWindow.FindName("MoeFooter")
  $moeCancelButton = $orderWindow.FindName("MoeCancelButton")
  $moeSaveButton = $orderWindow.FindName("MoeSaveButton")

  # Shared styles live in the main window's resources, so apply them here rather
  # than via {StaticResource} (which does not resolve into a separate window).
  foreach ($tb in @($moeSearchBox, $moePriceBox, $moeQtyBox, $moeMinVolBox, $moeDurationBox, $moeRangeBox, $moeStationBox, $moeOwnerBox)) {
    $tb.Style = $script:Window.FindResource("ConfigTextBoxStyle")
  }
  foreach ($cb in @($moeSideCombo, $moeSourceCombo)) {
    $cb.Style = $script:Window.FindResource("ConfigComboBoxStyle")
  }
  $moeCancelButton.Style = $script:Window.FindResource("SecondaryButtonStyle")
  $moeSaveButton.Style = $script:Window.FindResource("PrimaryButtonStyle")

  $moeTitle.Text = $windowTitle
  $moeTypeList.SetValue([System.Windows.Controls.ScrollViewer]::HorizontalScrollBarVisibilityProperty, [System.Windows.Controls.ScrollBarVisibility]::Disabled)
  $moeTypeList.DisplayMemberPath = "label"
  $moeTypeList.SelectedValuePath = "typeID"

  $moeSideCombo.ItemsSource = @(
    [pscustomobject]@{ label = "Sell order"; value = $false },
    [pscustomobject]@{ label = "Buy order"; value = $true }
  )
  $moeSideCombo.DisplayMemberPath = "label"
  $moeSideCombo.SelectedValuePath = "value"
  $moeSourceCombo.ItemsSource = @("player", "seed", "npc")

  $script:MoeSelectedTypeId = 0
  $script:MoeSelectedTypeName = ""
  $setSelectedType = {
    param($TypeId, $TypeName)
    $script:MoeSelectedTypeId = [int64]$TypeId
    $script:MoeSelectedTypeName = [string]$TypeName
    $moeSelectedType.Text = if ($script:MoeSelectedTypeId -gt 0) { "{0}  (type {1})" -f $script:MoeSelectedTypeName, $script:MoeSelectedTypeId } else { "No type selected" }
  }

  $runTypeSearch = {
    $query = ([string]$moeSearchBox.Text).Trim()
    if ($query.Length -lt 2) { $moeTypeList.ItemsSource = @(); return }
    try {
      $results = Invoke-ProjectCli -Command "database-type-search" -Arguments @("item", $query)
      $moeTypeList.ItemsSource = @(@($results) | ForEach-Object {
          [pscustomobject]@{ label = ("{0}  -  {1}" -f $_.name, $_.groupName); name = $_.name; typeID = $_.typeID }
        })
    } catch {
      $moeTypeList.ItemsSource = @()
    }
  }
  $moeSearchBox.Add_TextChanged({ & $runTypeSearch })
  $moeTypeList.Add_SelectionChanged({
    $selection = $moeTypeList.SelectedItem
    if ($selection) { & $setSelectedType $selection.typeID $selection.name }
  })

  # Prefill defaults (from the current owner selection) or the order being modified.
  $defaultOwner = Get-SelectedMarketOwnerId
  if ($isModify) {
    $raw = $ExistingOrder.raw
    & $setSelectedType $raw.typeId $ExistingOrder.typeName
    $moeSideCombo.SelectedValue = [bool]$raw.bid
    $moePriceBox.Text = [string]$raw.price
    $moeQtyBox.Text = [string][int64]$raw.volRemaining
    $moeMinVolBox.Text = [string][int64]$raw.minVolume
    $moeDurationBox.Text = [string][int64]$raw.durationDays
    $moeRangeBox.Text = [string][int64]$raw.rangeValue
    $moeStationBox.Text = [string][int64]$raw.stationId
    $moeOwnerBox.Text = [string][int64]$raw.ownerId
    $moeSourceCombo.SelectedItem = if ([string]$raw.source) { [string]$raw.source } else { "player" }
    $moeSaveButton.Content = "Apply Changes"
    $moeFooter.Text = "Modify re-places order $($ExistingOrder.orderId): the old order is cancelled and a new one created."
  } else {
    $moeSideCombo.SelectedIndex = 0
    $moeMinVolBox.Text = "1"
    $moeDurationBox.Text = "90"
    $moeRangeBox.Text = "0"
    $moeSourceCombo.SelectedItem = "player"
    if ($defaultOwner -gt 0) { $moeOwnerBox.Text = [string]$defaultOwner }
    $moeFooter.Text = "The order is placed immediately on the market daemon."
  }

  $moeCancelButton.Add_Click({ $orderWindow.DialogResult = $false; $orderWindow.Close() })
  $moeSaveButton.Add_Click({
    try {
      if ($script:MoeSelectedTypeId -le 0) { throw "Search for and select an item type first." }
      $payload = @{
        typeId = [int64]$script:MoeSelectedTypeId
        bid = [bool]$moeSideCombo.SelectedValue
        price = (Parse-NumericText -Text $moePriceBox.Text -Label "Price")
        quantity = (Parse-NumericText -Text $moeQtyBox.Text -Label "Quantity")
        minVolume = (Parse-NumericText -Text $moeMinVolBox.Text -Label "Min volume")
        durationDays = (Parse-NumericText -Text $moeDurationBox.Text -Label "Duration")
        rangeValue = (Parse-NumericText -Text $moeRangeBox.Text -Label "Range")
        stationId = (Parse-NumericText -Text $moeStationBox.Text -Label "Station id")
        ownerId = (Parse-NumericText -Text $moeOwnerBox.Text -Label "Owner id")
        source = [string]$moeSourceCombo.SelectedItem
      }
      if ($isModify) {
        $payload.orderId = [string]$ExistingOrder.orderId
        Invoke-ProjectCli -Command "market-modify" -InputObject $payload | Out-Null
      } else {
        Invoke-ProjectCli -Command "market-place" -InputObject $payload | Out-Null
      }
      $orderWindow.DialogResult = $true
      $orderWindow.Close()
    } catch {
      [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Market", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
    }
  })

  $result = $orderWindow.ShowDialog()
  if ($result -eq $true) {
    $verb = if ($isModify) { "Updated" } else { "Placed" }
    Set-StatusUi -Message ("{0} market order for owner {1}." -f $verb, (Get-SelectedMarketOwnerId)) -Tone "success" -BadgeText "Market"
    if ($script:MarketLastQuery) { Reload-MarketList } else { Load-MarketOrders }
  }
}

$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="EvEJS Config Manager"
        Width="1280"
        Height="920"
        MinWidth="1100"
        MinHeight="760"
        WindowStartupLocation="CenterScreen"
        Background="{DynamicResource WindowBg}"
        FontFamily="Segoe UI">
  <Window.Resources>
    <Style x:Key="SecondaryButtonStyle" TargetType="Button">
      <Setter Property="FontSize" Value="13" />
      <Setter Property="FontWeight" Value="SemiBold" />
      <Setter Property="Background" Value="{DynamicResource BtnBg}" />
      <Setter Property="Foreground" Value="{DynamicResource BtnText}" />
      <Setter Property="BorderBrush" Value="{DynamicResource BorderStrong}" />
      <Setter Property="BorderThickness" Value="1" />
      <Setter Property="Cursor" Value="Hand" />
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="Chrome"
                    Background="{TemplateBinding Background}"
                    BorderBrush="{TemplateBinding BorderBrush}"
                    BorderThickness="{TemplateBinding BorderThickness}"
                    CornerRadius="10">
              <ContentPresenter HorizontalAlignment="Center"
                                VerticalAlignment="Center"
                                Margin="{TemplateBinding Padding}" />
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="Chrome" Property="Background" Value="{DynamicResource BtnHoverBg}" />
                <Setter TargetName="Chrome" Property="BorderBrush" Value="{DynamicResource BorderSel}" />
              </Trigger>
              <Trigger Property="IsPressed" Value="True">
                <Setter TargetName="Chrome" Property="Background" Value="{DynamicResource BtnPressBg}" />
              </Trigger>
              <Trigger Property="IsEnabled" Value="False">
                <Setter TargetName="Chrome" Property="Opacity" Value="0.45" />
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key="PrimaryButtonStyle" TargetType="Button" BasedOn="{StaticResource SecondaryButtonStyle}">
      <Setter Property="Background" Value="{DynamicResource Accent}" />
      <Setter Property="Foreground" Value="{DynamicResource OnAccent}" />
      <Setter Property="BorderBrush" Value="{DynamicResource AccentHover}" />
    </Style>
    <Style x:Key="ConfigTextBoxStyle" TargetType="TextBox">
      <Setter Property="Padding" Value="10,6,10,6" />
      <Setter Property="FontSize" Value="14" />
      <Setter Property="Foreground" Value="{DynamicResource TextPrimary}" />
      <Setter Property="Background" Value="{DynamicResource PanelInput}" />
      <Setter Property="BorderBrush" Value="{DynamicResource BorderStrong}" />
      <Setter Property="BorderThickness" Value="1" />
      <Setter Property="CaretBrush" Value="{DynamicResource TextPrimary}" />
      <Setter Property="SelectionBrush" Value="{DynamicResource Accent}" />
    </Style>
    <Style x:Key="ConfigComboBoxItemStyle" TargetType="ComboBoxItem">
      <Setter Property="Foreground" Value="{DynamicResource TextPrimary}" />
      <Setter Property="Background" Value="Transparent" />
      <Setter Property="Padding" Value="10,7,10,7" />
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="ComboBoxItem">
            <Border x:Name="ItemChrome" Background="{TemplateBinding Background}" Padding="{TemplateBinding Padding}" CornerRadius="6">
              <ContentPresenter />
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsHighlighted" Value="True">
                <Setter TargetName="ItemChrome" Property="Background" Value="{DynamicResource ListHoverBg}" />
              </Trigger>
              <Trigger Property="IsSelected" Value="True">
                <Setter TargetName="ItemChrome" Property="Background" Value="{DynamicResource ListSelBg}" />
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key="ConfigComboBoxStyle" TargetType="ComboBox">
      <Setter Property="FontSize" Value="14" />
      <Setter Property="Foreground" Value="{DynamicResource TextPrimary}" />
      <Setter Property="Background" Value="{DynamicResource PanelInput}" />
      <Setter Property="BorderBrush" Value="{DynamicResource BorderStrong}" />
      <Setter Property="BorderThickness" Value="1" />
      <Setter Property="ItemContainerStyle" Value="{StaticResource ConfigComboBoxItemStyle}" />
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="ComboBox">
            <Grid>
              <ToggleButton Focusable="False"
                            ClickMode="Press"
                            IsChecked="{Binding IsDropDownOpen, Mode=TwoWay, RelativeSource={RelativeSource TemplatedParent}}">
                <ToggleButton.Template>
                  <ControlTemplate TargetType="ToggleButton">
                    <Border x:Name="CbChrome"
                            Background="{DynamicResource PanelInput}"
                            BorderBrush="{DynamicResource BorderStrong}"
                            BorderThickness="1"
                            CornerRadius="10">
                      <Path x:Name="CbArrow"
                            HorizontalAlignment="Right"
                            VerticalAlignment="Center"
                            Margin="0,0,12,0"
                            Data="M0,0 L4,4 L8,0 Z"
                            Fill="{DynamicResource TextMuted}" />
                    </Border>
                    <ControlTemplate.Triggers>
                      <Trigger Property="IsMouseOver" Value="True">
                        <Setter TargetName="CbChrome" Property="BorderBrush" Value="{DynamicResource BorderSel}" />
                      </Trigger>
                    </ControlTemplate.Triggers>
                  </ControlTemplate>
                </ToggleButton.Template>
              </ToggleButton>
              <ContentPresenter x:Name="CbContent"
                                IsHitTestVisible="False"
                                Content="{TemplateBinding SelectionBoxItem}"
                                ContentTemplate="{TemplateBinding SelectionBoxItemTemplate}"
                                ContentTemplateSelector="{TemplateBinding ItemTemplateSelector}"
                                Margin="12,0,30,0"
                                VerticalAlignment="Center"
                                HorizontalAlignment="Left"
                                TextElement.Foreground="{DynamicResource TextPrimary}" />
              <Popup x:Name="CbPopup"
                     Placement="Bottom"
                     IsOpen="{TemplateBinding IsDropDownOpen}"
                     AllowsTransparency="True"
                     Focusable="False"
                     PopupAnimation="Slide">
                <Border MinWidth="{TemplateBinding ActualWidth}"
                        MaxHeight="{TemplateBinding MaxDropDownHeight}"
                        Background="{DynamicResource Panel}"
                        BorderBrush="{DynamicResource BorderStrong}"
                        BorderThickness="1"
                        CornerRadius="8"
                        Margin="0,4,0,0">
                  <ScrollViewer>
                    <ItemsPresenter />
                  </ScrollViewer>
                </Border>
              </Popup>
            </Grid>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style TargetType="TabControl">
      <Setter Property="Background" Value="Transparent" />
      <Setter Property="BorderThickness" Value="0" />
      <Setter Property="Padding" Value="0" />
    </Style>
    <Style x:Key="SectionLabelStyle" TargetType="TextBlock">
      <Setter Property="FontSize" Value="12" />
      <Setter Property="FontWeight" Value="SemiBold" />
      <Setter Property="Foreground" Value="{DynamicResource TextMuted}" />
      <Setter Property="Margin" Value="0,0,0,6" />
    </Style>
    <Style x:Key="ThemeToggleButtonStyle" TargetType="Button">
      <Setter Property="FontSize" Value="16" />
      <Setter Property="Background" Value="{DynamicResource BtnBg}" />
      <Setter Property="Foreground" Value="{DynamicResource TextAccent}" />
      <Setter Property="BorderBrush" Value="{DynamicResource BorderStrong}" />
      <Setter Property="Cursor" Value="Hand" />
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="Chrome"
                    Background="{TemplateBinding Background}"
                    BorderBrush="{TemplateBinding BorderBrush}"
                    BorderThickness="1"
                    CornerRadius="10"
                    Width="40"
                    Height="36">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center" />
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="Chrome" Property="BorderBrush" Value="{DynamicResource BorderSel}" />
                <Setter TargetName="Chrome" Property="Background" Value="{DynamicResource BtnHoverBg}" />
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style TargetType="TabItem">
      <Setter Property="FontSize" Value="12" />
      <Setter Property="FontWeight" Value="SemiBold" />
      <Setter Property="Foreground" Value="{DynamicResource TextSecondary}" />
      <Setter Property="Padding" Value="12,6" />
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="TabItem">
            <Border x:Name="TabChrome"
                    Background="{DynamicResource TabBg}"
                    BorderBrush="{DynamicResource Border}"
                    BorderThickness="1"
                    CornerRadius="8"
                    Margin="0,0,8,8">
              <ContentPresenter ContentSource="Header"
                                HorizontalAlignment="Center"
                                VerticalAlignment="Center"
                                Margin="{TemplateBinding Padding}" />
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsSelected" Value="True">
                <Setter TargetName="TabChrome" Property="Background" Value="{DynamicResource TabSelBg}" />
                <Setter TargetName="TabChrome" Property="BorderBrush" Value="{DynamicResource BorderSel}" />
                <Setter Property="Foreground" Value="{DynamicResource TextPrimary}" />
              </Trigger>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="TabChrome" Property="BorderBrush" Value="{DynamicResource TabHoverBorder}" />
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
  </Window.Resources>
  <Grid Margin="12">
    <Grid.RowDefinitions>
      <RowDefinition Height="Auto" />
      <RowDefinition Height="*" />
      <RowDefinition Height="Auto" />
    </Grid.RowDefinitions>

    <Border Grid.Row="0" CornerRadius="12" Padding="18,12,18,12" Margin="0,0,0,10"
            Background="{DynamicResource HeroBg}"
            BorderBrush="{DynamicResource BorderSel}"
            BorderThickness="1">
      <Grid>
        <Grid.ColumnDefinitions>
          <ColumnDefinition Width="*" />
          <ColumnDefinition Width="Auto" />
        </Grid.ColumnDefinitions>
        <StackPanel VerticalAlignment="Center">
          <TextBlock Text="EvEJS Command Nexus"
                     FontSize="20"
                     FontWeight="SemiBold"
                     Foreground="{DynamicResource TextPrimary}" />
          <TextBlock Text="Capsuleer-side control for server settings, player data, and fast recovery actions."
                     Margin="0,3,0,0"
                     FontSize="12"
                     Foreground="{DynamicResource TextMuted}" />
        </StackPanel>
        <StackPanel Grid.Column="1" Orientation="Horizontal" VerticalAlignment="Center">
          <Border x:Name="HeroBadgeBorder"
                  VerticalAlignment="Top"
                  Background="{DynamicResource InfoBg}"
                  BorderBrush="{DynamicResource BorderStrong}"
                  BorderThickness="1"
                  CornerRadius="10"
                  Padding="14,8,14,8"
                  Margin="0,0,10,0">
            <TextBlock x:Name="HeroBadgeText"
                       FontSize="12"
                       FontWeight="SemiBold"
                       Foreground="{DynamicResource TextAccent}"
                       VerticalAlignment="Center"
                       Text="STATUS: READY" />
          </Border>
          <Button x:Name="ThemeToggleButton"
                  Style="{StaticResource ThemeToggleButtonStyle}"
                  ToolTip="Toggle dark / light theme"
                  Content="&#x263D;" />
        </StackPanel>
      </Grid>
    </Border>

    <TabControl x:Name="MasterTabs" Grid.Row="1" Background="Transparent">
      <TabItem Header="Server Settings">
        <Grid Margin="0,8,0,0">
          <Grid.RowDefinitions>
            <RowDefinition Height="Auto" />
            <RowDefinition Height="*" />
          </Grid.RowDefinitions>
          <Border Grid.Row="0" CornerRadius="14" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" Padding="14,10,14,10" Margin="0,0,0,10">
            <StackPanel>
              <Grid>
                <Grid.ColumnDefinitions>
                  <ColumnDefinition Width="*" />
                  <ColumnDefinition Width="Auto" />
                </Grid.ColumnDefinitions>
                <Grid VerticalAlignment="Center">
                  <TextBox x:Name="SettingsSearchBox" Height="36" Padding="34,0,12,0" VerticalContentAlignment="Center" Style="{StaticResource ConfigTextBoxStyle}" />
                  <TextBlock Text="&#xE721;" FontFamily="Segoe MDL2 Assets" FontSize="14" IsHitTestVisible="False" Foreground="{DynamicResource TextMuted}" VerticalAlignment="Center" HorizontalAlignment="Left" Margin="12,0,0,0" />
                  <TextBlock x:Name="SettingsSearchHint" Text="Search settings by name, key, or description" IsHitTestVisible="False" Foreground="{DynamicResource TextMuted}" VerticalAlignment="Center" HorizontalAlignment="Left" Margin="34,0,0,0" FontSize="13" />
                </Grid>
                <StackPanel Grid.Column="1" Orientation="Horizontal" HorizontalAlignment="Right" VerticalAlignment="Center" Margin="12,0,0,0">
                  <Button x:Name="SettingsOpenFileButton" Content="Open File" Margin="0,0,8,0" Padding="12,7,12,7" Style="{StaticResource SecondaryButtonStyle}" />
                  <Button x:Name="SettingsDefaultsButton" Content="Load Defaults" Margin="0,0,8,0" Padding="12,7,12,7" Style="{StaticResource SecondaryButtonStyle}" />
                  <Button x:Name="SettingsReloadButton" Content="Reload" Margin="0,0,8,0" Padding="12,7,12,7" Style="{StaticResource SecondaryButtonStyle}" />
                  <Button x:Name="SettingsSaveButton" Content="Save Changes" Padding="14,7,14,7" Style="{StaticResource PrimaryButtonStyle}" />
                </StackPanel>
              </Grid>
              <TextBlock x:Name="SettingsPathText" FontSize="11" Foreground="{DynamicResource TextMuted}" Margin="2,8,0,0" TextTrimming="CharacterEllipsis" />
              <TextBlock x:Name="SettingsEnvNoteText" Margin="2,6,0,0" FontSize="12" Foreground="{DynamicResource TextAccent}" TextWrapping="Wrap" Visibility="Collapsed" />
            </StackPanel>
          </Border>
          <TabControl x:Name="SettingsTabs" Grid.Row="1" Background="Transparent">
            <TabControl.ItemsPanel>
              <ItemsPanelTemplate>
                <WrapPanel />
              </ItemsPanelTemplate>
            </TabControl.ItemsPanel>
          </TabControl>
        </Grid>
      </TabItem>

      <TabItem Header="Server Database">
        <Grid Margin="0,12,0,0">
          <Grid.RowDefinitions>
            <RowDefinition Height="Auto" />
            <RowDefinition Height="*" />
          </Grid.RowDefinitions>

          <Border Grid.Row="0" CornerRadius="18" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" Padding="18" Margin="0,0,0,14">
            <Grid>
              <Grid.ColumnDefinitions>
                <ColumnDefinition Width="*" />
                <ColumnDefinition Width="Auto" />
              </Grid.ColumnDefinitions>
              <StackPanel>
                <TextBlock x:Name="DbPathText" FontSize="13" FontWeight="SemiBold" Foreground="{DynamicResource TextPrimary}" />
                <TextBlock x:Name="DbCountsText" Margin="0,8,0,0" FontSize="12" Foreground="{DynamicResource TextMuted}" />
              </StackPanel>
              <StackPanel Grid.Column="1" Orientation="Horizontal" HorizontalAlignment="Right">
                <Button x:Name="DbOpenFolderButton" Content="Open Database Folder" Margin="0,0,10,0" Padding="16,10,16,10" Style="{StaticResource SecondaryButtonStyle}" />
                <Button x:Name="DbReloadButton" Content="Reload" Margin="0,0,10,0" Padding="16,10,16,10" Style="{StaticResource SecondaryButtonStyle}" />
                <Button x:Name="DbSkillStudioButton" Content="Skill Studio" Margin="0,0,10,0" Padding="16,10,16,10" Style="{StaticResource SecondaryButtonStyle}" />
                <Button x:Name="DbSaveButton" Content="Save Player Changes" Padding="18,10,18,10" Style="{StaticResource PrimaryButtonStyle}" />
              </StackPanel>
            </Grid>
          </Border>

          <Grid Grid.Row="1">
            <Grid.ColumnDefinitions>
              <ColumnDefinition Width="320" />
              <ColumnDefinition Width="14" />
              <ColumnDefinition Width="*" />
            </Grid.ColumnDefinitions>

            <Border Grid.Column="0" CornerRadius="18" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" Padding="16">
              <DockPanel LastChildFill="True">
                <StackPanel DockPanel.Dock="Top">
                  <TextBlock Text="Players" FontSize="18" FontWeight="SemiBold" Foreground="{DynamicResource TextPrimary}" />
                  <TextBlock Text="Search by character, account, system, corporation, or ship." Margin="0,6,0,12" FontSize="12" Foreground="{DynamicResource TextMuted}" TextWrapping="Wrap" />
                  <TextBox x:Name="DbSearchBox" Height="38" Margin="0,0,0,12" Style="{StaticResource ConfigTextBoxStyle}" />
                </StackPanel>
                <ListBox x:Name="DbPlayerList" BorderThickness="0" Background="Transparent" />
              </DockPanel>
            </Border>

            <Grid Grid.Column="2">
              <Grid.RowDefinitions>
                <RowDefinition Height="Auto" />
                <RowDefinition Height="*" />
              </Grid.RowDefinitions>

              <Border Grid.Row="0" CornerRadius="18" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" Padding="18" Margin="0,0,0,14">
                <StackPanel>
                  <TextBlock x:Name="DbPlayerHeadline" FontSize="24" FontWeight="SemiBold" Foreground="{DynamicResource TextPrimary}" Text="No player selected" />
                  <TextBlock x:Name="DbPlayerMeta" Margin="0,8,0,0" FontSize="13" Foreground="{DynamicResource TextMuted}" TextWrapping="Wrap" />
                  <TextBlock x:Name="DbWarningText" Margin="0,10,0,0" FontSize="12" Foreground="{DynamicResource TextAccent}" TextWrapping="Wrap" Visibility="Collapsed" />
                  <WrapPanel x:Name="DbMetricPanel" Margin="0,14,0,0" />
                </StackPanel>
              </Border>

              <TabControl x:Name="DbDetailTabs" Grid.Row="1" Background="Transparent">
                <TabItem Header="Overview">
                  <ScrollViewer VerticalScrollBarVisibility="Auto">
                    <Border CornerRadius="18" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" Padding="18" Margin="0,12,0,0">
                      <Grid>
                        <Grid.ColumnDefinitions>
                          <ColumnDefinition Width="*" />
                          <ColumnDefinition Width="*" />
                        </Grid.ColumnDefinitions>
                        <Grid.RowDefinitions>
                          <RowDefinition Height="Auto" />
                          <RowDefinition Height="Auto" />
                          <RowDefinition Height="Auto" />
                          <RowDefinition Height="*" />
                        </Grid.RowDefinitions>

                        <StackPanel Grid.Row="0" Grid.Column="0" Margin="0,0,12,12">
                          <TextBlock Text="Account Name" Style="{StaticResource SectionLabelStyle}" />
                          <TextBox x:Name="DbAccountNameTextBox" Height="38" Style="{StaticResource ConfigTextBoxStyle}" />
                        </StackPanel>
                        <StackPanel Grid.Row="0" Grid.Column="1" Margin="12,0,0,12">
                          <TextBlock Text="Banned" Style="{StaticResource SectionLabelStyle}" />
                          <CheckBox x:Name="DbBannedCheckBox" Content="Account is banned" FontSize="14" Foreground="{DynamicResource TextPrimary}" />
                        </StackPanel>

                        <StackPanel Grid.Row="1" Grid.Column="0" Margin="0,0,12,12">
                          <TextBlock Text="Character Name" Style="{StaticResource SectionLabelStyle}" />
                          <TextBox x:Name="DbCharacterNameTextBox" Height="38" Style="{StaticResource ConfigTextBoxStyle}" />
                        </StackPanel>
                        <StackPanel Grid.Row="1" Grid.Column="1" Margin="12,0,0,12">
                          <TextBlock Text="Ship Name" Style="{StaticResource SectionLabelStyle}" />
                          <TextBox x:Name="DbShipNameTextBox" Height="38" Style="{StaticResource ConfigTextBoxStyle}" />
                        </StackPanel>

                        <Grid Grid.Row="2" Grid.ColumnSpan="2">
                          <Grid.ColumnDefinitions>
                            <ColumnDefinition Width="*" />
                            <ColumnDefinition Width="*" />
                            <ColumnDefinition Width="*" />
                            <ColumnDefinition Width="*" />
                          </Grid.ColumnDefinitions>
                          <StackPanel Grid.Column="0" Margin="0,0,8,12">
                            <TextBlock Text="ISK Balance" Style="{StaticResource SectionLabelStyle}" />
                            <TextBox x:Name="DbBalanceTextBox" Height="38" Style="{StaticResource ConfigTextBoxStyle}" />
                          </StackPanel>
                          <StackPanel Grid.Column="1" Margin="8,0,8,12">
                            <TextBlock Text="PLEX Balance" Style="{StaticResource SectionLabelStyle}" />
                            <TextBox x:Name="DbPlexTextBox" Height="38" Style="{StaticResource ConfigTextBoxStyle}" />
                          </StackPanel>
                          <StackPanel Grid.Column="2" Margin="8,0,8,12">
                            <TextBlock Text="AUR Balance" Style="{StaticResource SectionLabelStyle}" />
                            <TextBox x:Name="DbAurTextBox" Height="38" Style="{StaticResource ConfigTextBoxStyle}" />
                          </StackPanel>
                          <StackPanel Grid.Column="3" Margin="8,0,0,12">
                            <TextBlock Text="Security Status" Style="{StaticResource SectionLabelStyle}" />
                            <TextBox x:Name="DbSecurityStatusTextBox" Height="38" Style="{StaticResource ConfigTextBoxStyle}" />
                          </StackPanel>
                        </Grid>

                        <Grid Grid.Row="3" Grid.ColumnSpan="2">
                          <Grid.ColumnDefinitions>
                            <ColumnDefinition Width="2*" />
                            <ColumnDefinition Width="*" />
                            <ColumnDefinition Width="*" />
                          </Grid.ColumnDefinitions>

                          <StackPanel Grid.Column="0" Margin="0,0,12,0">
                            <TextBlock Text="Description" Style="{StaticResource SectionLabelStyle}" />
                            <TextBox x:Name="DbDescriptionTextBox" Height="160" AcceptsReturn="True" TextWrapping="Wrap" VerticalScrollBarVisibility="Auto" Style="{StaticResource ConfigTextBoxStyle}" />
                            <DockPanel Margin="0,14,0,6">
                              <TextBlock Text="Known Skills" Style="{StaticResource SectionLabelStyle}" />
                              <Button x:Name="DbSkillStudioOverviewButton" DockPanel.Dock="Right" Content="Open Skill Studio" Padding="12,8,12,8" Style="{StaticResource SecondaryButtonStyle}" />
                            </DockPanel>
                            <ListBox x:Name="DbSkillPreviewList" Height="180" />
                          </StackPanel>

                          <StackPanel Grid.Column="1" Margin="12,0,12,0">
                            <TextBlock Text="Pilot Quick Actions" Style="{StaticResource SectionLabelStyle}" />
                            <WrapPanel Margin="0,0,0,12">
                              <Button x:Name="DbGrantIskButton" Content="+10M ISK" Margin="0,0,8,8" Padding="12,8,12,8" Style="{StaticResource SecondaryButtonStyle}" />
                              <Button x:Name="DbAddGameTimeButton" Content="+30 Days" Margin="0,0,8,8" Padding="12,8,12,8" Style="{StaticResource SecondaryButtonStyle}" />
                              <Button x:Name="DbMaxSecurityButton" Content="Security 5.0" Margin="0,0,8,8" Padding="12,8,12,8" Style="{StaticResource SecondaryButtonStyle}" />
                              <Button x:Name="DbClearBanButton" Content="Clear Ban" Margin="0,0,8,8" Padding="12,8,12,8" Style="{StaticResource SecondaryButtonStyle}" />
                              <Button x:Name="DbMaxOwnedSkillsButton" Content="Owned Skills V" Margin="0,0,8,8" Padding="12,8,12,8" Style="{StaticResource SecondaryButtonStyle}" />
                              <Button x:Name="DbOpenRawButton" Content="Raw JSON View" Margin="0,0,8,8" Padding="12,8,12,8" Style="{StaticResource SecondaryButtonStyle}" />
                            </WrapPanel>
                            <TextBlock Text="Read-only References" Style="{StaticResource SectionLabelStyle}" />
                            <TextBlock Text="Corporation" Style="{StaticResource SectionLabelStyle}" Margin="0,12,0,6" />
                            <TextBlock x:Name="DbOverviewCorporationText" Foreground="{DynamicResource TextSecondary}" TextWrapping="Wrap" />
                            <TextBlock Text="Station" Style="{StaticResource SectionLabelStyle}" Margin="0,12,0,6" />
                            <TextBlock x:Name="DbOverviewStationText" Foreground="{DynamicResource TextSecondary}" TextWrapping="Wrap" />
                            <TextBlock Text="Solar System" Style="{StaticResource SectionLabelStyle}" Margin="0,12,0,6" />
                            <TextBlock x:Name="DbOverviewSystemText" Foreground="{DynamicResource TextSecondary}" TextWrapping="Wrap" />
                          </StackPanel>

                          <StackPanel Grid.Column="2" Margin="12,0,0,0">
                            <DockPanel Margin="0,0,0,10">
                              <TextBlock Text="Owned Items" Style="{StaticResource SectionLabelStyle}" />
                              <WrapPanel DockPanel.Dock="Right">
                                <Button x:Name="DbAddShipButton" Content="Add Ship" Margin="0,0,8,8" Padding="12,8,12,8" Style="{StaticResource SecondaryButtonStyle}" />
                                <Button x:Name="DbAddItemButton" Content="Add Item" Margin="0,0,8,8" Padding="12,8,12,8" Style="{StaticResource SecondaryButtonStyle}" />
                                <Button x:Name="DbEditItemButton" Content="Edit Selection" Margin="0,0,8,8" Padding="12,8,12,8" Style="{StaticResource SecondaryButtonStyle}" />
                                <Button x:Name="DbRemoveItemButton" Content="Remove Selection" Margin="0,0,0,8" Padding="12,8,12,8" Style="{StaticResource SecondaryButtonStyle}" />
                              </WrapPanel>
                            </DockPanel>
                            <ListBox x:Name="DbItemPreviewList" Height="320" />
                            <TextBlock Text="Days Left" Style="{StaticResource SectionLabelStyle}" Margin="0,14,0,6" />
                            <TextBox x:Name="DbDaysLeftTextBox" Height="38" Style="{StaticResource ConfigTextBoxStyle}" />
                          </StackPanel>
                        </Grid>
                      </Grid>
                    </Border>
                  </ScrollViewer>
                </TabItem>

                <TabItem Header="Raw JSON">
                  <ScrollViewer VerticalScrollBarVisibility="Auto">
                    <StackPanel Margin="0,12,0,0">
                      <Border CornerRadius="18" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" Padding="18" Margin="0,0,0,14">
                        <StackPanel>
                          <TextBlock Text="Raw object editors" FontSize="18" FontWeight="SemiBold" Foreground="{DynamicResource TextPrimary}" />
                          <TextBlock Text="This is the full-control escape hatch. Edit carefully, then click Apply Raw JSON before saving." Margin="0,8,0,0" FontSize="12" Foreground="{DynamicResource TextMuted}" TextWrapping="Wrap" />
                          <StackPanel Orientation="Horizontal" Margin="0,14,0,0">
                            <Button x:Name="DbRefreshJsonButton" Content="Refresh From Working Copy" Margin="0,0,10,0" Padding="16,10,16,10" Style="{StaticResource SecondaryButtonStyle}" />
                            <Button x:Name="DbApplyJsonButton" Content="Apply Raw JSON" Padding="16,10,16,10" Style="{StaticResource PrimaryButtonStyle}" />
                          </StackPanel>
                        </StackPanel>
                      </Border>

                      <Border CornerRadius="18" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" Padding="18" Margin="0,0,0,14">
                        <StackPanel>
                          <TextBlock Text="Account JSON" Style="{StaticResource SectionLabelStyle}" />
                          <TextBox x:Name="DbAccountJsonTextBox" Height="180" AcceptsReturn="True" TextWrapping="NoWrap" VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Auto" Style="{StaticResource ConfigTextBoxStyle}" />
                        </StackPanel>
                      </Border>

                      <Border CornerRadius="18" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" Padding="18" Margin="0,0,0,14">
                        <StackPanel>
                          <TextBlock Text="Character JSON" Style="{StaticResource SectionLabelStyle}" />
                          <TextBox x:Name="DbCharacterJsonTextBox" Height="240" AcceptsReturn="True" TextWrapping="NoWrap" VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Auto" Style="{StaticResource ConfigTextBoxStyle}" />
                        </StackPanel>
                      </Border>

                      <Border CornerRadius="18" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" Padding="18" Margin="0,0,0,14">
                        <StackPanel>
                          <TextBlock Text="Skills JSON" Style="{StaticResource SectionLabelStyle}" />
                          <TextBox x:Name="DbSkillsJsonTextBox" Height="220" AcceptsReturn="True" TextWrapping="NoWrap" VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Auto" Style="{StaticResource ConfigTextBoxStyle}" />
                        </StackPanel>
                      </Border>

                      <Border CornerRadius="18" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" Padding="18">
                        <StackPanel>
                          <TextBlock Text="Items JSON" Style="{StaticResource SectionLabelStyle}" />
                          <TextBox x:Name="DbItemsJsonTextBox" Height="220" AcceptsReturn="True" TextWrapping="NoWrap" VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Auto" Style="{StaticResource ConfigTextBoxStyle}" />
                        </StackPanel>
                      </Border>
                    </StackPanel>
                  </ScrollViewer>
                </TabItem>
              </TabControl>
            </Grid>
          </Grid>
        </Grid>
      </TabItem>

      <TabItem Header="Market Orders">
        <Grid Margin="0,8,0,0">
          <Grid.RowDefinitions>
            <RowDefinition Height="Auto" />
            <RowDefinition Height="*" />
          </Grid.RowDefinitions>

          <Border Grid.Row="0" CornerRadius="14" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" Padding="14,10,14,10" Margin="0,0,0,10">
            <StackPanel>
              <Grid>
                <Grid.ColumnDefinitions>
                  <ColumnDefinition Width="*" />
                  <ColumnDefinition Width="Auto" />
                </Grid.ColumnDefinitions>
                <StackPanel VerticalAlignment="Center">
                  <StackPanel Orientation="Horizontal">
                    <Border x:Name="MarketStatusBadge" CornerRadius="8" Padding="10,4,10,4" Background="{DynamicResource WarnBg}" VerticalAlignment="Center">
                      <TextBlock x:Name="MarketStatusBadgeText" Text="CHECKING" FontSize="11" FontWeight="SemiBold" Foreground="{DynamicResource WarnFg}" />
                    </Border>
                    <TextBlock x:Name="MarketStatusText" Margin="10,0,0,0" VerticalAlignment="Center" FontSize="13" FontWeight="SemiBold" Foreground="{DynamicResource TextPrimary}" Text="Checking market daemon..." />
                  </StackPanel>
                  <TextBlock x:Name="MarketStatusDetail" Margin="0,4,0,0" FontSize="12" Foreground="{DynamicResource TextMuted}" Text="" />
                </StackPanel>
                <StackPanel Grid.Column="1" Orientation="Horizontal" HorizontalAlignment="Right" VerticalAlignment="Center">
                  <Button x:Name="MarketRefreshButton" Content="Refresh" Margin="0,0,8,0" Padding="12,7,12,7" Style="{StaticResource SecondaryButtonStyle}" />
                  <Button x:Name="MarketNewButton" Content="New Order" Margin="0,0,8,0" Padding="12,7,12,7" Style="{StaticResource SecondaryButtonStyle}" />
                  <Button x:Name="MarketModifyButton" Content="Modify Selected" Margin="0,0,8,0" Padding="12,7,12,7" Style="{StaticResource SecondaryButtonStyle}" />
                  <Button x:Name="MarketCancelButton" Content="Cancel Selected" Padding="12,7,12,7" Style="{StaticResource PrimaryButtonStyle}" />
                </StackPanel>
              </Grid>
              <Grid Margin="0,12,0,0">
                <Grid.ColumnDefinitions>
                  <ColumnDefinition Width="Auto" />
                  <ColumnDefinition Width="260" />
                  <ColumnDefinition Width="Auto" />
                  <ColumnDefinition Width="180" />
                  <ColumnDefinition Width="Auto" />
                  <ColumnDefinition Width="*" />
                </Grid.ColumnDefinitions>
                <TextBlock Grid.Column="0" Text="Character" VerticalAlignment="Center" Margin="0,0,10,0" FontSize="12" FontWeight="SemiBold" Foreground="{DynamicResource TextMuted}" />
                <ComboBox x:Name="MarketOwnerCombo" Grid.Column="1" Height="34" Style="{StaticResource ConfigComboBoxStyle}" />
                <TextBlock Grid.Column="2" Text="Owner ID" VerticalAlignment="Center" Margin="14,0,10,0" FontSize="12" FontWeight="SemiBold" Foreground="{DynamicResource TextMuted}" />
                <TextBox x:Name="MarketOwnerIdBox" Grid.Column="3" Height="34" VerticalContentAlignment="Center" Style="{StaticResource ConfigTextBoxStyle}" />
                <Button x:Name="MarketLoadButton" Grid.Column="4" Content="Load Orders" Margin="12,0,0,0" Padding="14,7,14,7" Style="{StaticResource SecondaryButtonStyle}" />
              </Grid>
              <Grid Margin="0,10,0,0">
                <Grid.ColumnDefinitions>
                  <ColumnDefinition Width="Auto" />
                  <ColumnDefinition Width="210" />
                  <ColumnDefinition Width="230" />
                  <ColumnDefinition Width="Auto" />
                  <ColumnDefinition Width="130" />
                  <ColumnDefinition Width="Auto" />
                  <ColumnDefinition Width="*" />
                </Grid.ColumnDefinitions>
                <TextBlock Grid.Column="0" Text="Browse book" VerticalAlignment="Center" Margin="0,0,10,0" FontSize="12" FontWeight="SemiBold" Foreground="{DynamicResource TextMuted}" />
                <TextBox x:Name="MarketBookTypeBox" Grid.Column="1" Height="34" VerticalContentAlignment="Center" Style="{StaticResource ConfigTextBoxStyle}" />
                <ComboBox x:Name="MarketBookTypeCombo" Grid.Column="2" Height="34" Margin="8,0,0,0" Style="{StaticResource ConfigComboBoxStyle}" />
                <TextBlock Grid.Column="3" Text="Region" VerticalAlignment="Center" Margin="14,0,10,0" FontSize="12" FontWeight="SemiBold" Foreground="{DynamicResource TextMuted}" />
                <TextBox x:Name="MarketRegionBox" Grid.Column="4" Height="34" Text="10000002" VerticalContentAlignment="Center" Style="{StaticResource ConfigTextBoxStyle}" />
                <Button x:Name="MarketBookLoadButton" Grid.Column="5" Content="Load Book" Margin="12,0,0,0" Padding="14,7,14,7" Style="{StaticResource SecondaryButtonStyle}" />
              </Grid>
            </StackPanel>
          </Border>

          <Border Grid.Row="1" CornerRadius="14" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" Padding="8">
            <DockPanel LastChildFill="True">
              <TextBlock x:Name="MarketOrdersSummary" DockPanel.Dock="Top" Margin="6,4,6,10" FontSize="12" Foreground="{DynamicResource TextMuted}" Text="No orders loaded." />
              <ListBox x:Name="MarketOrdersList" BorderThickness="0" Background="Transparent" />
            </DockPanel>
          </Border>
        </Grid>
      </TabItem>
    </TabControl>

    <Border Grid.Row="2" CornerRadius="12" Background="{DynamicResource Panel}" BorderBrush="{DynamicResource Border}" BorderThickness="1" Padding="14,8,14,8" Margin="0,8,0,0">
      <DockPanel LastChildFill="True">
        <TextBlock x:Name="FooterHintText" DockPanel.Dock="Right" FontSize="12" Foreground="{DynamicResource TextMuted}" VerticalAlignment="Center" Text="Changes save directly into the project files" />
        <TextBlock x:Name="FooterStatusText" FontSize="12" FontWeight="SemiBold" Foreground="{DynamicResource SuccessFg}" VerticalAlignment="Center" Text="Ready" />
      </DockPanel>
    </Border>
  </Grid>
</Window>
'@

[xml]$xamlDocument = $xaml
$reader = [System.Xml.XmlNodeReader]::new($xamlDocument)
$script:Window = [System.Windows.Markup.XamlReader]::Load($reader)

$script:HeroBadgeBorder = $script:Window.FindName("HeroBadgeBorder")
$script:HeroBadgeText = $script:Window.FindName("HeroBadgeText")
$script:ThemeToggleButton = $script:Window.FindName("ThemeToggleButton")
$script:FooterStatusText = $script:Window.FindName("FooterStatusText")
$script:FooterHintText = $script:Window.FindName("FooterHintText")

$script:SettingsPathText = $script:Window.FindName("SettingsPathText")
$script:SettingsEnvNoteText = $script:Window.FindName("SettingsEnvNoteText")
$script:SettingsSearchBox = $script:Window.FindName("SettingsSearchBox")
$script:SettingsSearchHint = $script:Window.FindName("SettingsSearchHint")
$script:SettingsOpenFileButton = $script:Window.FindName("SettingsOpenFileButton")
$script:SettingsDefaultsButton = $script:Window.FindName("SettingsDefaultsButton")
$script:SettingsReloadButton = $script:Window.FindName("SettingsReloadButton")
$script:SettingsSaveButton = $script:Window.FindName("SettingsSaveButton")
$script:SettingsTabs = $script:Window.FindName("SettingsTabs")
$script:MasterTabs = $script:Window.FindName("MasterTabs")

$script:DbPathText = $script:Window.FindName("DbPathText")
$script:DbCountsText = $script:Window.FindName("DbCountsText")
$script:DbOpenFolderButton = $script:Window.FindName("DbOpenFolderButton")
$script:DbReloadButton = $script:Window.FindName("DbReloadButton")
$script:DbSkillStudioButton = $script:Window.FindName("DbSkillStudioButton")
$script:DbSaveButton = $script:Window.FindName("DbSaveButton")
$script:DbSearchBox = $script:Window.FindName("DbSearchBox")
$script:DbPlayerList = $script:Window.FindName("DbPlayerList")
$script:DbPlayerHeadline = $script:Window.FindName("DbPlayerHeadline")
$script:DbPlayerMeta = $script:Window.FindName("DbPlayerMeta")
$script:DbWarningText = $script:Window.FindName("DbWarningText")
$script:DbMetricPanel = $script:Window.FindName("DbMetricPanel")
$script:DbDetailTabs = $script:Window.FindName("DbDetailTabs")
$script:DbAccountNameTextBox = $script:Window.FindName("DbAccountNameTextBox")
$script:DbBannedCheckBox = $script:Window.FindName("DbBannedCheckBox")
$script:DbCharacterNameTextBox = $script:Window.FindName("DbCharacterNameTextBox")
$script:DbShipNameTextBox = $script:Window.FindName("DbShipNameTextBox")
$script:DbBalanceTextBox = $script:Window.FindName("DbBalanceTextBox")
$script:DbPlexTextBox = $script:Window.FindName("DbPlexTextBox")
$script:DbAurTextBox = $script:Window.FindName("DbAurTextBox")
$script:DbSecurityStatusTextBox = $script:Window.FindName("DbSecurityStatusTextBox")
$script:DbDescriptionTextBox = $script:Window.FindName("DbDescriptionTextBox")
$script:DbDaysLeftTextBox = $script:Window.FindName("DbDaysLeftTextBox")
$script:DbOverviewCorporationText = $script:Window.FindName("DbOverviewCorporationText")
$script:DbOverviewStationText = $script:Window.FindName("DbOverviewStationText")
$script:DbOverviewSystemText = $script:Window.FindName("DbOverviewSystemText")
$script:DbSkillStudioOverviewButton = $script:Window.FindName("DbSkillStudioOverviewButton")
$script:DbGrantIskButton = $script:Window.FindName("DbGrantIskButton")
$script:DbAddGameTimeButton = $script:Window.FindName("DbAddGameTimeButton")
$script:DbMaxSecurityButton = $script:Window.FindName("DbMaxSecurityButton")
$script:DbClearBanButton = $script:Window.FindName("DbClearBanButton")
$script:DbMaxOwnedSkillsButton = $script:Window.FindName("DbMaxOwnedSkillsButton")
$script:DbAddShipButton = $script:Window.FindName("DbAddShipButton")
$script:DbAddItemButton = $script:Window.FindName("DbAddItemButton")
$script:DbEditItemButton = $script:Window.FindName("DbEditItemButton")
$script:DbRemoveItemButton = $script:Window.FindName("DbRemoveItemButton")
$script:DbOpenRawButton = $script:Window.FindName("DbOpenRawButton")
$script:DbSkillPreviewList = $script:Window.FindName("DbSkillPreviewList")
$script:DbItemPreviewList = $script:Window.FindName("DbItemPreviewList")
$script:DbAccountJsonTextBox = $script:Window.FindName("DbAccountJsonTextBox")
$script:DbCharacterJsonTextBox = $script:Window.FindName("DbCharacterJsonTextBox")
$script:DbSkillsJsonTextBox = $script:Window.FindName("DbSkillsJsonTextBox")
$script:DbItemsJsonTextBox = $script:Window.FindName("DbItemsJsonTextBox")
$script:DbRefreshJsonButton = $script:Window.FindName("DbRefreshJsonButton")
$script:DbApplyJsonButton = $script:Window.FindName("DbApplyJsonButton")

$script:MarketStatusBadge = $script:Window.FindName("MarketStatusBadge")
$script:MarketStatusBadgeText = $script:Window.FindName("MarketStatusBadgeText")
$script:MarketStatusText = $script:Window.FindName("MarketStatusText")
$script:MarketStatusDetail = $script:Window.FindName("MarketStatusDetail")
$script:MarketRefreshButton = $script:Window.FindName("MarketRefreshButton")
$script:MarketNewButton = $script:Window.FindName("MarketNewButton")
$script:MarketModifyButton = $script:Window.FindName("MarketModifyButton")
$script:MarketCancelButton = $script:Window.FindName("MarketCancelButton")
$script:MarketOwnerCombo = $script:Window.FindName("MarketOwnerCombo")
$script:MarketOwnerIdBox = $script:Window.FindName("MarketOwnerIdBox")
$script:MarketLoadButton = $script:Window.FindName("MarketLoadButton")
$script:MarketBookTypeBox = $script:Window.FindName("MarketBookTypeBox")
$script:MarketBookTypeCombo = $script:Window.FindName("MarketBookTypeCombo")
$script:MarketRegionBox = $script:Window.FindName("MarketRegionBox")
$script:MarketBookLoadButton = $script:Window.FindName("MarketBookLoadButton")
$script:MarketOrdersSummary = $script:Window.FindName("MarketOrdersSummary")
$script:MarketOrdersList = $script:Window.FindName("MarketOrdersList")

Invoke-AssetExtraction

Initialize-AppChrome

$settingsSnapshot = Invoke-ProjectCli -Command "export"
$databaseSnapshot = Invoke-ProjectCli -Command "database-export"
Render-SettingsSnapshot -Snapshot $settingsSnapshot
Render-DatabaseSnapshot -Snapshot $databaseSnapshot
Initialize-Market

if ($NoUi) {
  Write-Output "EvEJS Config Manager loaded successfully."
  return
}

$script:ThemeToggleButton.Add_Click({
  Toggle-Theme
})

$script:SettingsSearchBox.Add_TextChanged({
  Update-SettingsVisibility
})

$script:FooterStatusText.Add_MouseLeftButtonUp({
  if ($script:FooterErrorKey) { Navigate-ToSetting -Key $script:FooterErrorKey }
})

$script:SettingsOpenFileButton.Add_Click({
  Start-Process -FilePath "notepad.exe" -ArgumentList @($script:SettingsSnapshot.paths.localConfigPath)
})

$script:SettingsDefaultsButton.Add_Click({
  foreach ($controller in $script:SettingsFieldControllers.Values) {
    Set-ControlValue -Controller $controller -Value $controller.Entry.defaultValue
  }
  Set-SettingsDirtyState -Dirty $true -Message "Default values are loaded into the settings form. Click Save Changes to write them."
})

$script:SettingsReloadButton.Add_Click({
  if (-not (Confirm-DiscardChanges -Area "server settings" -IsDirty $script:SettingsDirty)) { return }
  try {
    $snapshot = Invoke-ProjectCli -Command "export"
    Render-SettingsSnapshot -Snapshot $snapshot -ReadyMessage "Reloaded server settings from disk."
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Config Manager", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:SettingsSaveButton.Add_Click({
  try {
    $snapshot = Invoke-ProjectCli -Command "save" -InputObject @{ values = (Collect-SettingsValues) }
    Render-SettingsSnapshot -Snapshot $snapshot -ReadyMessage "Saved server settings."
    Set-StatusUi -Message "Saved server settings." -Tone "success" -BadgeText "Settings saved"
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Config Manager", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:DbOpenFolderButton.Add_Click({
  $databaseFolder = Split-Path -Parent ([string]$script:DatabaseSnapshot.paths.databasePath)
  Start-Process -FilePath "explorer.exe" -ArgumentList @($databaseFolder)
})

$script:DbReloadButton.Add_Click({
  if (-not (Confirm-DiscardChanges -Area "the player database" -IsDirty $script:DatabaseDirty)) { return }
  try {
    Reload-DatabaseSnapshot -CharacterId $script:DatabaseSnapshot.selectedCharacterId
    Set-DatabaseDirtyState -Dirty $false -Message "Reloaded player database from disk."
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Config Manager", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:DbSkillStudioButton.Add_Click({
  try {
    Open-SkillStudio
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Skill Studio", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:DbSkillStudioOverviewButton.Add_Click({
  try {
    Open-SkillStudio
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Skill Studio", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:DbSaveButton.Add_Click({
  try {
    Save-DatabasePlayer
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Config Manager", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:DbGrantIskButton.Add_Click({
  $nextValue = [double](Get-TextBoxNumericValue -TextBox $script:DbBalanceTextBox -Fallback 0 -Label "ISK balance") + 10000000
  $script:DbBalanceTextBox.Text = [string][int64]$nextValue
  Set-DatabaseDirtyState -Dirty $true -Message "Added 10,000,000 ISK to the staged player wallet."
})

$script:DbAddGameTimeButton.Add_Click({
  $nextValue = [double](Get-TextBoxNumericValue -TextBox $script:DbDaysLeftTextBox -Fallback 0 -Label "Days left") + 30
  $script:DbDaysLeftTextBox.Text = [string][int64]$nextValue
  Set-DatabaseDirtyState -Dirty $true -Message "Added 30 days to the staged player account."
})

$script:DbMaxSecurityButton.Add_Click({
  $script:DbSecurityStatusTextBox.Text = "5"
  Set-DatabaseDirtyState -Dirty $true -Message "Set security status to 5.0 in the staged player form."
})

$script:DbClearBanButton.Add_Click({
  $script:DbBannedCheckBox.IsChecked = $false
  Set-DatabaseDirtyState -Dirty $true -Message "Cleared the account ban flag in the staged player form."
})

$script:DbMaxOwnedSkillsButton.Add_Click({
  try {
    Sync-OverviewControlsToWorkingCopy
    $catalogByKey = @{}
    foreach ($entry in @(New-DatabaseSkillCatalog)) { $catalogByKey[[string]$entry.skillKey] = $entry }
    $skillStore = @{}
    foreach ($skill in @($script:DbWorkingPlayer.skillsList)) {
      $catalogEntry = $catalogByKey[[string]$skill.skillKey]
      if ($catalogEntry) {
        $skillStore[[string]$skill.skillKey] = New-SkillRawFromCatalog -CatalogEntry $catalogEntry -CharacterId $script:DbWorkingPlayer.characterId -Level 5
      } else {
        $skillStore[[string]$skill.skillKey] = ConvertTo-DeepClone $skill.raw
      }
    }
    $script:DbWorkingPlayer.skillsList = @(Convert-SkillStoreToList -SkillStore $skillStore -CatalogByKey $catalogByKey)
    Update-WorkingPlayerDerivedData
    Render-DatabasePlayer
    Set-DatabaseDirtyState -Dirty $true -Message "Upgraded all currently owned skills to level V in the staged player."
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Config Manager", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:DbAddShipButton.Add_Click({
  try {
    Open-ItemShipEditor -Kind "ship"
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Database Helper", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:DbAddItemButton.Add_Click({
  try {
    Open-ItemShipEditor -Kind "item"
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Database Helper", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:DbEditItemButton.Add_Click({
  try {
    $selectedItem = [pscustomobject]$script:DbItemPreviewList.SelectedItem
    if (-not $selectedItem) { return }
    if ([int]$selectedItem.categoryID -eq 6) {
      Open-ItemShipEditor -Kind "ship" -ExistingItem $selectedItem
    } else {
      Open-ItemShipEditor -Kind "item" -ExistingItem $selectedItem
    }
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Database Helper", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:DbRemoveItemButton.Add_Click({
  try {
    Remove-SelectedInventoryEntry
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Database Helper", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:DbOpenRawButton.Add_Click({
  $script:DbDetailTabs.SelectedIndex = 1
  Set-StatusUi -Message "Switched to the raw JSON helper view." -Tone "info" -BadgeText "Raw view"
})

$script:DbSearchBox.Add_TextChanged({
  if (-not $script:IsRenderingDatabase) { Update-PlayerListDisplay }
})

$script:DbPlayerList.Add_SelectionChanged({
  if ($script:SuppressPlayerSelection -or $script:IsRenderingDatabase) { return }
  $newCharacterId = [string]$script:DbPlayerList.SelectedValue
  if (-not $newCharacterId -or $newCharacterId -eq [string]$script:DatabaseSnapshot.selectedCharacterId) { return }
  if (-not (Confirm-DiscardChanges -Area "the selected player" -IsDirty $script:DatabaseDirty)) {
    $script:SuppressPlayerSelection = $true
    $script:DbPlayerList.SelectedValue = $script:DatabaseSnapshot.selectedCharacterId
    $script:SuppressPlayerSelection = $false
    return
  }
  try {
    Reload-DatabaseSnapshot -CharacterId $newCharacterId
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Config Manager", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:DbItemPreviewList.Add_SelectionChanged({
  if (-not $script:IsRenderingDatabase) { Update-ItemActionState }
})

foreach ($overviewControl in @(
  $script:DbAccountNameTextBox,
  $script:DbCharacterNameTextBox,
  $script:DbShipNameTextBox,
  $script:DbBalanceTextBox,
  $script:DbPlexTextBox,
  $script:DbAurTextBox,
  $script:DbSecurityStatusTextBox,
  $script:DbDescriptionTextBox,
  $script:DbDaysLeftTextBox
)) {
  $overviewControl.Add_TextChanged({
    if (-not $script:IsRenderingDatabase) {
      Set-DatabaseDirtyState -Dirty $true -Message "Player overview changes are staged in the form."
    }
  })
}

$script:DbBannedCheckBox.Add_Checked({
  if (-not $script:IsRenderingDatabase) { Set-DatabaseDirtyState -Dirty $true -Message "Player overview changes are staged in the form." }
})
$script:DbBannedCheckBox.Add_Unchecked({
  if (-not $script:IsRenderingDatabase) { Set-DatabaseDirtyState -Dirty $true -Message "Player overview changes are staged in the form." }
})

foreach ($rawTextBox in @(
  $script:DbAccountJsonTextBox,
  $script:DbCharacterJsonTextBox,
  $script:DbSkillsJsonTextBox,
  $script:DbItemsJsonTextBox
)) {
  $rawTextBox.Add_TextChanged({
    if (-not $script:IsRenderingDatabase) {
      $script:DbRawJsonDirty = $true
      Set-DatabaseDirtyState -Dirty $true -Message "Raw JSON edits are staged. Apply or save to keep them."
    }
  })
}

$script:DbRefreshJsonButton.Add_Click({
  try {
    Sync-OverviewControlsToWorkingCopy
    $script:IsRenderingDatabase = $true
    try {
      Refresh-RawJsonEditors
    } finally {
      $script:IsRenderingDatabase = $false
    }
    Set-DatabaseDirtyState -Dirty $script:DatabaseDirty -Message "Refreshed raw JSON from the current working copy."
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Config Manager", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:DbApplyJsonButton.Add_Click({
  try {
    Apply-RawJsonEditors
    Render-DatabasePlayer
    Set-DatabaseDirtyState -Dirty $true -Message "Applied raw JSON changes to the working copy."
  } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Config Manager", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})

$script:MarketRefreshButton.Add_Click({ Refresh-Market })
$script:MarketLoadButton.Add_Click({ Load-MarketOrders })
$script:MarketOwnerCombo.Add_SelectionChanged({
  if ($script:MarketOwnerCombo.SelectedValue) { $script:MarketOwnerIdBox.Text = "" }
})
$script:MarketBookLoadButton.Add_Click({ Load-MarketBook })
$script:MarketBookTypeBox.Add_TextChanged({
  $query = ([string]$script:MarketBookTypeBox.Text).Trim()
  if ($query.Length -lt 2) { $script:MarketBookTypeCombo.ItemsSource = @(); return }
  try {
    $results = Invoke-ProjectCli -Command "database-type-search" -Arguments @("item", $query)
    $script:MarketBookTypeCombo.ItemsSource = @(@($results) | ForEach-Object {
        [pscustomobject]@{ label = ("{0}  -  {1}" -f $_.name, $_.groupName); typeID = $_.typeID }
      })
    if ($script:MarketBookTypeCombo.Items.Count -gt 0) { $script:MarketBookTypeCombo.SelectedIndex = 0 }
  } catch { $script:MarketBookTypeCombo.ItemsSource = @() }
})
$script:MarketBookTypeCombo.Add_SelectionChanged({
  $sel = $script:MarketBookTypeCombo.SelectedValue
  $script:MarketBookTypeId = if ($sel) { [int64]$sel } else { 0 }
})
$script:MarketNewButton.Add_Click({
  try { Open-MarketOrderEditor } catch {
    Set-StatusUi -Message $_.Exception.Message -Tone "error"
    [System.Windows.MessageBox]::Show($_.Exception.Message, "EvEJS Market", [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Error) | Out-Null
  }
})
$script:MarketModifyButton.Add_Click({ Invoke-MarketModifySelected })
$script:MarketCancelButton.Add_Click({ Remove-SelectedMarketOrder })
$script:MarketOrdersList.Add_MouseDoubleClick({ Invoke-MarketModifySelected })

$script:Window.Add_SourceInitialized({
  Apply-WindowThemeChrome -Window $script:Window
})

$script:Window.Add_Closing({
  param($sender, $eventArgs)
  if (-not (Confirm-DiscardChanges -Area "server settings" -IsDirty $script:SettingsDirty)) {
    $eventArgs.Cancel = $true
    return
  }
  if (-not (Confirm-DiscardChanges -Area "the player database" -IsDirty $script:DatabaseDirty)) {
    $eventArgs.Cancel = $true
  }
})

$null = $script:Window.ShowDialog()
