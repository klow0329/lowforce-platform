@echo off
REM Backs up the LowForce Postgres database to a timestamped .dump file.
REM Run manually, or point Windows Task Scheduler at this file for a daily
REM automatic backup (Task Scheduler > Create Task > Trigger: daily >
REM Action: start this .cmd file).
REM
REM To restore a backup:
REM   "C:\pgsql\pgsql\bin\pg_restore.exe" -h localhost -U postgres -d lowforce --clean backups\lowforce_YYYYMMDD_HHMMSS.dump

setlocal
set PGPASSWORD=postgres
set BACKUP_DIR=%~dp0backups
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

for /f "tokens=2-4 delims=/ " %%a in ('date /t') do set DATESTAMP=%%c%%a%%b
for /f "tokens=1-2 delims=: " %%a in ('time /t') do set TIMESTAMP=%%a%%b

set FILENAME=%BACKUP_DIR%\lowforce_%DATESTAMP%_%TIMESTAMP%.dump

"C:\pgsql\pgsql\bin\pg_dump.exe" -h localhost -U postgres -d lowforce -F c -f "%FILENAME%"

if %ERRORLEVEL% EQU 0 (
    echo Backup saved to %FILENAME%
) else (
    echo Backup FAILED
    exit /b 1
)
endlocal
