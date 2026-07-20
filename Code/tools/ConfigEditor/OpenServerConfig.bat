@echo off
setlocal

for %%I in ("%~dp0..\..") do set "EVEJS_REPO_ROOT=%%~fI"

call "%EVEJS_REPO_ROOT%\tools\ClientSETUP\scripts\EvEJSConfig.bat"
if errorlevel 1 exit /b 1

set "EVEJS_LOCAL_DATABASE_ROOT=%EVEJS_REPO_ROOT%\_local\gameStore"
set "EVEJS_GAMESTORE_DATA_DIR=%EVEJS_LOCAL_DATABASE_ROOT%\data"

call :EnsureLocalDatabase
if errorlevel 1 exit /b 1

powershell.exe -Sta -NoProfile -ExecutionPolicy Bypass -File "%~dp0OpenServerConfigV2.ps1"
set "EVEJS_EXIT=%errorlevel%"

if not "%EVEJS_EXIT%"=="0" (
  echo [eve.js] Config manager exited with code %EVEJS_EXIT%.
  pause
)

exit /b %EVEJS_EXIT%

:EnsureLocalDatabase
set "EVEJS_CONFIG_EDITOR_DATA_READY=1"
for %%D in (accounts characters skills items itemTypes shipTypes skillTypes corporations stations solarSystems) do (
  if not exist "%EVEJS_GAMESTORE_DATA_DIR%\%%D\data.json" set "EVEJS_CONFIG_EDITOR_DATA_READY=0"
)
if "%EVEJS_CONFIG_EDITOR_DATA_READY%"=="1" exit /b 0

if not exist "%EVEJS_REPO_ROOT%\tools\DatabaseCreator\CreateDatabase.bat" (
  echo.
  echo   [ERROR] Generated local database data is missing and DatabaseCreator was not found.
  echo       Expected: %EVEJS_REPO_ROOT%\tools\DatabaseCreator\CreateDatabase.bat
  pause
  exit /b 1
)

set "EVEJS_DATABASE_CREATOR_ARGS="
if exist "%EVEJS_LOCAL_DATABASE_ROOT%\manifest.json" set "EVEJS_DATABASE_CREATOR_ARGS=/force"

echo   Generated local database data is missing.
echo   Running tools\DatabaseCreator\CreateDatabase.bat %EVEJS_DATABASE_CREATOR_ARGS%...
echo.
call "%EVEJS_REPO_ROOT%\tools\DatabaseCreator\CreateDatabase.bat" %EVEJS_DATABASE_CREATOR_ARGS%
set "EVEJS_DB_EXIT=%errorlevel%"
if not "%EVEJS_DB_EXIT%"=="0" (
  echo.
  echo   [ERROR] Database generation failed with code %EVEJS_DB_EXIT%.
  pause
  exit /b %EVEJS_DB_EXIT%
)

set "EVEJS_CONFIG_EDITOR_DATA_READY=1"
for %%D in (accounts characters skills items itemTypes shipTypes skillTypes corporations stations solarSystems) do (
  if not exist "%EVEJS_GAMESTORE_DATA_DIR%\%%D\data.json" set "EVEJS_CONFIG_EDITOR_DATA_READY=0"
)
if not "%EVEJS_CONFIG_EDITOR_DATA_READY%"=="1" (
  echo.
  echo   [ERROR] Database generation completed, but required Config Editor data is still missing under:
  echo       %EVEJS_GAMESTORE_DATA_DIR%
  pause
  exit /b 1
)

echo.
echo   Local database ready: %EVEJS_GAMESTORE_DATA_DIR%
echo.
exit /b 0
