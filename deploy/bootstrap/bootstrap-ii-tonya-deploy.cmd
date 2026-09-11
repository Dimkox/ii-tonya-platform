@echo off
title ii-Tonya production SSH bootstrap
color 0B
echo ================================================================
echo ii-Tonya production bootstrap
echo Server: root@157.22.187.237
echo Enter the ROOT SSH password below.
echo Do not close this window. Wait for PROD_BOOTSTRAP_OK.
echo ================================================================
echo.
ssh.exe -o PreferredAuthentications=password -o PubkeyAuthentication=no -o NumberOfPasswordPrompts=3 -o StrictHostKeyChecking=yes -o UserKnownHostsFile=C:\Users\Dmitry\.ssh\known_hosts root@157.22.187.237 "tr -d '\r' ^| bash" ^< C:\Users\Dmitry\Documents\Codex\2026-07-28\new-chat\bootstrap-ii-tonya-remote.sh
if errorlevel 1 goto failed
echo.
echo PROD_BOOTSTRAP_OK
timeout /t 2 /nobreak >nul
exit /b 0
:failed
echo.
echo PROD_BOOTSTRAP_FAILED
pause
exit /b 1
