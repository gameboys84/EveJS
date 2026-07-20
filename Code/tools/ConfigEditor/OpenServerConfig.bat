@echo off
setlocal

for %%I in ("%~dp0..\..") do set "EVEJS_REPO_ROOT=%%~fI"

call "%EVEJS_REPO_ROOT%\tools\ClientSETUP\scripts\EvEJSConfig.bat"
if errorlevel 1 exit /b 1

set "EVEJS_LOCAL_DATABASE_ROOT=%EVEJS_REPO_ROOT%\_local\gameStore"
set "EVEJS_GAMESTORE_DATA_DIR=%EVEJS_LOCAL_DATABASE_ROOT%\data"
set "EVEJS_GAMESTORE_SQLITE_PATH=%EVEJS_LOCAL_DATABASE_ROOT%\gamestore.sqlite"

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
if not exist "%EVEJS_GAMESTORE_SQLITE_PATH%" set "EVEJS_CONFIG_EDITOR_DATA_READY=0"
for %%D in (itemTypes shipTypes skillTypes typeDogma corporations stations solarSystems) do (
  if not exist "%EVEJS_GAMESTORE_DATA_DIR%\%%D\data.json" set "EVEJS_CONFIG_EDITOR_DATA_READY=0"
)
if "%EVEJS_CONFIG_EDITOR_DATA_READY%"=="1" exit /b 0

if exist "%EVEJS_GAMESTORE_SQLITE_PATH%" (
  echo.
  echo   [ERROR] The live SQLite player database exists, but required static catalog data is missing.
  echo       Player database: %EVEJS_GAMESTORE_SQLITE_PATH%
  echo       Static catalogs: %EVEJS_GAMESTORE_DATA_DIR%
  echo       The Config Editor will not rebuild or replace an existing live database automatically.
  pause
  exit /b 1
)

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
if not exist "%EVEJS_GAMESTORE_SQLITE_PATH%" set "EVEJS_CONFIG_EDITOR_DATA_READY=0"
for %%D in (itemTypes shipTypes skillTypes typeDogma corporations stations solarSystems) do (
  if not exist "%EVEJS_GAMESTORE_DATA_DIR%\%%D\data.json" set "EVEJS_CONFIG_EDITOR_DATA_READY=0"
)
if not "%EVEJS_CONFIG_EDITOR_DATA_READY%"=="1" (
  echo.
  echo   [ERROR] Database generation completed, but the SQLite store or static catalogs are still missing.
  echo       Player database: %EVEJS_GAMESTORE_SQLITE_PATH%
  echo       Static catalogs: %EVEJS_GAMESTORE_DATA_DIR%
  pause
  exit /b 1
)

echo.
echo   Live SQLite player database ready: %EVEJS_GAMESTORE_SQLITE_PATH%
echo.
exit /b 0
