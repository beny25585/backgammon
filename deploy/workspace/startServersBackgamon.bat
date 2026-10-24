@echo off
setlocal
title Backgammon Docker Environment

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0startServersBackgamon.ps1" %*
set "LauncherExitCode=%ERRORLEVEL%"

if not "%LauncherExitCode%"=="0" (
    echo.
    echo Docker environment stopped with an error.
    pause
)

exit /b %LauncherExitCode%
