Django-Q integration guide

This project includes a centralized task function at `game/tasks.py`:

- `expire_waiting_rooms(minutes=60)` — expires `GameRoom` rows in status `waiting` older than `minutes`.

Recommended quickstart (Postgres + Django-Q):

1. Install:

```bash
pip install django-q
```

2. Add to `settings.py`:

```py
INSTALLED_APPS += ["django_q"]

Q_CLUSTER = {
    "name": "backgammon-q",
    "workers": 2,
    "timeout": 60,
    "retry": 120,
    "save_limit": 250,
    "orm": "default",  # use Django ORM/Postgres as broker
}
```

3. Run migrations for django-q:

```bash
python manage.py migrate
```

4. Start the worker (supervise with systemd/container):

```bash
python manage.py qcluster
```

5. Schedule or enqueue the expire task:

```py
from django_q.tasks import schedule, async_task

# one-off
async_task('game.tasks.expire_waiting_rooms', 60)

# schedule every 60 minutes
schedule('game.tasks.expire_waiting_rooms', 60, schedule_type='I', minutes=60)
```

Notes:

- The management command `python manage.py expire_waiting_rooms [minutes]` now calls the shared `expire_waiting_rooms` function. You can keep using it directly or enqueue it via Django-Q.
- Monitor queued/scheduled tasks via the `django_q` admin models.
- For high throughput or advanced routing, consider Celery with Redis instead.
