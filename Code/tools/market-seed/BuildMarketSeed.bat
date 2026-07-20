@echo off
setlocal EnableDelayedExpansion
title EvEJS - Build Market Seed

for %%I in ("%~dp0..\..") do set "EVEJS_REPO_ROOT=%%~fI"
set "MARKET_SEED_DIR=%EVEJS_REPO_ROOT%\tools\market-seed"
set "MARKET_SEED_CONFIG=%MARKET_SEED_DIR%\config\market-seed.local.toml"
set "MARKET_COMMON_DIR=%EVEJS_REPO_ROOT%\externalservices\market-server\crates\market-common"
set "EVEJS_GAMESTORE_DATA_DIR=%EVEJS_REPO_ROOT%\_local\gameStore\data"
set "EVEJS_NEWDB_DATA_DIR=%EVEJS_REPO_ROOT%\_local\newDatabase\data"
set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "VSWHERE_EXE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
set "VS_INSTALL_PATH="
set "VCVARS64_BAT="
set "EVEJS_STDARG_HEADER="

if not exist "%MARKET_SEED_DIR%\Cargo.toml" (
  echo.
  echo   [!] Market seed project not found at:
  echo       %MARKET_SEED_DIR%
  pause
  exit /b 1
)

call :RequireMarketCommon
if errorlevel 1 exit /b 1

call :ResolveCargo
if errorlevel 1 exit /b 1
call :InitializeMsvcBuildEnvironment
if errorlevel 1 exit /b 1

if /i "%~1"=="full" goto FullBuild
if /i "%~1"=="jita" goto JitaNewCaldari
if /i "%~1"=="smoke" goto QuickSmoke
if /i "%~1"=="gui" goto OpenGui
if /i "%~1"=="rebuild-summaries" goto RebuildSummaries
if /i "%~1"=="doctor" goto Doctor
if /i "%~1"=="build-release" goto BuildRelease
if /i "%~1"=="edit-config" goto EditConfig
if /i "%~1"=="readme" goto OpenReadme
if /i "%~1"=="presets" goto ListPresets

echo.
echo   ============================================================
echo     EvEJS - Build Market Seed
echo   ============================================================
echo.
echo     [1] Full universe rebuild - release build
echo     [2] Jita + New Caldari rebuild - release build
echo     [3] Quick smoke rebuild - 25 stations x 250 item types
echo     [4] Open seeder GUI
echo     [5] Rebuild summaries only
echo     [6] Doctor - inspect current seed database
echo     [7] Show supported presets
echo     [8] Build release binary only
echo     [9] Edit market seed config
echo     [A] Open seeder README
echo.
choice /c 123456789A /n /m "  Choose [1-9/A]: "
echo.

if errorlevel 10 goto OpenReadme
if errorlevel 9 goto EditConfig
if errorlevel 8 goto BuildRelease
if errorlevel 7 goto ListPresets
if errorlevel 6 goto Doctor
if errorlevel 5 goto RebuildSummaries
if errorlevel 4 goto OpenGui
if errorlevel 3 goto QuickSmoke
if errorlevel 2 goto JitaNewCaldari
if errorlevel 1 goto FullBuild

:FullBuild
echo   Building the full seeded market database...
echo.
call :RequireGeneratedDatabase
if errorlevel 1 exit /b 1
call :RemoveStaleMarketSeedBinary release
pushd "%MARKET_SEED_DIR%"
"%CARGO_EXE%" run --release -- --config config/market-seed.local.toml build --force
set "EVEJS_EXIT=%errorlevel%"
popd
goto Finish

:JitaNewCaldari
echo   Building the Jita + New Caldari seeded market database...
echo   Preset: jita_new_caldari
echo.
call :RequireGeneratedDatabase
if errorlevel 1 exit /b 1
call :RemoveStaleMarketSeedBinary release
pushd "%MARKET_SEED_DIR%"
"%CARGO_EXE%" run --release -- --config config/market-seed.local.toml build --force --preset jita_new_caldari
set "EVEJS_EXIT=%errorlevel%"
popd
goto Finish

:QuickSmoke
echo   Building a quick smoke-test market database...
echo.
call :RequireGeneratedDatabase
if errorlevel 1 exit /b 1
call :RemoveStaleMarketSeedBinary debug
pushd "%MARKET_SEED_DIR%"
"%CARGO_EXE%" run -- --config config/market-seed.local.toml build --force --station-limit 25 --type-limit 250
set "EVEJS_EXIT=%errorlevel%"
popd
goto Finish

:RebuildSummaries
echo   Rebuilding market region summaries...
echo.
pushd "%MARKET_SEED_DIR%"
"%CARGO_EXE%" run --release -- --config config/market-seed.local.toml rebuild-summaries
set "EVEJS_EXIT=%errorlevel%"
popd
goto Finish

:Doctor
echo   Running market seed doctor...
echo.
pushd "%MARKET_SEED_DIR%"
"%CARGO_EXE%" run --release -- --config config/market-seed.local.toml doctor
set "EVEJS_EXIT=%errorlevel%"
popd
goto Finish

:ListPresets
echo   Listing supported market seed presets...
echo.
pushd "%MARKET_SEED_DIR%"
"%CARGO_EXE%" run -- --config config/market-seed.local.toml presets
set "EVEJS_EXIT=%errorlevel%"
popd
goto Finish

:BuildRelease
echo   Building market seed release binary...
echo.
call :RemoveStaleMarketSeedBinary release
pushd "%MARKET_SEED_DIR%"
"%CARGO_EXE%" build --release
set "EVEJS_EXIT=%errorlevel%"
popd
goto Finish

:EditConfig
if not exist "%MARKET_SEED_CONFIG%" (
  echo   [!] Config file not found:
  echo       %MARKET_SEED_CONFIG%
  pause
  exit /b 1
)
start "" notepad "%MARKET_SEED_CONFIG%"
exit /b 0

:OpenGui
call "%MARKET_SEED_DIR%\BuildMarketSeedGui.bat"
exit /b %errorlevel%

:OpenReadme
start "" notepad "%MARKET_SEED_DIR%\README.md"
exit /b 0

:RemoveStaleMarketSeedBinary
set "EVEJS_MARKET_SEED_PROFILE=%~1"
if /i "%EVEJS_MARKET_SEED_PROFILE%"=="release" (
  set "EVEJS_MARKET_SEED_EXE=%MARKET_SEED_DIR%\target\release\market-seed.exe"
) else (
  set "EVEJS_MARKET_SEED_EXE=%MARKET_SEED_DIR%\target\debug\market-seed.exe"
)
if exist "%EVEJS_MARKET_SEED_EXE%" (
  del "%EVEJS_MARKET_SEED_EXE%" >nul 2>&1
  if exist "%EVEJS_MARKET_SEED_EXE%" (
    echo.
    echo   [!] Could not replace stale market-seed binary:
    echo       %EVEJS_MARKET_SEED_EXE%
    echo       Close any market seed windows and try again.
    pause
    exit /b 1
  )
)
exit /b 0

:Finish
if not "%EVEJS_EXIT%"=="0" (
  echo.
  echo   Market seed command exited with code %EVEJS_EXIT%.
  pause
)
exit /b %EVEJS_EXIT%

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
call :FindStdargInInclude
if not defined EVEJS_STDARG_HEADER goto MsvcHeaderMissing
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
set "EVEJS_WHERE_RESULT=%TEMP%\evejs-where-vswhere-%RANDOM%-%RANDOM%.txt"
where vswhere > "%EVEJS_WHERE_RESULT%" 2>nul
if errorlevel 1 goto ResolveVsWhereFailed
set /p VSWHERE_EXE=< "%EVEJS_WHERE_RESULT%"
del "%EVEJS_WHERE_RESULT%" >nul 2>&1
if defined VSWHERE_EXE exit /b 0

:ResolveVsWhereFailed
del "%EVEJS_WHERE_RESULT%" >nul 2>&1
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

:FindStdargInInclude
set "EVEJS_STDARG_HEADER="
set "EVEJS_STDARG_RESULT=%TEMP%\evejs-stdarg-header-%RANDOM%-%RANDOM%.txt"
"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'SilentlyContinue'; foreach ($p in ($env:INCLUDE -split ';')) { if ([string]::IsNullOrWhiteSpace($p)) { continue }; $candidate = Join-Path $p 'stdarg.h'; if (Test-Path -LiteralPath $candidate) { [Console]::Out.WriteLine($candidate); exit 0 } }; exit 1" > "%EVEJS_STDARG_RESULT%" 2>nul
if errorlevel 1 goto FindStdargInIncludeFailed
set /p EVEJS_STDARG_HEADER=< "%EVEJS_STDARG_RESULT%"
del "%EVEJS_STDARG_RESULT%" >nul 2>&1
exit /b 0

:FindStdargInIncludeFailed
del "%EVEJS_STDARG_RESULT%" >nul 2>&1
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

:MsvcHeaderMissing
echo.
echo   [!] Visual Studio C++ headers are missing from this console.
echo       SQLite needs stdarg.h while compiling bundled C source.
echo.
echo       Run tools\InstallRustForMarket.bat again. If Windows asks for a
echo       restart after Visual Studio Build Tools, restart and then retry.
pause
exit /b 1

:RequireGeneratedDatabase
call :GeneratedDataExists
if errorlevel 1 goto GeneratedDatabaseMissing
call :GeneratedDataValid
if not errorlevel 1 exit /b 0
echo.
echo   [!] Generated EveJS market data exists, but it is incomplete.
echo       Expected Jita 30000142 and New Caldari 30000145 in:
echo       %EVEJS_GAMESTORE_DATA_DIR%
echo       or:
echo       %EVEJS_NEWDB_DATA_DIR%
echo.
echo       Rebuilding the generated database now...
echo.
call :RunDatabaseCreator /force
if errorlevel 1 (
  echo.
  echo   [ERROR] Database creation failed. Market seeding cannot continue.
  pause
  exit /b 1
)
call :GeneratedDataExists
if errorlevel 1 goto GeneratedDatabaseStillMissing
call :GeneratedDataValid
if not errorlevel 1 exit /b 0
echo.
echo   [ERROR] Database creation completed, but Jita/New Caldari are still missing.
echo       This EveJS package may be incomplete, or the SDE cache may be corrupt.
echo       Delete _local\downloads\sde and _local\sde, then run DatabaseCreator again.
echo.
pause
exit /b 1

:GeneratedDatabaseMissing
echo.
echo   [!] Generated EveJS database data was not found.
echo       Expected:
echo       %EVEJS_GAMESTORE_DATA_DIR%
echo       or:
echo       %EVEJS_NEWDB_DATA_DIR%
echo.
echo       Market seeding needs generated static EveJS data first.
echo       Running the database creator now...
echo.
call :RunDatabaseCreator
if errorlevel 1 (
  echo.
  echo   [ERROR] Database creation failed. Market seeding cannot continue.
  pause
  exit /b 1
)
call :GeneratedDataExists
if errorlevel 1 goto GeneratedDatabaseStillMissing
call :GeneratedDataValid
if not errorlevel 1 exit /b 0
echo.
echo   [ERROR] Database creation completed, but Jita/New Caldari are missing.
echo       This EveJS package may be incomplete, or the SDE cache may be corrupt.
echo       Delete _local\downloads\sde and _local\sde, then run DatabaseCreator again.
echo.
pause
exit /b 1

:GeneratedDatabaseStillMissing
echo.
echo   [ERROR] Database creation completed, but required generated market inputs are still missing.
echo.
pause
exit /b 1

:GeneratedDataExists
if exist "%EVEJS_GAMESTORE_DATA_DIR%\stations\data.json" if exist "%EVEJS_GAMESTORE_DATA_DIR%\solarSystems\data.json" if exist "%EVEJS_GAMESTORE_DATA_DIR%\itemTypes\data.json" exit /b 0
if exist "%EVEJS_NEWDB_DATA_DIR%\stations\data.json" if exist "%EVEJS_NEWDB_DATA_DIR%\solarSystems\data.json" if exist "%EVEJS_NEWDB_DATA_DIR%\itemTypes\data.json" exit /b 0
exit /b 1

:GeneratedDataValid
call :ValidateGeneratedDataDir "%EVEJS_GAMESTORE_DATA_DIR%"
if not errorlevel 1 exit /b 0
call :ValidateGeneratedDataDir "%EVEJS_NEWDB_DATA_DIR%"
exit /b %errorlevel%

:ValidateGeneratedDataDir
set "EVEJS_VALIDATE_DATA_DIR=%~1"
if not exist "%EVEJS_VALIDATE_DATA_DIR%\stations\data.json" exit /b 1
if not exist "%EVEJS_VALIDATE_DATA_DIR%\solarSystems\data.json" exit /b 1
"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "$root = $env:EVEJS_VALIDATE_DATA_DIR; $solarPath = Join-Path $root 'solarSystems\data.json'; $stationPath = Join-Path $root 'stations\data.json'; $solar = Get-Content -Raw -LiteralPath $solarPath; $stations = Get-Content -Raw -LiteralPath $stationPath; if ($solar -notmatch '30000142') { exit 1 }; if ($solar -notmatch '30000145') { exit 1 }; if ($stations -notmatch '30000142') { exit 1 }; if ($stations -notmatch '30000145') { exit 1 }; exit 0"
exit /b %errorlevel%

:RunDatabaseCreator
set "EVEJS_DATABASE_CREATOR_ARGS=%*"
if not exist "%EVEJS_REPO_ROOT%\DatabaseCreator.bat" goto TryToolsDatabaseCreatorBat
call "%EVEJS_REPO_ROOT%\DatabaseCreator.bat" %EVEJS_DATABASE_CREATOR_ARGS%
exit /b %errorlevel%

:TryToolsDatabaseCreatorBat
if not exist "%EVEJS_REPO_ROOT%\tools\DatabaseCreator\DatabaseCreator.bat" goto TryToolsCreateDatabaseBat
call "%EVEJS_REPO_ROOT%\tools\DatabaseCreator\DatabaseCreator.bat" %EVEJS_DATABASE_CREATOR_ARGS%
exit /b %errorlevel%

:TryToolsCreateDatabaseBat
if not exist "%EVEJS_REPO_ROOT%\tools\DatabaseCreator\CreateDatabase.bat" goto TryNativeDatabaseCreatorExe
call "%EVEJS_REPO_ROOT%\tools\DatabaseCreator\CreateDatabase.bat" %EVEJS_DATABASE_CREATOR_ARGS%
exit /b %errorlevel%

:TryNativeDatabaseCreatorExe
if not exist "%EVEJS_REPO_ROOT%\tools\DatabaseCreator\bin\DatabaseCreator.exe" goto DatabaseCreatorEntrypointMissing
"%EVEJS_REPO_ROOT%\tools\DatabaseCreator\bin\DatabaseCreator.exe" --repo-root "%EVEJS_REPO_ROOT%" %EVEJS_DATABASE_CREATOR_ARGS%
exit /b %errorlevel%

:DatabaseCreatorEntrypointMissing
echo.
echo   [ERROR] No DatabaseCreator entrypoint was found in this EveJS folder.
echo.
echo       Expected one of:
echo       %EVEJS_REPO_ROOT%\DatabaseCreator.bat
echo       %EVEJS_REPO_ROOT%\tools\DatabaseCreator\DatabaseCreator.bat
echo       %EVEJS_REPO_ROOT%\tools\DatabaseCreator\CreateDatabase.bat
echo       %EVEJS_REPO_ROOT%\tools\DatabaseCreator\bin\DatabaseCreator.exe
echo.
echo       This EveJS package is incomplete. Download the latest full release
echo       and extract it into a fresh empty folder.
exit /b 1

:RequireMarketCommon
if exist "%MARKET_COMMON_DIR%\Cargo.toml" if exist "%MARKET_COMMON_DIR%\src\lib.rs" exit /b 0
echo.
echo   [!] This EveJS folder is missing required market source files.
echo.
echo       Expected:
echo       %MARKET_COMMON_DIR%\Cargo.toml
echo       %MARKET_COMMON_DIR%\src\lib.rs
echo.
echo       This is not a Rust/MSVC installer problem. The EveJS package is
echo       incomplete, old, or was merged into an existing folder.
echo.
echo       Fix:
echo         1. Download the latest full EveJS release zip.
echo         2. Extract it into a fresh empty folder.
echo         3. Run tools\InstallRustForMarket.bat again if needed.
echo         4. Run BuildMarketSeed.bat again.
echo.
pause
exit /b 1
