@echo off
REM Run Backgammon backend server on Windows

echo.
echo Starting Backgammon Django Backend...
echo.
echo Server will be running at:
echo   HTTP: http://localhost:8000
echo   WebSocket: ws://localhost:8000/ws/game/<room_id>/
echo.
echo Press Ctrl+C to stop the server
echo.

REM Activate venv if it exists
if exist "venv\" (
    call venv\Scripts\activate.bat
)

REM Run Daphne server
echo Running server with Daphne...
daphne -b 0.0.0.0 -p 8000 backgammon_project.asgi:application

REM Alternative: use Django development server (limited WebSocket support)
REM python manage.py runserver 0.0.0.0:8000

pause
