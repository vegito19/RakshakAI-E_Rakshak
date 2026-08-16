@echo off
title RAKSHAK Public Tunnel Auto-Reconnect
:loop
echo [%time%] Launching Tunnel: https://rakshak-surat-police.loca.lt
npx localtunnel --port 5000 --local-host 127.0.0.1 --subdomain rakshak-surat-police
echo.
echo [WARNING] Tunnel crashed or disconnected! Reconnecting in 5 seconds...
timeout /t 5 /nobreak > nul
goto loop
