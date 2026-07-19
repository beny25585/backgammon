#!/bin/bash
# Setup script for Backgammon backend on macOS/Linux

echo ""
echo "============================================"
echo "Backgammon Django Backend Setup"
echo "============================================"
echo ""

# Check if venv exists
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
    if [ $? -ne 0 ]; then
        echo "Error creating virtual environment"
        exit 1
    fi
fi

# Activate venv
echo "Activating virtual environment..."
source venv/bin/activate

# Install dependencies
echo "Installing dependencies..."
pip install -r requirements.txt
if [ $? -ne 0 ]; then
    echo "Error installing dependencies"
    exit 1
fi

# Run migrations
echo "Running migrations..."
python manage.py makemigrations
python manage.py migrate
if [ $? -ne 0 ]; then
    echo "Error running migrations"
    exit 1
fi

echo ""
echo "============================================"
echo "Setup completed successfully!"
echo "============================================"
echo ""
echo "To start the server, run:"
echo "   ./run_server.sh"
echo ""
