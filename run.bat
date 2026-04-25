@echo off
cd /d "C:\Users\youssef\projects\simple-websocket-app"

:: Start WebSocket server in its own window
start "🔌 WebSocket Server" cmd /k "node server.js"

echo ✅ server started successfully.