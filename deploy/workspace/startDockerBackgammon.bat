@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0startDockerBackgammon.ps1" %*
set "LauncherExitCode=%ERRORLEVEL%"
if not "%LauncherExitCode%"=="0" (
    echo Docker environment stopped with an error.
    pause
)
exit /b %LauncherExitCode%
