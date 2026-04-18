@echo off
cd /d "C:\Users\youssef\projects\simple-websocket-app"

:: Start WebSocket server in its own window
start "🔌 WebSocket Server" cmd /k "node server.js"

:: Start Static serve in its own window
start "📦 Static Serve (5500)" cmd /k "npx serve . -p 5500"

echo ✅ Both servers started successfully.