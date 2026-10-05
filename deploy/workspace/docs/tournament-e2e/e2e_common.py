"""Isolation helpers for the opt-in, real-service tournament E2E run.

Importing this module does not create a database or start any service. Runtime
entry points must call prepare_runtime() before importing either application.
"""
from __future__ import annotations

import ast
import csv
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit


HARNESS_DIR = Path(__file__).resolve().parent
WORKSPACE = HARNESS_DIR.parent.parent
RUNS_DIR = HARNESS_DIR / "runs"
PORTS = {
    "game_backend": 18805,
    "tournament_backend": 18806,
    "game_frontend": 18573,
    "tournament_frontend": 18574,
    "redis": 18679,
    "dice": 18807,
}
SERVICE_ROOTS = {
    "tournament": Path(os.environ.get("E2E_TOURNAMENT_ROOT", WORKSPACE / "backgammon-tournaments-backend" / "tournaments")).resolve(),
    "game": Path(os.environ.get("E2E_GAME_ROOT", WORKSPACE / "Backgammon Game" / "backend")).resolve(),
}
_runtime = None


def require(condition, message):
    if not condition:
        raise RuntimeError("E2E isolation guard: " + message)


def guarded_run_dir(value):
    """Only new run directories inside this harness may hold mutable state."""
    raw = Path(value).absolute()
    path = raw.resolve()
    require(path != RUNS_DIR.resolve() and path.is_relative_to(RUNS_DIR.resolve()),
            "run-dir must be a child of docs/tournament-e2e/runs")
    for item in (raw, *raw.parents):
        if item.exists():
            require(not item.is_symlink(), "symbolic links are not allowed in run paths")
            require(not getattr(item.stat(), "st_file_attributes", 0) & 0x400,
                    "Windows reparse points are not allowed in run paths")
    return path


def private_directory(path):
    """Protect generated credentials before creating any files in this folder."""
    path.mkdir(parents=True, mode=0o700, exist_ok=False)
    if os.name == "nt":
        identity = subprocess.run(
            ["whoami", "/user", "/fo", "csv", "/nh"], check=True,
            capture_output=True, text=True,
        )
        sid = next(csv.reader([identity.stdout.strip()]))[1]
        require(bool(re.fullmatch(r"S-1-\d+(?:-\d+)+", sid)), "cannot determine current Windows SID")
        subprocess.run(
            ["icacls", str(path), "/inheritance:r", "/grant:r",
             f"*{sid}:(OI)(CI)F", "*S-1-5-18:(OI)(CI)F"],
            check=True, capture_output=True, text=True,
        )


def write_private(path, content):
    data = content.encode("utf-8") if isinstance(content, str) else content
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    # Windows privacy comes from the run directory's restricted ACL, above.
    if os.name != "nt":
        path.chmod(0o600)


def load_config(run_dir):
    run_dir = guarded_run_dir(run_dir)
    config_path = run_dir / "config.json"
    require(config_path.is_file() and not config_path.is_symlink(), "missing config.json")
    data = json.loads(config_path.read_text(encoding="utf-8"))
    require(data.get("E2E_DISPOSABLE") is True, "disposable manifest flag is missing")
    require(type(data.get('player_count', 16)) is int and data.get('player_count', 16) in (16, 32),
            'player count must be 16 or 32')
    require(type(data.get('recovery_checks', True)) is bool, 'recovery_checks must be boolean')
    require(data.get("workspace") == str(WORKSPACE), "workspace does not match this checkout")
    require(data.get("source_roots", {key: str(value) for key, value in SERVICE_ROOTS.items()})
            == {key: str(value) for key, value in SERVICE_ROOTS.items()},
            "application roots changed since initialization")
    engines = data.get("sqlite_engines", {})
    require(all(key in SERVICE_ROOTS and value in (
        "django.db.backends.sqlite3", f"{'game' if key == 'game' else 'tournaments'}.db.backends.sqlite3"
    ) for key, value in engines.items()), "unexpected database backend")
    require(data.get("run_dir") == str(run_dir), "run-dir does not match the manifest")
    for name in ("db", "certificates", "logs", "media", "static", "artifacts"):
        directory = run_dir / name
        require(directory.is_dir() and directory.resolve() == directory,
                "run subdirectories must be real directories inside this run")
        require(not getattr(directory.stat(), "st_file_attributes", 0) & 0x400,
                "run subdirectories cannot be Windows reparse points")
    require(bool(re.fullmatch(r"[0-9a-f]{32}", data.get("run_id", ""))), "invalid run identifier")
    require(data.get("ports") == PORTS, "only assigned E2E ports are allowed")
    require(data.get("urls") == {
        "game": f"https://127.0.0.1:{PORTS['game_frontend']}",
        "tournament": f"https://127.0.0.1:{PORTS['tournament_frontend']}",
    }, "unexpected service origin")
    for key, filename in (("cert", "localhost.crt"), ("key", "localhost.key"), ("ca", "ca.crt")):
        expected = run_dir / "certificates" / filename
        require(data.get("certificate", {}).get(key) == str(expected), "unexpected certificate path")
        require(expected.is_file() and not expected.is_symlink(), "certificate file is missing or linked")
    require(data.get('database_mode', 'sqlite') in ('sqlite', 'postgresql'), 'unknown database mode')
    if data.get('database_mode') == 'postgresql':
        from postgresql_runtime import validate
        validate(data)
    for service in SERVICE_ROOTS if data.get('database_mode') != 'postgresql' else ():
        expected = run_dir / "db" / f"{service}.sqlite3"
        require(data.get("databases", {}).get(service) == str(expected), "unexpected database path")
        require(expected.resolve().is_relative_to(run_dir), "database escaped its run directory")
        require(not expected.is_symlink(), "database must not be a symbolic link")
        require(not expected.exists() or expected.stat().st_nlink == 1,
                "database must not be a hard link to another file")
    keys = data.get("secrets", {})
    values = [keys.get(key, "") for key in ("ticket", "result", "command", "game_django", "tournament_django")]
    require(all(isinstance(value, str) and len(value) >= 48 for value in values), "missing fresh signing keys")
    require(len(set(values)) == len(values), "signing keys must be independent")
    require(data.get("admin", {}).get("username") == "E2EAdmin", "unexpected bootstrap account")
    require(len(data.get("admin", {}).get("password", "")) >= 32, "missing bootstrap password")
    return data


def _loopback(host):
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _local_wakeup_socket(address=None):
    # CPython and Twisted implement Windows wakeup pipes with ephemeral local
    # listeners. This exception is scoped to their constructors, not application
    # requests or arbitrary ephemeral outbound connections.
    frame = sys._getframe(1)
    while frame is not None:
        if (frame.f_code.co_name == "_fallback_socketpair"
                and frame.f_globals.get("__name__") == "socket"):
            # On Windows socketpair is an alias of this function, so there is
            # no frame named socketpair. Permit only its own local listener.
            listener = frame.f_locals.get("lsock")
            return (listener is not None and isinstance(address, tuple)
                    and address[:2] == listener.getsockname()[:2])
        if (frame.f_code.co_name == "socketpair"
                and frame.f_globals.get("__name__") == "socket"):
            return True
        if (frame.f_code.co_name == "__init__"
                and frame.f_globals.get("__name__") == "twisted.internet._signals"
                and type(frame.f_locals.get("self")).__name__ == "_SocketWaker"):
            server = frame.f_locals.get("server")
            return server is not None and address == server.getsockname()
        frame = frame.f_back
    return False


def install_audit_guards(config, service):
    database = Path(config["databases"][service]).resolve()
    ports = set(PORTS.values())
    if config.get('database_mode') == 'postgresql':
        from postgresql_runtime import install_connection_guard
        install_connection_guard(config, service)
        ports.add(int(config['postgresql'][service]['PORT']))

    def audit(event, args):
        if event == "sqlite3.connect":
            require(config.get('database_mode') != 'postgresql', 'SQLite fallback is forbidden in PostgreSQL runs')
            value = os.fsdecode(args[0])
            if value.startswith("file:"):
                parsed = urlsplit(value)
                value = unquote(parsed.path)
                if os.name == "nt" and re.match(r"^/[A-Za-z]:", value):
                    value = value[1:]
            require(Path(value).resolve() == database,
                    "attempted SQLite connection outside this service's disposable file")
        elif event in ("socket.connect", "socket.sendto"):
            address = args[1] if event == "socket.connect" else args[-1]
            require(isinstance(address, tuple) and len(address) >= 2,
                    "non-IP outbound sockets are forbidden")
            host, port = address[:2]
            require(_loopback(host) and (port in ports or _local_wakeup_socket(address)),
                    "outbound destination is not an assigned loopback E2E port")
        elif event == "socket.getaddrinfo":
            host, port = args[:2]
            require(host is None or _loopback(host), "external DNS is forbidden")
            require(port in (None, 0, *ports) or str(port) in {str(p) for p in ports}
                    or _local_wakeup_socket(),
                    "DNS requested an unassigned port")
        elif event in ("socket.gethostbyname", "socket.gethostbyaddr"):
            require(_loopback(args[0]), "external DNS is forbidden")

    sys.addaudithook(audit)


def prepare_runtime(run_dir, service):
    global _runtime
    require(service in SERVICE_ROOTS, "unknown service")
    config = load_config(run_dir)
    require(_runtime is None or _runtime == (config, service), "cannot switch service inside a process")
    if _runtime is not None:
        return config
    # Preserve operating-system essentials, not inherited app credentials,
    # proxies, PYTHONPATH, database URLs, or external integration settings.
    keep = {"SYSTEMROOT", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP",
            "LANG", "LC_ALL", "SYSTEMDRIVE", "NUMBER_OF_PROCESSORS"}
    environment = {key: value for key, value in os.environ.items() if key.upper() in keep}
    run = Path(config["run_dir"])
    environment.update({
        "HOME": str(run), "USERPROFILE": str(run),
        "E2E_RUN_DIR": str(run), "E2E_SERVICE": service,
        "DJANGO_SETTINGS_MODULE": f"{service}_settings", "DEBUG": "False",
        "SECRET_KEY": config["secrets"][f"{service}_django"],
        "ALLOWED_HOSTS": "127.0.0.1,localhost",
        "DATABASE_URL": database_url(config, service),
        "REDIS_URL": f"redis://127.0.0.1:{PORTS['redis']}/0",
        "CHANNEL_LAYER_BACKEND": "redis", "GAMELINK_ENABLED": "1",
        "GAMELINK_BACKGAMMON_URL": config["urls"]["game"],
        "GAMELINK_TOURNAMENTS_URL": config["urls"]["tournament"],
        "GAMELINK_TOURNAMENTS_FRONTEND_URL": config["urls"]["tournament"],
        "GAMELINK_FRONTEND_URL": config["urls"]["game"] + "/backgammon",
        "GAMELINK_TICKET_SECRET": config["secrets"]["ticket"],
        "GAMELINK_TICKET_SECRETS": config["secrets"]["ticket"],
        "GAMELINK_RESULT_SECRET": config["secrets"]["result"],
        "GAMELINK_RESULT_SECRETS": config["secrets"]["result"],
        "GAMELINK_COMMAND_SECRET": config["secrets"]["command"],
        "GAMELINK_COMMAND_SECRETS": config["secrets"]["command"],
        "ACCOUNT_FRONTEND_URL": config["urls"]["tournament"] + "/tournaments",
        "EMAIL_BACKEND": "django.core.mail.backends.locmem.EmailBackend",
        "CORS_ALLOWED_ORIGINS": ",".join(config["urls"].values()),
        "DICE_SERVICE_URL": f"http://127.0.0.1:{PORTS['dice']}",
        "WEB_PUSH_PUBLIC_KEY": "", "WEB_PUSH_PRIVATE_KEY": "", "WEB_PUSH_SUBJECT": "",
        "GOOGLE_CLIENT_ID": "", "AI_SERVICE_URL": "", "ANALYSIS_SERVICE_URL": "",
        "ANALYSIS_API_TOKEN": "", "TRANZILA_ENABLED": "0", "TRANZILA_PURCHASES_ENABLED": "0",
        "SSL_CERT_FILE": config["certificate"]["ca"],
        "REQUESTS_CA_BUNDLE": config["certificate"]["ca"],
        "NO_PROXY": "127.0.0.1,localhost,::1", "PYTHONDONTWRITEBYTECODE": "1",
    })
    os.environ.clear()
    os.environ.update(environment)
    sys.dont_write_bytecode = True
    sys.path[:0] = [str(HARNESS_DIR), str(SERVICE_ROOTS[service])]
    os.chdir(SERVICE_ROOTS[service])
    install_audit_guards(config, service)
    if service == "game":
        # Only game settings use python-decouple. Tournament settings use
        # os.environ and their local loader is suppressed separately below.
        import decouple
        decouple.config = decouple.Config(decouple.RepositoryEmpty())
    _runtime = (config, service)
    return config


def runtime_config(service):
    require(_runtime is not None and _runtime[1] == service,
            "use backend_bootstrap.py; settings cannot be imported directly")
    return _runtime[0]


def tournament_common_without_local_env():
    """Load real settings, replacing only their eager local .env reader in memory."""
    runtime_config("tournament")
    name = "tournaments.settings.common"
    require(name not in sys.modules, "tournament settings were imported before isolation")
    source_path = SERVICE_ROOTS["tournament"] / "tournaments" / "settings" / "common.py"
    tree = ast.parse(source_path.read_text(encoding="utf-8-sig"), filename=str(source_path))
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "load_local_env"]
    require(len(functions) == 1, "local environment loader changed; review isolation first")
    functions[0].body = [ast.Return(value=ast.Constant(value=None))]
    ast.fix_missing_locations(tree)
    spec = importlib.util.spec_from_file_location(name, source_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    exec(compile(tree, str(source_path), "exec"), module.__dict__)
    return module


def isolated_settings(config, service):
    run = Path(config["run_dir"])
    return {
        "SECRET_KEY": config["secrets"][f"{service}_django"],
        "DEBUG": False,
        "ALLOWED_HOSTS": ["127.0.0.1", "localhost"],
        "DATABASES": {"default": config['postgresql'][service].copy() if config.get('database_mode') == 'postgresql' else {
            "ENGINE": config.get("sqlite_engines", {}).get(service,
                "tournaments.db.backends.sqlite3" if service == "tournament" else "game.db.backends.sqlite3"),
            "NAME": config["databases"][service], "OPTIONS": {"timeout": 20},
        }},
        "CHANNEL_LAYERS": {"default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {"hosts": [f"redis://127.0.0.1:{PORTS['redis']}/0"],
                       "prefix": f"e2e:{config['run_id']}:{service}", "capacity": 150, "expiry": 60},
        }},
        "CACHES": {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache",
                               "LOCATION": f"e2e-{config['run_id']}-{service}"}},
        "CSRF_TRUSTED_ORIGINS": list(config["urls"].values()),
        "SECURE_PROXY_SSL_HEADER": ("HTTP_X_FORWARDED_PROTO", "https"),
        "SESSION_COOKIE_NAME": f"e2e_{service}_session",
        "CSRF_COOKIE_NAME": "csrftoken" if service == "tournament" else "e2e_game_csrf",
        "SESSION_COOKIE_SECURE": True, "CSRF_COOKIE_SECURE": True,
        "CSRF_COOKIE_HTTPONLY": False, "SESSION_COOKIE_SAMESITE": "Lax", "CSRF_COOKIE_SAMESITE": "Lax",
        "MEDIA_ROOT": run / "media" / service, "STATIC_ROOT": run / "static" / service,
        "EMAIL_BACKEND": "django.core.mail.backends.locmem.EmailBackend",
        "LOGGING": {
            "version": 1, "disable_existing_loggers": False,
            "formatters": {"e2e": {"format": "%(levelname)s %(asctime)s %(name)s %(message)s"}},
            "handlers": {
                "e2e_file": {"class": "logging.FileHandler", "filename": str(run / "logs" / f"{service}.log"),
                             "formatter": "e2e", "level": "INFO", "encoding": "utf-8"},
                "e2e_console": {"class": "logging.StreamHandler", "formatter": "e2e", "level": "INFO"},
            },
            "root": {"handlers": ["e2e_file", "e2e_console"], "level": "INFO"},
            "loggers": {name: {"handlers": [], "level": "INFO", "propagate": True}
                        for name in ("django", "django.incident", "frontend", "gamelink", "tournaments", "game")},
        },
    }


def database_url(config, service):
    if config.get('database_mode') != 'postgresql':
        return 'sqlite:///' + Path(config['databases'][service]).as_posix()
    from urllib.parse import quote
    database = config['postgresql'][service]
    return (f"postgresql://{quote(database['USER'], safe='')}:{quote(database['PASSWORD'], safe='')}"
            f"@{database['HOST']}:{database['PORT']}/{database['NAME']}")
