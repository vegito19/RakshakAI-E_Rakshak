@echo off
title RAKSHAK AI - LAUNCH SERVER & PERMANENT TUNNEL
echo ========================================================
echo   RAKSHAK AI - HACKATHON LIVE BACKEND SERVER & TUNNEL
echo ========================================================
echo.
echo 1. Starting Fastify Backend on Port 5000...
start "Rakshak Backend Port 5000" /min cmd /c "cd /d C:\Users\Vineet\OneDrive\Desktop\RakshakAI-E_Rakshak && npm start"

timeout /t 3 /nobreak > nul

echo 2. Launching Public Tunnel with Auto-Reconnect...
start "Rakshak Public Tunnel" cmd /c "cd /d C:\Users\Vineet\OneDrive\Desktop\RakshakAI-E_Rakshak && run_tunnel.bat"

echo.
echo ========================================================
echo   SUCCESS! RAKSHAK IS NOW LIVE FOR JUDGES AT:
echo   https://rakshak-dashboard.vercel.app
echo ========================================================
