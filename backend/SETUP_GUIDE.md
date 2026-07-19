# Backgammon Django Backend Setup Guide

## Quick Start (Windows)

```bash
cd backend
setup.bat
run_server.bat
```

## Quick Start (macOS/Linux)

```bash
cd backend
chmod +x setup.sh run_server.sh
./setup.sh
./run_server.sh
```

## Manual Setup

### Step 1: Create Virtual Environment

**Windows:**

```bash
python -m venv venv
venv\Scripts\activate
```

**macOS/Linux:**

```bash
python3 -m venv venv
source venv/bin/activate
```

### Step 2: Install Dependencies

```bash
pip install -r requirements.txt
```

### Step 3: Setup Database

```bash
python manage.py makemigrations
python manage.py migrate
```

### Step 4: Create Superuser (Optional)

```bash
python manage.py createsuperuser
```

### Step 5: Run Server

```bash
daphne -b 0.0.0.0 -p 8000 backgammon_project.asgi:application
```

The server will be available at:

- **HTTP API**: `http://localhost:8000`
- **WebSocket**: `ws://localhost:8000/ws/game/<room_id>/`

## Server Endpoints

### Health Check

```
GET http://localhost:8000/api/health/
```

### Create Game Room

```
POST http://localhost:8000/api/room/create/
```

Response:

```json
{
  "status": "created",
  "room_id": "uuid-here",
  "message": "Game room created successfully"
}
```

### WebSocket Connection

```
ws://localhost:8000/ws/game/{room_id}/
```

Connect with room ID from `create_room` response.

## Development

### Admin Panel

```
http://localhost:8000/admin
```

Login with superuser credentials created in Step 4.

### Debug Mode

Edit `backgammon_project/settings.py`:

```python
DEBUG = True
```

### Restart Server After Changes

Press `Ctrl+C` and run the server command again.

## Troubleshooting

### Port Already in Use

If port 8000 is already in use, use a different port:

```bash
daphne -b 0.0.0.0 -p 9000 backgammon_project.asgi:application
```

Then update frontend `.env`:

```
VITE_SERVER_URL=ws://localhost:9000
```

### Virtual Environment Issues

Delete `venv` folder and recreate:

```bash
rm -rf venv  # Linux/macOS
rmdir /s venv  # Windows
python -m venv venv
pip install -r requirements.txt
```

### Database Errors

Reset database:

```bash
rm db.sqlite3  # Linux/macOS
del db.sqlite3  # Windows
python manage.py migrate
```

### WebSocket Connection Issues

1. Ensure Daphne is running (not Django dev server)
2. Check WebSocket URL format
3. Verify frontend CORS configuration
4. Check browser console for errors

## Frontend Integration

Update `frontend/.env`:

```
VITE_SERVER_URL=ws://localhost:8000
```

Then start frontend dev server:

```bash
cd ../frontend
npm run dev
```

Both servers should be running:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`

## Production Deployment

1. Set `DEBUG = False`
2. Update `SECRET_KEY` to a secure value
3. Set `ALLOWED_HOSTS` properly
4. Use PostgreSQL instead of SQLite
5. Use Redis for channel layers
6. Deploy with Gunicorn + Daphne
7. Use HTTPS/WSS
8. Configure proper CORS

See `README.md` for more details.
