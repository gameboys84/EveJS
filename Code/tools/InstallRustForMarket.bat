@echo off
setlocal EnableExtensions
title EvEJS - Install Rust For Market

for %%I in ("%~dp0..") do set "EVEJS_REPO_ROOT=%%~fI"
set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "CARGO_BIN=%USERPROFILE%\.cargo\bin"
set "RUSTUP_EXE=%CARGO_BIN%\rustup.exe"
set "RUSTUP_INIT_EXE=%CARGO_BIN%\rustup-init.exe"
set "CARGO_EXE=%CARGO_BIN%\cargo.exe"
set "RUSTC_EXE=%CARGO_BIN%\rustc.exe"
set "MSVC_LINK_WRAPPER=%CARGO_BIN%\evejs-msvc-link.cmd"
set "MARKET_SEED_DIR=%EVEJS_REPO_ROOT%\tools\market-seed"
set "MARKET_SERVER_DIR=%EVEJS_REPO_ROOT%\externalservices\market-server"
set "VSWHERE_EXE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
set "VS_INSTALLER_EXE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vs_installer.exe"
set "WINGET_EXE="
set "VS_INSTALL_PATH="
set "VCVARS64_BAT="
set "EVEJS_EXIT=0"

call :EnsureAdmin
if errorlevel 2 exit /b 0
if errorlevel 1 exit /b 1

echo.
echo   ============================================================
echo     EvEJS - Install Rust For Market
echo   ============================================================
echo.
echo   This installs and verifies the Windows build stack used by
echo   the optional standalone market builder and market server:
echo.
echo     - Rust / cargo
echo     - Visual Studio Build Tools C++ workload
echo     - MSVC link.exe / cl.exe
echo     - Cargo linker wrapper for normal double-clicked consoles
echo.

call :ResolveWinget
if errorlevel 1 goto WingetMissing

echo   Step 1/5 - Installing or repairing Visual Studio C++ Build Tools...
call :EnsureVisualCppBuildTools
if errorlevel 1 goto Fail

echo.
echo   Step 2/5 - Installing or refreshing rustup with winget...
"%WINGET_EXE%" install -e --id Rustlang.Rustup --accept-package-agreements --accept-source-agreements
set "EVEJS_EXIT=%errorlevel%"
if not "%EVEJS_EXIT%"=="0" (
  echo.
  echo   [!] winget returned a non-zero Rust install code.
  echo       Exit code: %EVEJS_EXIT%
  echo       Continuing if rustup is already available...
)

set "PATH=%CARGO_BIN%;%PATH%"

echo.
echo   Step 3/5 - Installing the stable Rust MSVC toolchain...
call :InstallStableToolchain
if errorlevel 1 goto Fail

echo.
echo   Step 4/5 - Configuring cargo to find the MSVC linker...
call :VerifyVisualCppEnvironment
if errorlevel 1 goto Fail
call :WriteCargoMsvcLinkWrapper
if errorlevel 1 goto Fail
call :ConfigureCargoMsvcLinker
if errorlevel 1 goto Fail

echo.
echo   Step 5/5 - Verifying Rust, cargo, and market compilation...
call :VerifyCargo
if errorlevel 1 goto Fail
call :VerifyRustc
if errorlevel 1 goto Fail
call :VerifyMarketCargoBuild
if errorlevel 1 goto Fail

echo.
echo   Rust and MSVC are ready for the standalone market tools.
echo.
echo   Next steps:
echo     1. Run BuildMarketSeed.bat
echo     2. Build the market database
echo     3. Run StartMarketServer.bat
echo.
pause
exit /b 0

:EnsureAdmin
"%POWERSHELL_EXE%" -NoProfile -Command "if (([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 0 } else { exit 1 }"
if "%errorlevel%"=="0" exit /b 0

echo.
echo   Asking Windows for Administrator permission...
set "EVEJS_INSTALLER_SELF=%~f0"
set "EVEJS_INSTALLER_DIR=%~dp0"
"%POWERSHELL_EXE%" -NoProfile -Command "$argsList = @('/c', ('\"' + $env:EVEJS_INSTALLER_SELF + '\"')); Start-Process -FilePath $env:ComSpec -WorkingDirectory $env:EVEJS_INSTALLER_DIR -ArgumentList $argsList -Verb RunAs"
if not "%errorlevel%"=="0" (
  echo.
  echo   [!] Administrator approval was cancelled.
  pause
  exit /b 1
)
exit /b 2

:ResolveWinget
if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe" (
  set "WINGET_EXE=%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe"
  exit /b 0
)

for /f "delims=" %%I in ('where winget 2^>nul') do (
  set "WINGET_EXE=%%I"
  exit /b 0
)

exit /b 1

:ResolveVsWhere
if exist "%VSWHERE_EXE%" exit /b 0
for /f "delims=" %%I in ('where vswhere 2^>nul') do (
  set "VSWHERE_EXE=%%I"
  exit /b 0
)
exit /b 1

:ResolveVisualCppInstall
set "VS_INSTALL_PATH="
set "VCVARS64_BAT="
call :ResolveVsWhere
if errorlevel 1 exit /b 1

for /f "usebackq delims=" %%I in (`"%VSWHERE_EXE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2^>nul`) do (
  set "VS_INSTALL_PATH=%%I"
)

if defined VS_INSTALL_PATH (
  if exist "%VS_INSTALL_PATH%\VC\Auxiliary\Build\vcvars64.bat" (
    set "VCVARS64_BAT=%VS_INSTALL_PATH%\VC\Auxiliary\Build\vcvars64.bat"
    exit /b 0
  )
)

exit /b 1

:ResolveAnyVisualStudioInstall
set "VS_INSTALL_PATH="
call :ResolveVsWhere
if errorlevel 1 exit /b 1

for /f "usebackq delims=" %%I in (`"%VSWHERE_EXE%" -latest -products * -property installationPath 2^>nul`) do (
  set "VS_INSTALL_PATH=%%I"
)

if defined VS_INSTALL_PATH exit /b 0
exit /b 1

:EnsureVisualCppBuildTools
call :ResolveVisualCppInstall
if not errorlevel 1 (
  echo   Visual C++ Build Tools already installed:
  echo       %VS_INSTALL_PATH%
  exit /b 0
)

echo   Installing Visual Studio 2022 Build Tools with the C++ workload...
"%WINGET_EXE%" install -e --id Microsoft.VisualStudio.2022.BuildTools --accept-package-agreements --accept-source-agreements --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

call :ResolveVisualCppInstall
if not errorlevel 1 exit /b 0

echo.
echo   Build Tools are installed or partially installed, but the C++ workload
echo   was not detected yet. Attempting a direct Visual Studio Installer repair...
call :ModifyVisualStudioCppWorkload
if errorlevel 1 exit /b 1

call :ResolveVisualCppInstall
if not errorlevel 1 exit /b 0

echo.
echo   [!] Visual Studio C++ Build Tools could not be verified.
echo       Missing component: Microsoft.VisualStudio.Component.VC.Tools.x86.x64
exit /b 1

:ModifyVisualStudioCppWorkload
if not exist "%VS_INSTALLER_EXE%" (
  echo   [!] Visual Studio Installer was not found:
  echo       %VS_INSTALLER_EXE%
  exit /b 1
)

call :ResolveAnyVisualStudioInstall
if errorlevel 1 (
  echo   [!] No Visual Studio installation was found to repair.
  exit /b 1
)

"%VS_INSTALLER_EXE%" modify --installPath "%VS_INSTALL_PATH%" --quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended
if errorlevel 1 exit /b 1
exit /b 0

:InstallStableToolchain
if exist "%RUSTUP_EXE%" goto UseRustupExe

for /f "delims=" %%I in ('where rustup 2^>nul') do (
  set "RUSTUP_EXE=%%I"
  goto UseRustupExe
)

if exist "%RUSTUP_INIT_EXE%" goto UseRustupInitExe

for /f "delims=" %%I in ('where rustup-init 2^>nul') do (
  set "RUSTUP_INIT_EXE=%%I"
  goto UseRustupInitExe
)

echo   [!] rustup was not found after the winget install finished.
echo       Close this window, open a fresh terminal, and try again once.
exit /b 1

:UseRustupExe
"%RUSTUP_EXE%" set profile default
if errorlevel 1 exit /b 1
"%RUSTUP_EXE%" toolchain install stable-x86_64-pc-windows-msvc
if errorlevel 1 exit /b 1
"%RUSTUP_EXE%" default stable-x86_64-pc-windows-msvc
if errorlevel 1 exit /b 1
exit /b 0

:UseRustupInitExe
"%RUSTUP_INIT_EXE%" -y --default-toolchain stable-x86_64-pc-windows-msvc --profile default
if errorlevel 1 exit /b 1
exit /b 0

:VerifyVisualCppEnvironment
call :ResolveVisualCppInstall
if errorlevel 1 (
  echo   [!] Visual C++ Build Tools are not installed correctly.
  exit /b 1
)

call "%VCVARS64_BAT%" >nul
if errorlevel 1 (
  echo   [!] Failed to initialize the Visual C++ build environment:
  echo       %VCVARS64_BAT%
  exit /b 1
)

where link.exe >nul 2>&1
if errorlevel 1 (
  echo   [!] link.exe was not found after initializing Visual C++.
  exit /b 1
)

where cl.exe >nul 2>&1
if errorlevel 1 (
  echo   [!] cl.exe was not found after initializing Visual C++.
  exit /b 1
)

for /f "delims=" %%I in ('where link.exe 2^>nul') do (
  echo   MSVC linker: %%I
  goto LinkEchoDone
)
:LinkEchoDone
exit /b 0

:WriteCargoMsvcLinkWrapper
if not exist "%CARGO_BIN%" mkdir "%CARGO_BIN%" >nul 2>&1

(
  echo @echo off
  echo call "%VCVARS64_BAT%" ^>nul
  echo if errorlevel 1 exit /b %%errorlevel%%
  echo link.exe %%*
  echo exit /b %%errorlevel%%
) > "%MSVC_LINK_WRAPPER%"

if not exist "%MSVC_LINK_WRAPPER%" (
  echo   [!] Failed to write cargo MSVC linker wrapper:
  echo       %MSVC_LINK_WRAPPER%
  exit /b 1
)

echo   Cargo MSVC linker wrapper:
echo       %MSVC_LINK_WRAPPER%
exit /b 0

:ConfigureCargoMsvcLinker
set "EVEJS_MSVC_LINK_WRAPPER=%MSVC_LINK_WRAPPER%"
set "EVEJS_CONFIG_PS=%TEMP%\evejs-cargo-msvc-linker-%RANDOM%-%RANDOM%.ps1"

> "%EVEJS_CONFIG_PS%" echo $ErrorActionPreference = 'Stop'
>> "%EVEJS_CONFIG_PS%" echo $cfgDir = Join-Path $env:USERPROFILE '.cargo'
>> "%EVEJS_CONFIG_PS%" echo $cfg = Join-Path $cfgDir 'config.toml'
>> "%EVEJS_CONFIG_PS%" echo New-Item -ItemType Directory -Force -Path $cfgDir ^| Out-Null
>> "%EVEJS_CONFIG_PS%" echo $linker = ($env:EVEJS_MSVC_LINK_WRAPPER -replace '\\', '\\')
>> "%EVEJS_CONFIG_PS%" echo $line = 'linker = "' + $linker + '"'
>> "%EVEJS_CONFIG_PS%" echo $sectionHeader = '[target.x86_64-pc-windows-msvc]'
>> "%EVEJS_CONFIG_PS%" echo $text = if (Test-Path -LiteralPath $cfg) { Get-Content -LiteralPath $cfg -Raw } else { '' }
>> "%EVEJS_CONFIG_PS%" echo $pattern = '(?ms)^^\[target\.x86_64-pc-windows-msvc\]\s*(.*?)(?=^^\[^|\z)'
>> "%EVEJS_CONFIG_PS%" echo if ($text -match $pattern) {
>> "%EVEJS_CONFIG_PS%" echo   $section = $Matches[0]
>> "%EVEJS_CONFIG_PS%" echo   if ($section -match '(?m)^^\s*linker\s*=') {
>> "%EVEJS_CONFIG_PS%" echo     $newSection = [regex]::Replace($section, '(?m)^^\s*linker\s*=.*$', $line, 1)
>> "%EVEJS_CONFIG_PS%" echo   } else {
>> "%EVEJS_CONFIG_PS%" echo     $newSection = $section.TrimEnd() + [Environment]::NewLine + $line + [Environment]::NewLine
>> "%EVEJS_CONFIG_PS%" echo   }
>> "%EVEJS_CONFIG_PS%" echo   $text = [regex]::Replace($text, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $newSection }, 1)
>> "%EVEJS_CONFIG_PS%" echo } else {
>> "%EVEJS_CONFIG_PS%" echo   if ($text.Length -gt 0 -and -not $text.EndsWith([Environment]::NewLine)) { $text += [Environment]::NewLine }
>> "%EVEJS_CONFIG_PS%" echo   $text += [Environment]::NewLine + $sectionHeader + [Environment]::NewLine + $line + [Environment]::NewLine
>> "%EVEJS_CONFIG_PS%" echo }
>> "%EVEJS_CONFIG_PS%" echo Set-Content -LiteralPath $cfg -Value $text -Encoding UTF8

"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%EVEJS_CONFIG_PS%"
set "EVEJS_EXIT=%errorlevel%"
del "%EVEJS_CONFIG_PS%" >nul 2>&1
if not "%EVEJS_EXIT%"=="0" (
  echo   [!] Failed to update cargo config.toml.
  exit /b 1
)

echo   Cargo config updated for x86_64-pc-windows-msvc.
exit /b 0

:VerifyCargo
if exist "%CARGO_EXE%" (
  "%CARGO_EXE%" --version
  if errorlevel 1 exit /b 1
  exit /b 0
)

for /f "delims=" %%I in ('where cargo 2^>nul') do (
  set "CARGO_EXE=%%I"
  "%%I" --version
  if errorlevel 1 exit /b 1
  exit /b 0
)

echo   [!] cargo.exe was not found after installation.
echo       Try closing this window, opening a new terminal, and running the script again.
exit /b 1

:VerifyRustc
if exist "%RUSTC_EXE%" (
  "%RUSTC_EXE%" --version
  if errorlevel 1 exit /b 1
  exit /b 0
)

for /f "delims=" %%I in ('where rustc 2^>nul') do (
  set "RUSTC_EXE=%%I"
  "%%I" --version
  if errorlevel 1 exit /b 1
  exit /b 0
)

echo   [!] rustc.exe was not found after installation.
echo       Try closing this window, opening a new terminal, and running the script again.
exit /b 1

:VerifyMarketCargoBuild
if not exist "%MARKET_SEED_DIR%\Cargo.toml" (
  echo   Market seed project not found; skipping market compile verification.
  exit /b 0
)

echo   Compiling market seed once to verify the linker...
pushd "%MARKET_SEED_DIR%"
"%CARGO_EXE%" build --release
set "EVEJS_EXIT=%errorlevel%"
popd
if not "%EVEJS_EXIT%"=="0" (
  echo.
  echo   [!] Market seed compile verification failed.
  echo       This usually means Windows still cannot see the MSVC linker.
  exit /b 1
)

if exist "%MARKET_SERVER_DIR%\Cargo.toml" (
  echo.
  echo   Compiling market server once to verify the shared market stack...
  pushd "%MARKET_SERVER_DIR%"
  "%CARGO_EXE%" build --release
  set "EVEJS_EXIT=%errorlevel%"
  popd
  if not "%EVEJS_EXIT%"=="0" (
    echo.
    echo   [!] Market server compile verification failed.
    exit /b 1
  )
)

exit /b 0

:WingetMissing
echo.
echo   [!] winget was not found on this Windows install.
echo       Install or update "App Installer" from the Microsoft Store,
echo       then run this script again.
echo.
pause
exit /b 1

:Fail
echo.
echo   Rust / MSVC setup did not finish cleanly.
echo.
echo   The most common cause is the Visual Studio Build Tools installer
echo   requiring a Windows restart. If Windows asks to restart, restart,
echo   then run this installer again.
echo.
pause
exit /b 1
