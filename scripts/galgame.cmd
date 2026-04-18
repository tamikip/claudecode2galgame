@echo off
rem Galgame launcher: cd to repo root (this script lives in scripts/), then start server.
rem Add the "scripts" folder to PATH to run `galgame` from any directory.

setlocal
cd /d "%~dp0.."

where bun >nul 2>nul
if errorlevel 1 (
  echo [ERR] Bun not found in PATH. Install from https://bun.sh/
  exit /b 1
)

if not exist "package.json" (
  echo [ERR] package.json not found. Expected repo root: %CD%
  exit /b 1
)

bun run galgame
exit /b %errorlevel%
