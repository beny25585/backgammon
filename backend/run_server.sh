#!/bin/bash
# Run Backgammon backend server on macOS/Linux

echo ""
echo "Starting Backgammon Django Backend..."
echo ""
echo "Server will be running at:"
echo "   HTTP: http://localhost:8000"
echo "   WebSocket: ws://localhost:8000/ws/game/<room_id>/"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Activate venv if it exists
if [ -d "venv" ]; then
    source venv/bin/activate
fi

# Run Daphne server
echo "Running server with Daphne..."
daphne -b 0.0.0.0 -p 8000 backgammon_project.asgi:application

# Alternative: use Django development server (limited WebSocket support)
# python manage.py runserver 0.0.0.0:8000
