@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Upgrade-Yolu.ps1" -Launch
if errorlevel 1 (
    echo Upgrade failed. Review the error above; existing backups are retained.
    pause
    exit /b 1
)
pause
