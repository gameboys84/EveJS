@echo off
setlocal EnableDelayedExpansion
title PublicEveJS - TQ Market Snapshot Seeder

for %%I in ("%~dp0..\..") do set "PUBLIC_EVEJS_REPO_ROOT=%%~fI"
set "MARKET_SEEDER_V2_DIR=%PUBLIC_EVEJS_REPO_ROOT%\tools\market-seederv2"
set "MARKET_SEEDER_V2_CONFIG=%MARKET_SEEDER_V2_DIR%\config\market-seederv2.local.toml"
set "PUBLIC_EVEJS_LOCAL_DATABASE_ROOT=%PUBLIC_EVEJS_REPO_ROOT%\_local\gameStore"
set "EVEJS_GAMESTORE_DATA_DIR=%PUBLIC_EVEJS_LOCAL_DATABASE_ROOT%\data"
set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "VSWHERE_EXE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
set "VS_INSTALL_PATH="
set "VCVARS64_BAT="
set "EVEJS_STDARG_HEADER="
set "EVEJS_VCRUNTIME_HEADER="

call :ResolveCargo
if errorlevel 1 exit /b 1
call :InitializeMsvcBuildEnvironment
if errorlevel 1 exit /b 1

if not exist "%MARKET_SEEDER_V2_DIR%\Cargo.toml" (
  echo.
  echo   [!] Market seeder v2 project not found at:
  echo       %MARKET_SEEDER_V2_DIR%
  pause
  exit /b 1
)

if /i "%~1"=="doctor" goto Doctor
if /i "%~1"=="info" goto SnapshotInfo
if /i "%~1"=="build-release" goto BuildRelease
if /i "%~1"=="edit-config" goto EditConfig
if /i "%~1"=="yes" goto BuildYes

echo.
echo   ============================================================
echo     PublicEveJS - TQ Market Snapshot Seeder v2
echo   ============================================================
echo.
echo     [1] Build latest TQ station-market snapshot
echo     [2] Snapshot info only
echo     [3] Doctor - inspect current output database
echo     [4] Build release binary only
echo     [5] Edit v2 config
echo.
choice /c 12345 /n /m "  Choose [1-5]: "
echo.

if errorlevel 5 goto EditConfig
if errorlevel 4 goto BuildRelease
if errorlevel 3 goto Doctor
if errorlevel 2 goto SnapshotInfo
if errorlevel 1 goto Build

:Build
call :EnsureLocalDatabase
if errorlevel 1 exit /b 1
pushd "%MARKET_SEEDER_V2_DIR%"
"%CARGO_EXE%" run --release -- --config config/market-seederv2.local.toml build
set "PUBLIC_EVEJS_EXIT=%errorlevel%"
popd
goto Finish

:BuildYes
call :EnsureLocalDatabase
if errorlevel 1 exit /b 1
pushd "%MARKET_SEEDER_V2_DIR%"
"%CARGO_EXE%" run --release -- --config config/market-seederv2.local.toml build --yes
set "PUBLIC_EVEJS_EXIT=%errorlevel%"
popd
goto Finish

:SnapshotInfo
pushd "%MARKET_SEEDER_V2_DIR%"
"%CARGO_EXE%" run --release -- --config config/market-seederv2.local.toml snapshot-info
set "PUBLIC_EVEJS_EXIT=%errorlevel%"
popd
goto Finish

:Doctor
pushd "%MARKET_SEEDER_V2_DIR%"
"%CARGO_EXE%" run --release -- --config config/market-seederv2.local.toml doctor
set "PUBLIC_EVEJS_EXIT=%errorlevel%"
popd
goto Finish

:BuildRelease
pushd "%MARKET_SEEDER_V2_DIR%"
"%CARGO_EXE%" build --release
set "PUBLIC_EVEJS_EXIT=%errorlevel%"
popd
goto Finish

:EditConfig
if not exist "%MARKET_SEEDER_V2_CONFIG%" (
  echo   [!] Config file not found:
  echo       %MARKET_SEEDER_V2_CONFIG%
  pause
  exit /b 1
)
start "" notepad "%MARKET_SEEDER_V2_CONFIG%"
exit /b 0

:Finish
if not "%PUBLIC_EVEJS_EXIT%"=="0" (
  echo.
  echo   Market seeder v2 command exited with code %PUBLIC_EVEJS_EXIT%.
  pause
)
exit /b %PUBLIC_EVEJS_EXIT%

:EnsureLocalDatabase
set "PUBLIC_EVEJS_MARKET_STATIC_READY=1"
for %%D in (stations solarSystems itemTypes) do (
  if not exist "%EVEJS_GAMESTORE_DATA_DIR%\%%D\data.json" set "PUBLIC_EVEJS_MARKET_STATIC_READY=0"
)
if "%PUBLIC_EVEJS_MARKET_STATIC_READY%"=="1" exit /b 0

if not exist "%PUBLIC_EVEJS_REPO_ROOT%\tools\DatabaseCreator\CreateDatabase.bat" (
  echo.
  echo   [ERROR] Generated local market data is missing and DatabaseCreator was not found.
  echo       Expected: %PUBLIC_EVEJS_REPO_ROOT%\tools\DatabaseCreator\CreateDatabase.bat
  pause
  exit /b 1
)

set "PUBLIC_EVEJS_DATABASE_CREATOR_ARGS="
if exist "%PUBLIC_EVEJS_LOCAL_DATABASE_ROOT%\manifest.json" set "PUBLIC_EVEJS_DATABASE_CREATOR_ARGS=/force"

echo   Generated local market data is missing.
echo   Running tools\DatabaseCreator\CreateDatabase.bat %PUBLIC_EVEJS_DATABASE_CREATOR_ARGS%...
echo.
call "%PUBLIC_EVEJS_REPO_ROOT%\tools\DatabaseCreator\CreateDatabase.bat" %PUBLIC_EVEJS_DATABASE_CREATOR_ARGS%
set "PUBLIC_EVEJS_DB_EXIT=%errorlevel%"
if not "%PUBLIC_EVEJS_DB_EXIT%"=="0" (
  echo.
  echo   [ERROR] Database generation failed with code %PUBLIC_EVEJS_DB_EXIT%.
  pause
  exit /b %PUBLIC_EVEJS_DB_EXIT%
)

set "PUBLIC_EVEJS_MARKET_STATIC_READY=1"
for %%D in (stations solarSystems itemTypes) do (
  if not exist "%EVEJS_GAMESTORE_DATA_DIR%\%%D\data.json" set "PUBLIC_EVEJS_MARKET_STATIC_READY=0"
)
if not "%PUBLIC_EVEJS_MARKET_STATIC_READY%"=="1" (
  echo.
  echo   [ERROR] Database generation completed, but required market data is still missing:
  echo       %EVEJS_GAMESTORE_DATA_DIR%\stations\data.json
  echo       %EVEJS_GAMESTORE_DATA_DIR%\solarSystems\data.json
  echo       %EVEJS_GAMESTORE_DATA_DIR%\itemTypes\data.json
  pause
  exit /b 1
)

echo.
echo   Local market data ready: %EVEJS_GAMESTORE_DATA_DIR%
echo.
exit /b 0

:ResolveCargo
set "CARGO_EXE=%USERPROFILE%\.cargo\bin\cargo.exe"
if exist "%CARGO_EXE%" exit /b 0

for /f "delims=" %%I in ('where cargo 2^>nul') do (
  set "CARGO_EXE=%%I"
  exit /b 0
)

echo.
echo   [!] Rust cargo.exe was not found.
echo       Run tools\InstallRustForMarket.bat
echo       or install Rust manually with:
echo       winget install -e --id Rustlang.Rustup
echo.
pause
exit /b 1

:InitializeMsvcBuildEnvironment
call :ResolveVisualCppInstall
if errorlevel 1 goto MsvcMissing
call "%VCVARS64_BAT%" >nul
if errorlevel 1 goto MsvcEnvFailed
where cl.exe >nul 2>&1
if errorlevel 1 goto MsvcCompilerMissing
where link.exe >nul 2>&1
if errorlevel 1 goto MsvcLinkerMissing
call :FindHeaderInInclude "stdarg.h" EVEJS_STDARG_HEADER
if not defined EVEJS_STDARG_HEADER goto MsvcStdargMissing
call :FindHeaderInInclude "vcruntime.h" EVEJS_VCRUNTIME_HEADER
if not defined EVEJS_VCRUNTIME_HEADER goto MsvcVcruntimeMissing
exit /b 0

:ResolveVisualCppInstall
set "VS_INSTALL_PATH="
set "VCVARS64_BAT="
call :ResolveVisualCppInstallWithVsWhere "Microsoft.VisualStudio.Component.VC.Tools.x86.x64"
if not errorlevel 1 exit /b 0
call :ResolveVisualCppInstallWithVsWhere ""
if not errorlevel 1 exit /b 0
call :ResolveKnownVcvars64
exit /b %errorlevel%

:ResolveVisualCppInstallWithVsWhere
call :ResolveVsWhere
if errorlevel 1 exit /b 1
call :QueryVisualStudioInstall "%~1"
if errorlevel 1 exit /b 1
if not defined VS_INSTALL_PATH exit /b 1
if not exist "%VS_INSTALL_PATH%\VC\Auxiliary\Build\vcvars64.bat" exit /b 1
set "VCVARS64_BAT=%VS_INSTALL_PATH%\VC\Auxiliary\Build\vcvars64.bat"
exit /b 0

:ResolveKnownVcvars64
for %%I in (
  "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools"
  "%ProgramFiles%\Microsoft Visual Studio\2022\BuildTools"
  "%ProgramFiles%\Microsoft Visual Studio\2022\Community"
  "%ProgramFiles%\Microsoft Visual Studio\2022\Professional"
  "%ProgramFiles%\Microsoft Visual Studio\2022\Enterprise"
  "%ProgramFiles(x86)%\Microsoft Visual Studio\2019\BuildTools"
  "%ProgramFiles%\Microsoft Visual Studio\2019\BuildTools"
) do (
  if exist "%%~I\VC\Auxiliary\Build\vcvars64.bat" (
    set "VS_INSTALL_PATH=%%~I"
    set "VCVARS64_BAT=%%~I\VC\Auxiliary\Build\vcvars64.bat"
    exit /b 0
  )
)
exit /b 1

:ResolveVsWhere
if exist "%VSWHERE_EXE%" exit /b 0
set "PUBLIC_EVEJS_WHERE_RESULT=%TEMP%\evejs-v2-where-vswhere-%RANDOM%-%RANDOM%.txt"
where vswhere > "%PUBLIC_EVEJS_WHERE_RESULT%" 2>nul
if errorlevel 1 goto ResolveVsWhereFailed
set /p VSWHERE_EXE=< "%PUBLIC_EVEJS_WHERE_RESULT%"
del "%PUBLIC_EVEJS_WHERE_RESULT%" >nul 2>&1
if defined VSWHERE_EXE exit /b 0

:ResolveVsWhereFailed
del "%PUBLIC_EVEJS_WHERE_RESULT%" >nul 2>&1
exit /b 1

:QueryVisualStudioInstall
set "VS_INSTALL_PATH="
set "PUBLIC_EVEJS_VS_QUERY_REQUIRES=%~1"
set "PUBLIC_EVEJS_VSWHERE_EXE=%VSWHERE_EXE%"
set "PUBLIC_EVEJS_VS_QUERY_RESULT=%TEMP%\evejs-v2-vswhere-%RANDOM%-%RANDOM%.txt"
"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; $vs = $env:PUBLIC_EVEJS_VSWHERE_EXE; if (-not (Test-Path -LiteralPath $vs)) { exit 1 }; $args = @('-latest', '-products', '*'); if ($env:PUBLIC_EVEJS_VS_QUERY_REQUIRES) { $args += @('-requires', $env:PUBLIC_EVEJS_VS_QUERY_REQUIRES) }; $args += @('-property', 'installationPath'); & $vs @args | Select-Object -First 1" > "%PUBLIC_EVEJS_VS_QUERY_RESULT%" 2>nul
if errorlevel 1 goto QueryVisualStudioInstallFailed
set /p VS_INSTALL_PATH=< "%PUBLIC_EVEJS_VS_QUERY_RESULT%"
del "%PUBLIC_EVEJS_VS_QUERY_RESULT%" >nul 2>&1
if defined VS_INSTALL_PATH exit /b 0

:QueryVisualStudioInstallFailed
del "%PUBLIC_EVEJS_VS_QUERY_RESULT%" >nul 2>&1
exit /b 1

:FindHeaderInInclude
set "%~2="
set "PUBLIC_EVEJS_HEADER_NAME=%~1"
set "PUBLIC_EVEJS_HEADER_RESULT=%TEMP%\evejs-v2-header-%RANDOM%-%RANDOM%.txt"
"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'SilentlyContinue'; foreach ($p in ($env:INCLUDE -split ';')) { if ([string]::IsNullOrWhiteSpace($p)) { continue }; $candidate = Join-Path $p $env:PUBLIC_EVEJS_HEADER_NAME; if (Test-Path -LiteralPath $candidate) { [Console]::Out.WriteLine($candidate); exit 0 } }; exit 1" > "%PUBLIC_EVEJS_HEADER_RESULT%" 2>nul
if errorlevel 1 goto FindHeaderInIncludeFailed
set /p %~2=< "%PUBLIC_EVEJS_HEADER_RESULT%"
del "%PUBLIC_EVEJS_HEADER_RESULT%" >nul 2>&1
exit /b 0

:FindHeaderInIncludeFailed
del "%PUBLIC_EVEJS_HEADER_RESULT%" >nul 2>&1
exit /b 0

:MsvcMissing
echo.
echo   [!] Visual Studio C++ Build Tools could not be found.
echo       Run tools\InstallRustForMarket.bat, then run this again.
pause
exit /b 1

:MsvcEnvFailed
echo.
echo   [!] Failed to initialize the Visual Studio C++ build environment:
echo       %VCVARS64_BAT%
pause
exit /b 1

:MsvcCompilerMissing
echo.
echo   [!] cl.exe was not found after initializing Visual Studio C++.
echo       Run tools\InstallRustForMarket.bat again.
pause
exit /b 1

:MsvcLinkerMissing
echo.
echo   [!] link.exe was not found after initializing Visual Studio C++.
echo       Run tools\InstallRustForMarket.bat again.
pause
exit /b 1

:MsvcStdargMissing
echo.
echo   [!] Windows SDK C runtime headers are missing from this console.
echo       Missing header: stdarg.h
echo.
echo       Run tools\InstallRustForMarket.bat again. If Windows asks for a
echo       restart after Visual Studio Build Tools, restart and then retry.
pause
exit /b 1

:MsvcVcruntimeMissing
echo.
echo   [!] Visual Studio C++ runtime headers are missing from this console.
echo       Missing header: vcruntime.h
echo.
echo       Run tools\InstallRustForMarket.bat again. If Windows asks for a
echo       restart after Visual Studio Build Tools, restart and then retry.
pause
exit /b 1
