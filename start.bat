@echo off
chcp 65001 >nul
title Payment Reminder

echo ========================================
echo   Payment Reminder System Start
echo ========================================
echo.

set "BASE=%~dp0"

echo [1/2] Starting Backend...
start "Backend" cmd /k "chcp 65001 >nul & cd /d "%BASE%backend" & python main.py"

timeout /t 3 /nobreak >nul
echo [2/2] Starting Frontend...
start "Frontend" cmd /k "chcp 65001 >nul & cd /d "%BASE%frontend" & npm run dev"

timeout /t 5 /nobreak >nul
start "" "http://localhost:3000"

echo.
echo ========================================
echo   Backend:  http://localhost:8000
echo   Frontend: http://localhost:3000
echo ========================================
echo   Close terminal windows to stop.
echo ========================================
pause
