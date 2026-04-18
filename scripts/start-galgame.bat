@echo off
setlocal

rem Start Galgame Web UI + local API (Bun).
rem Runs `bun run galgame` from the repo root.

cd /d "%~dp0.."

where bun >nul 2>nul
if errorlevel 1 (
  echo [ERR] Bun not found in PATH.
  echo Install Bun from https://bun.sh/ and reopen this window.
  exit /b 1
)

if not exist "package.json" (
  echo [ERR] package.json not found. Are you in the repo root?
  exit /b 1
)

echo.
echo [INFO] Starting galgame server...
echo [INFO] You can set GALGAME_HOST / GALGAME_PORT if needed.
echo.

bun run galgame

if errorlevel 1 (
  echo.
  echo [ERR] Galgame server exited with error.
  pause
  exit /b 1
)
