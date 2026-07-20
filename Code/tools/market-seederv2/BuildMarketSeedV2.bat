@echo off
setlocal EnableDelayedExpansion
title PublicEveJS - TQ Market Snapshot Seeder

for %%I in ("%~dp0..\..") do set "PUBLIC_EVEJS_REPO_ROOT=%%~fI"
set "MARKET_SEEDER_V2_DIR=%PUBLIC_EVEJS_REPO_ROOT%\tools\market-seederv2"
set "MARKET_SEEDER_V2_CONFIG=%MARKET_SEEDER_V2_DIR%\config\market-seederv2.local.toml"
set "PUBLIC_EVEJS_LOCAL_DATABASE_ROOT=%PUBLIC_EVEJS_REPO_ROOT%\_local\gameStore"
set "EVEJS_GAMESTORE_DATA_DIR=%PUBLIC_EVEJS_LOCAL_DATABASE_ROOT%\data"

call :ResolveCargo
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
