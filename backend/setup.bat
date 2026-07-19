@echo off
REM Setup script for Backgammon backend on Windows

echo.
echo ============================================
echo Backgammon Django Backend Setup
echo ============================================
echo.

REM Check if venv exists
if not exist "venv\" (
    echo Creating virtual environment...
    python -m venv venv
    if errorlevel 1 (
        echo Error creating virtual environment
        exit /b 1
    )
)

REM Activate venv
echo Activating virtual environment...
call venv\Scripts\activate.bat

REM Install dependencies
echo Installing dependencies...
pip install -r requirements.txt
if errorlevel 1 (
    echo Error installing dependencies
    exit /b 1
)

REM Run migrations
echo Running migrations...
python manage.py makemigrations
python manage.py migrate
if errorlevel 1 (
    echo Error running migrations
    exit /b 1
)

echo.
echo ============================================
echo Setup completed successfully!
echo ============================================
echo.
echo To start the server, run:
echo   run_server.bat
echo.
pause
