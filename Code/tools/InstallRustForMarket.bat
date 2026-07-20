@echo off
setlocal EnableExtensions
title EvEJS - Install Rust For Market
set "EVEJS_INSTALL_RUST_MARKET_VERSION=v9.0.11"

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
set "VS_BUILDTOOLS_BOOTSTRAPPER_URL=https://aka.ms/vs/17/release/vs_BuildTools.exe"
set "WINDOWS_SDK_COMPONENT_PRIMARY=Microsoft.VisualStudio.Component.Windows11SDK.26100"
set "WINDOWS_SDK_COMPONENT_FALLBACK1=Microsoft.VisualStudio.Component.Windows11SDK.22621"
set "WINDOWS_SDK_COMPONENT_FALLBACK2=Microsoft.VisualStudio.Component.Windows10SDK.20348"
set "WINDOWS_SDK_COMPONENT_FALLBACK3=Microsoft.VisualStudio.Component.Windows10SDK.19041"
set "WINGET_EXE="
set "VS_INSTALL_PATH="
set "VCVARS64_BAT="
set "EVEJS_KERNEL32_LIB="
set "EVEJS_EXIT=0"

call :PrintHeader
call :FastPathReady
if not errorlevel 1 goto AlreadyReady

call :EnsureAdmin
if errorlevel 2 exit /b 0
if errorlevel 1 exit /b 1

echo.
echo   Admin rights confirmed. Installing or repairing missing components...
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

:PrintHeader
echo.
echo   ============================================================
echo     EvEJS - Install Rust For Market %EVEJS_INSTALL_RUST_MARKET_VERSION%
echo   ============================================================
echo.
echo   This installs and verifies the Windows build stack used by
echo   the optional standalone market builder and market server:
echo.
echo     - Rust / cargo
echo     - Visual Studio Build Tools C++ workload
echo     - MSVC link.exe / cl.exe
echo     - Windows SDK libraries such as kernel32.lib
echo     - Cargo linker wrapper for normal double-clicked consoles
echo.
exit /b 0

:EchoIndentedValue
echo       %~1
exit /b 0

:AlreadyReady
echo   Existing Rust/MSVC market build stack is already ready.
echo.
if defined CARGO_EXE echo   Cargo:       %CARGO_EXE%
if defined RUSTC_EXE echo   Rustc:       %RUSTC_EXE%
if defined VCVARS64_BAT echo   MSVC env:    %VCVARS64_BAT%
if defined EVEJS_KERNEL32_LIB echo   SDK lib:     %EVEJS_KERNEL32_LIB%
if exist "%MSVC_LINK_WRAPPER%" echo   Linker cfg:  %MSVC_LINK_WRAPPER%
echo.
echo   No Administrator permission was needed.
echo.
echo   Next steps:
echo     1. Run BuildMarketSeed.bat
echo     2. Build the market database
echo     3. Run StartMarketServer.bat
echo.
pause
exit /b 0

:FastPathReady
set "PATH=%CARGO_BIN%;%PATH%"
call :ResolveCargoQuiet
if errorlevel 1 exit /b 1
call :ResolveRustcQuiet
if errorlevel 1 exit /b 1
call :ResolveVisualCppInstall >nul 2>&1
if errorlevel 1 exit /b 1
call :VerifyVisualCppEnvironmentQuiet
if errorlevel 1 exit /b 1
if exist "%MSVC_LINK_WRAPPER%" goto FastPathWrapperReady
call :WriteCargoMsvcLinkWrapper >nul 2>&1
if errorlevel 1 exit /b 1
:FastPathWrapperReady
call :ConfigureCargoMsvcLinker >nul 2>&1
if errorlevel 1 exit /b 1
exit /b 0

:ResolveCargoQuiet
if exist "%CARGO_EXE%" exit /b 0
for /f "delims=" %%I in ('where cargo 2^>nul') do (
  set "CARGO_EXE=%%I"
  exit /b 0
)
exit /b 1

:ResolveRustcQuiet
if exist "%RUSTC_EXE%" exit /b 0
for /f "delims=" %%I in ('where rustc 2^>nul') do (
  set "RUSTC_EXE=%%I"
  exit /b 0
)
exit /b 1

:VerifyVisualCppEnvironmentQuiet
call "%VCVARS64_BAT%" >nul 2>&1
if errorlevel 1 exit /b 1
where link.exe >nul 2>&1
if errorlevel 1 exit /b 1
where cl.exe >nul 2>&1
if errorlevel 1 exit /b 1
set "EVEJS_KERNEL32_LIB="
call :FindKernel32InLibPath
if not defined EVEJS_KERNEL32_LIB exit /b 1
exit /b 0

:FindKernel32InLibPath
set "EVEJS_KERNEL32_LIB="
set "EVEJS_KERNEL32_RESULT=%TEMP%\evejs-kernel32-lib-%RANDOM%-%RANDOM%.txt"
"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'SilentlyContinue'; foreach ($p in ($env:LIB -split ';')) { if ([string]::IsNullOrWhiteSpace($p)) { continue }; $candidate = Join-Path $p 'kernel32.lib'; if (Test-Path -LiteralPath $candidate) { [Console]::Out.WriteLine($candidate); exit 0 } }; exit 1" > "%EVEJS_KERNEL32_RESULT%" 2>nul
if errorlevel 1 goto FindKernel32InLibPathFailed
set /p EVEJS_KERNEL32_LIB=< "%EVEJS_KERNEL32_RESULT%"
del "%EVEJS_KERNEL32_RESULT%" >nul 2>&1
exit /b 0

:FindKernel32InLibPathFailed
del "%EVEJS_KERNEL32_RESULT%" >nul 2>&1
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
if not exist "%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe" goto ResolveWingetFromPath
set "WINGET_EXE=%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe"
exit /b 0

:ResolveWingetFromPath
set "EVEJS_WHERE_RESULT=%TEMP%\evejs-where-winget-%RANDOM%-%RANDOM%.txt"
where winget > "%EVEJS_WHERE_RESULT%" 2>nul
if errorlevel 1 goto ResolveWingetFailed
set /p WINGET_EXE=< "%EVEJS_WHERE_RESULT%"
del "%EVEJS_WHERE_RESULT%" >nul 2>&1
if defined WINGET_EXE exit /b 0

:ResolveWingetFailed
del "%EVEJS_WHERE_RESULT%" >nul 2>&1
exit /b 1

:ResolveVsWhere
if exist "%VSWHERE_EXE%" exit /b 0
set "EVEJS_WHERE_RESULT=%TEMP%\evejs-where-vswhere-%RANDOM%-%RANDOM%.txt"
where vswhere > "%EVEJS_WHERE_RESULT%" 2>nul
if errorlevel 1 goto ResolveVsWhereFailed
set /p VSWHERE_EXE=< "%EVEJS_WHERE_RESULT%"
del "%EVEJS_WHERE_RESULT%" >nul 2>&1
if defined VSWHERE_EXE exit /b 0

:ResolveVsWhereFailed
del "%EVEJS_WHERE_RESULT%" >nul 2>&1
exit /b 1

:ResolveVisualCppInstall
set "VS_INSTALL_PATH="
set "VCVARS64_BAT="
call :ResolveVsWhere
if errorlevel 1 exit /b 1

call :QueryVisualStudioInstall "Microsoft.VisualStudio.Component.VC.Tools.x86.x64"
if errorlevel 1 exit /b 1

if not defined VS_INSTALL_PATH exit /b 1
if not exist "%VS_INSTALL_PATH%\VC\Auxiliary\Build\vcvars64.bat" exit /b 1
set "VCVARS64_BAT=%VS_INSTALL_PATH%\VC\Auxiliary\Build\vcvars64.bat"
exit /b 0

:ResolveAnyVisualStudioInstall
set "VS_INSTALL_PATH="
call :ResolveVsWhere
if errorlevel 1 exit /b 1

call :QueryVisualStudioInstall
if errorlevel 1 exit /b 1

if defined VS_INSTALL_PATH exit /b 0
exit /b 1

:QueryVisualStudioInstall
set "VS_INSTALL_PATH="
set "EVEJS_VS_QUERY_REQUIRES=%~1"
set "EVEJS_VSWHERE_EXE=%VSWHERE_EXE%"
set "EVEJS_VS_QUERY_RESULT=%TEMP%\evejs-vswhere-%RANDOM%-%RANDOM%.txt"
"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; $vs = $env:EVEJS_VSWHERE_EXE; if (-not (Test-Path -LiteralPath $vs)) { exit 1 }; $args = @('-latest', '-products', '*'); if ($env:EVEJS_VS_QUERY_REQUIRES) { $args += @('-requires', $env:EVEJS_VS_QUERY_REQUIRES) }; $args += @('-property', 'installationPath'); & $vs @args | Select-Object -First 1" > "%EVEJS_VS_QUERY_RESULT%" 2>nul
if errorlevel 1 goto QueryVisualStudioInstallFailed
set /p VS_INSTALL_PATH=< "%EVEJS_VS_QUERY_RESULT%"
del "%EVEJS_VS_QUERY_RESULT%" >nul 2>&1
if defined VS_INSTALL_PATH exit /b 0

:QueryVisualStudioInstallFailed
del "%EVEJS_VS_QUERY_RESULT%" >nul 2>&1
exit /b 1

:EnsureVisualCppBuildTools
call :ResolveVisualCppInstall
if errorlevel 1 goto InstallVisualCppBuildTools

call :VerifyWindowsSdkLib
if errorlevel 1 goto RepairExistingVisualCppBuildTools

echo   Visual C++ Build Tools and Windows SDK already installed:
call :EchoIndentedValue "%VS_INSTALL_PATH%"
exit /b 0

:RepairExistingVisualCppBuildTools
echo.
echo   Visual C++ Build Tools are installed, but Windows SDK libraries
echo   are missing or not visible to the MSVC environment.
echo   Repairing the C++ workload so kernel32.lib is available...
echo   This can take several minutes. Visual Studio Installer is not very
echo   chatty here; the spinner may sit still while it downloads SDK payloads.
call :ModifyVisualStudioCppWorkload
if errorlevel 1 exit /b 1

call :ResolveVisualCppInstall
if errorlevel 1 goto VisualCppDirectRepairFailed

call :VerifyWindowsSdkLib
if not errorlevel 1 exit /b 0

:VisualCppDirectRepairFailed
echo.
echo   Direct repair did not expose kernel32.lib yet.
echo   Windows may need a restart, or the SDK install may still be pending.
exit /b 1

:InstallVisualCppBuildTools
echo   Installing Visual Studio 2022 Build Tools with the C++ workload and Windows SDK...
echo   This can take several minutes. Visual Studio Installer is not very
echo   chatty here; the spinner may sit still while it downloads SDK payloads.
call :InstallVisualCppBuildToolsWithWinget
if not errorlevel 1 goto VisualCppInstallCommandFinished

echo.
echo   winget did not finish the Build Tools install cleanly.
echo   Trying the official Visual Studio Build Tools bootstrapper directly...
call :InstallVisualCppBuildToolsDirect
if errorlevel 1 goto VisualCppWingetInstallNeedsRepair

:VisualCppInstallCommandFinished
call :WaitForVisualStudioRegistration
if not errorlevel 1 goto VisualCppInstallRegistrationReady

echo.
echo   Build Tools installer finished, but no Visual Studio instance was registered yet.
echo   Trying the official Visual Studio Build Tools bootstrapper directly...
call :InstallVisualCppBuildToolsDirect
if errorlevel 1 goto VisualCppWingetInstallNeedsRepair
call :WaitForVisualStudioRegistration
if errorlevel 1 goto VisualCppWingetInstallNeedsRepair

:VisualCppInstallRegistrationReady

call :ResolveVisualCppInstall
if errorlevel 1 goto VisualCppWingetInstallNeedsRepair

call :VerifyWindowsSdkLib
if not errorlevel 1 exit /b 0

:VisualCppWingetInstallNeedsRepair
echo.
echo   Build Tools are installed or partially installed, but the C++ workload
echo   or Windows SDK library path was not detected yet. Attempting a direct
echo   Visual Studio Installer repair...
call :ModifyVisualStudioCppWorkload
if errorlevel 1 exit /b 1

call :ResolveVisualCppInstall
if errorlevel 1 goto VisualCppInstallFailed

call :VerifyWindowsSdkLib
if not errorlevel 1 exit /b 0

:VisualCppInstallFailed
echo.
echo   [!] Visual Studio C++ Build Tools and Windows SDK could not be verified.
echo       Missing component: Microsoft.VisualStudio.Component.VC.Tools.x86.x64
echo       Missing SDK lib:  kernel32.lib
exit /b 1

:ModifyVisualStudioCppWorkload
if exist "%VS_INSTALLER_EXE%" goto VisualStudioInstallerFound
echo   [!] Visual Studio Installer was not found:
echo       %VS_INSTALLER_EXE%
exit /b 1

:VisualStudioInstallerFound

call :ResolveAnyVisualStudioInstall
if errorlevel 1 goto NoVisualStudioInstallToRepair

call :ModifyVisualStudioCppWorkloadWithSdk "%WINDOWS_SDK_COMPONENT_PRIMARY%"
if not errorlevel 1 exit /b 0

call :ModifyVisualStudioCppWorkloadWithSdk "%WINDOWS_SDK_COMPONENT_FALLBACK1%"
if not errorlevel 1 exit /b 0

call :ModifyVisualStudioCppWorkloadWithSdk "%WINDOWS_SDK_COMPONENT_FALLBACK2%"
if not errorlevel 1 exit /b 0

call :ModifyVisualStudioCppWorkloadWithSdk "%WINDOWS_SDK_COMPONENT_FALLBACK3%"
if not errorlevel 1 exit /b 0

echo   [!] Visual Studio Installer could not add a supported Windows SDK.
exit /b 1

:ModifyVisualStudioCppWorkloadWithSdk
set "EVEJS_SDK_COMPONENT=%~1"
echo   Repairing C++ workload with %EVEJS_SDK_COMPONENT%...
"%VS_INSTALLER_EXE%" modify --installPath "%VS_INSTALL_PATH%" --quiet --norestart --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add "%EVEJS_SDK_COMPONENT%" --includeRecommended
if errorlevel 1 exit /b 1
exit /b 0

:NoVisualStudioInstallToRepair
echo   No registered Visual Studio installation was found to repair.
echo   Running the official Visual Studio Build Tools bootstrapper directly...
call :InstallVisualCppBuildToolsDirect
if errorlevel 1 exit /b 1
call :WaitForVisualStudioRegistration
if errorlevel 1 exit /b 1
exit /b 0

:InstallVisualCppBuildToolsWithWinget
"%WINGET_EXE%" install -e --id Microsoft.VisualStudio.2022.BuildTools --accept-package-agreements --accept-source-agreements --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add %WINDOWS_SDK_COMPONENT_PRIMARY% --includeRecommended"
exit /b %errorlevel%

:InstallVisualCppBuildToolsDirect
set "EVEJS_VS_BOOTSTRAPPER=%TEMP%\evejs-vs_BuildTools-%RANDOM%-%RANDOM%.exe"
set "EVEJS_VS_BOOTSTRAPPER_EXE=%EVEJS_VS_BOOTSTRAPPER%"
set "EVEJS_VS_BOOTSTRAPPER_URL=%VS_BUILDTOOLS_BOOTSTRAPPER_URL%"
set "EVEJS_VS_BOOTSTRAPPER_SDK=%WINDOWS_SDK_COMPONENT_PRIMARY%"

echo   Downloading Visual Studio Build Tools bootstrapper...
"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri $env:EVEJS_VS_BOOTSTRAPPER_URL -OutFile $env:EVEJS_VS_BOOTSTRAPPER_EXE"
if errorlevel 1 goto InstallVisualCppBuildToolsDirectFailed

echo   Running Visual Studio Build Tools bootstrapper...
"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; $args = @('--quiet', '--wait', '--norestart', '--add', 'Microsoft.VisualStudio.Workload.VCTools', '--add', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '--add', $env:EVEJS_VS_BOOTSTRAPPER_SDK, '--includeRecommended'); $p = Start-Process -FilePath $env:EVEJS_VS_BOOTSTRAPPER_EXE -ArgumentList $args -Wait -PassThru; exit $p.ExitCode"
set "EVEJS_EXIT=%errorlevel%"
del "%EVEJS_VS_BOOTSTRAPPER%" >nul 2>&1
exit /b %EVEJS_EXIT%

:InstallVisualCppBuildToolsDirectFailed
del "%EVEJS_VS_BOOTSTRAPPER%" >nul 2>&1
exit /b 1

:WaitForVisualStudioRegistration
set /a EVEJS_VS_WAIT_COUNT=0
:WaitForVisualStudioRegistrationLoop
call :ResolveAnyVisualStudioInstall >nul 2>&1
if not errorlevel 1 exit /b 0
set /a EVEJS_VS_WAIT_COUNT+=1
if %EVEJS_VS_WAIT_COUNT% GEQ 12 exit /b 1
"%POWERSHELL_EXE%" -NoProfile -Command "Start-Sleep -Seconds 5"
goto WaitForVisualStudioRegistrationLoop

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
if errorlevel 1 goto VisualCppInstallMissing

call "%VCVARS64_BAT%" >nul
if errorlevel 1 goto VisualCppEnvInitFailed

where link.exe >nul 2>&1
if errorlevel 1 goto LinkExeMissing

where cl.exe >nul 2>&1
if errorlevel 1 goto ClExeMissing

call :VerifyWindowsSdkLib
if errorlevel 1 exit /b 1

for /f "delims=" %%I in ('where link.exe 2^>nul') do (
  echo   MSVC linker: %%I
  goto LinkEchoDone
)
:LinkEchoDone
exit /b 0

:VisualCppInstallMissing
echo   [!] Visual C++ Build Tools are not installed correctly.
exit /b 1

:VisualCppEnvInitFailed
echo   [!] Failed to initialize the Visual C++ build environment:
call :EchoIndentedValue "%VCVARS64_BAT%"
exit /b 1

:LinkExeMissing
echo   [!] link.exe was not found after initializing Visual C++.
exit /b 1

:ClExeMissing
echo   [!] cl.exe was not found after initializing Visual C++.
exit /b 1

:VerifyWindowsSdkLib
set "EVEJS_KERNEL32_LIB="
if defined VCVARS64_BAT goto VerifyWindowsSdkLibHaveVcvars
call :ResolveVisualCppInstall
if errorlevel 1 exit /b 1
:VerifyWindowsSdkLibHaveVcvars

call "%VCVARS64_BAT%" >nul
if errorlevel 1 goto VisualCppEnvInitFailed

call :FindKernel32InLibPath
if defined EVEJS_KERNEL32_LIB goto Kernel32Found

call :FindKernel32InSdkRoot "%ProgramFiles(x86)%\Windows Kits\10\Lib"
if defined EVEJS_KERNEL32_LIB goto Kernel32FoundButNotInLib
call :FindKernel32InSdkRoot "%ProgramFiles%\Windows Kits\10\Lib"
if defined EVEJS_KERNEL32_LIB goto Kernel32FoundButNotInLib

echo   [!] Windows SDK library kernel32.lib was not found.
echo       Rust found MSVC link.exe, but Windows SDK libs are missing.
echo       Install/repair Visual Studio Build Tools with a Windows 10/11 SDK,
echo       then restart Windows if the installer asks.
exit /b 1

:FindKernel32InSdkRoot
set "EVEJS_SDK_LIB_ROOT=%~1"
if not defined EVEJS_SDK_LIB_ROOT exit /b 0
if not exist "%EVEJS_SDK_LIB_ROOT%" exit /b 0
set "EVEJS_KERNEL32_RESULT=%TEMP%\evejs-sdk-kernel32-%RANDOM%-%RANDOM%.txt"
"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'SilentlyContinue'; $root = $env:EVEJS_SDK_LIB_ROOT; if (-not (Test-Path -LiteralPath $root)) { exit 1 }; Get-ChildItem -LiteralPath $root -Directory | Sort-Object Name -Descending | ForEach-Object { $candidate = Join-Path $_.FullName 'um\x64\kernel32.lib'; if (Test-Path -LiteralPath $candidate) { [Console]::Out.WriteLine($candidate); exit 0 } }; exit 1" > "%EVEJS_KERNEL32_RESULT%" 2>nul
if errorlevel 1 goto FindKernel32InSdkRootFailed
set /p EVEJS_KERNEL32_LIB=< "%EVEJS_KERNEL32_RESULT%"
del "%EVEJS_KERNEL32_RESULT%" >nul 2>&1
exit /b 0

:FindKernel32InSdkRootFailed
del "%EVEJS_KERNEL32_RESULT%" >nul 2>&1
exit /b 0

:Kernel32FoundButNotInLib
echo   [!] Windows SDK kernel32.lib exists, but vcvars64.bat did not add it to LIB:
echo       %EVEJS_KERNEL32_LIB%
echo       This usually means the Visual Studio environment is half-installed
echo       or Windows needs a restart after Build Tools setup.
exit /b 1

:Kernel32Found
echo   Windows SDK lib: %EVEJS_KERNEL32_LIB%
exit /b 0

:WriteCargoMsvcLinkWrapper
if not exist "%CARGO_BIN%" mkdir "%CARGO_BIN%" >nul 2>&1

> "%MSVC_LINK_WRAPPER%" echo @echo off
>> "%MSVC_LINK_WRAPPER%" echo call "%VCVARS64_BAT%" ^>nul
>> "%MSVC_LINK_WRAPPER%" echo if errorlevel 1 exit /b %%errorlevel%%
>> "%MSVC_LINK_WRAPPER%" echo link.exe %%*
>> "%MSVC_LINK_WRAPPER%" echo exit /b %%errorlevel%%

if exist "%MSVC_LINK_WRAPPER%" goto CargoMsvcLinkWrapperWritten
echo   [!] Failed to write cargo MSVC linker wrapper:
call :EchoIndentedValue "%MSVC_LINK_WRAPPER%"
exit /b 1

:CargoMsvcLinkWrapperWritten

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
  echo       This usually means Windows still cannot see the MSVC linker
  echo       or Windows SDK libraries such as kernel32.lib.
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
