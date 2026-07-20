@echo off
setlocal EnableExtensions EnableDelayedExpansion
title EvEJS Local Database Reset

set "EVEJS_RESET_SCRIPT_DIR=%~dp0"
set "EVEJS_RESET_ARGS="

:parse_args
if "%~1"=="" goto run_reset

if /I "%~1"=="/full" (
  set "EVEJS_RESET_ARGS=!EVEJS_RESET_ARGS! -Full"
  shift
  goto parse_args
)

if /I "%~1"=="--full" (
  set "EVEJS_RESET_ARGS=!EVEJS_RESET_ARGS! -Full"
  shift
  goto parse_args
)

if /I "%~1"=="/config" (
  set "EVEJS_RESET_ARGS=!EVEJS_RESET_ARGS! -Config"
  shift
  goto parse_args
)

if /I "%~1"=="--config" (
  set "EVEJS_RESET_ARGS=!EVEJS_RESET_ARGS! -Config"
  shift
  goto parse_args
)

if /I "%~1"=="/whatif" (
  set "EVEJS_RESET_ARGS=!EVEJS_RESET_ARGS! -WhatIf"
  shift
  goto parse_args
)

if /I "%~1"=="--whatif" (
  set "EVEJS_RESET_ARGS=!EVEJS_RESET_ARGS! -WhatIf"
  shift
  goto parse_args
)

if /I "%~1"=="-whatif" (
  set "EVEJS_RESET_ARGS=!EVEJS_RESET_ARGS! -WhatIf"
  shift
  goto parse_args
)

if /I "%~1"=="/?" goto usage
if /I "%~1"=="-?" goto usage
if /I "%~1"=="--help" goto usage

echo.
echo   [ERROR] Unknown argument: %~1
goto usage_error

:run_reset
powershell -NoProfile -ExecutionPolicy Bypass -File "%EVEJS_RESET_SCRIPT_DIR%ResetLocalDatabases.ps1" %EVEJS_RESET_ARGS%
exit /b %errorlevel%

:usage
echo.
echo   Usage: ResetLocalDatabases.bat [/full] [/config] [/whatif]
echo.
echo     /full     Remove all _local data, including cached SDE downloads.
echo     /config   Also remove tools\ClientSETUP\scripts\EvEJSConfig.bat.
echo     /whatif   Show what would be removed without deleting anything.
echo.
exit /b 0

:usage_error
echo.
echo   Usage: ResetLocalDatabases.bat [/full] [/config] [/whatif]
echo.
exit /b 2
