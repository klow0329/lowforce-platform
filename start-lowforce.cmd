@echo off
REM ============================================================
REM  LowForce testing environment — one-command startup.
REM  Double-click this file (or run it in a terminal) after a
REM  reboot to bring the whole environment back up.
REM ============================================================

echo [1/3] Starting PostgreSQL (if not already running)...
"C:\pgsql\pgsql\bin\pg_ctl" -D "C:\pgsql\data" status >nul 2>&1
if errorlevel 1 (
    "C:\pgsql\pgsql\bin\pg_ctl" -D "C:\pgsql\data" -l "C:\pgsql\logfile.txt" start -w
) else (
    echo       PostgreSQL is already running.
)

echo [2/3] Starting the LowForce server...
cd /d "%~dp0backend"

REM Floor Plan's PDF upload/auto-detect needs poppler-utils (pdftoppm,
REM pdftotext) on PATH — added here so it works when launched this way,
REM not just from a dev terminal that happens to have it already.
set "PATH=C:\Users\SewWahLow\AppData\Local\Microsoft\WinGet\Packages\oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe\poppler-25.07.0\Library\bin;%PATH%"

echo [3/3] Server starting - keep this window open while people are using the app.
echo.
echo       Local access:    http://localhost:3001
echo       LAN access:      http://THIS-PC-IP:3001   (run "ipconfig" to find your IPv4 address)
echo.
"C:\Program Files\nodejs\node.exe" src\server.js
