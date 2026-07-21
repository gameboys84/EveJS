@echo off
setlocal EnableDelayedExpansion
title EvEJS - Server

for %%I in ("%~dp0.") do set "EVEJS_REPO_ROOT=%%~fI"
set "EVEJS_LOCAL_DATABASE_ROOT=%EVEJS_REPO_ROOT%\_local\gameStore"
set "EVEJS_GAMESTORE_DATA_DIR=%EVEJS_LOCAL_DATABASE_ROOT%\data"
set "EVEJS_PROXY_LOCAL_INTERCEPT=1"

echo.
echo   ============================================================
echo     EvEJS Server
echo   ============================================================
echo.
echo   Logs: %EVEJS_REPO_ROOT%\server\logs\server_debug.log
echo   (cleared on each start)
echo.
echo   Restart manually after code changes:
echo     1. Ctrl+C in THIS window
echo     2. Run WatchServer.bat again
echo.
echo   ============================================================
echo.

if not exist "%EVEJS_REPO_ROOT%\server\logs" mkdir "%EVEJS_REPO_ROOT%\server\logs" >nul 2>&1

pushd "%EVEJS_REPO_ROOT%\server"
echo. > logs\server_debug.log
node --max-old-space-size=8192 . >> logs\server_debug.log 2>&1
set "EVEJS_EXIT=!errorlevel!"
popd

exit /b !EVEJS_EXIT%
