@echo off
setlocal
cd /d "%~dp0"
node scripts\test_live_chromium.mjs %*
