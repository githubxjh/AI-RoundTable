@echo off
setlocal
cd /d "%~dp0"
node scripts\launch_real_chrome.mjs %*
