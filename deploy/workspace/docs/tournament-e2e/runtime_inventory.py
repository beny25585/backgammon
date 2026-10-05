"""Public runtime/code fingerprints, without reading environment credentials."""
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform

from e2e_common import SERVICE_ROOTS, write_private


def fingerprint(root):
    digest = hashlib.sha256()
    count = 0
    ignored = {'.git', '.venv', 'venv', 'env', 'node_modules', '__pycache__',
               '.local-postgresql', 'runs', 'dist', 'build', 'media', 'staticfiles',
               'logs', 'artifacts', '.cache', '.pytest_cache', '.mypy_cache'}
    for directory, folders, files in os.walk(root, followlinks=False):
        folders[:] = sorted(name for name in folders if name not in ignored
                            and not Path(directory, name).is_symlink())
        for name in sorted(files):
            file = Path(directory, name)
            if file.is_symlink() or name.startswith('.env'):
                continue
            if file.suffix not in {'.py', '.ts', '.tsx', '.vue', '.css', '.html', '.json'} \
                    and name not in {'requirements.txt', 'pnpm-lock.yaml', 'package-lock.json'}:
                continue
            digest.update(file.relative_to(root).as_posix().encode() + b'\0')
            digest.update(hashlib.sha256(file.read_bytes().replace(b'\r\n', b'\n')).digest())
            count += 1
    return {'sha256': digest.hexdigest(), 'files': count}


def inventory(config, service):
    packages = {}
    for name in ('Django', 'asgiref', 'daphne', 'channels', 'channels-redis', 'psycopg2-binary',
                 'psycopg', 'dj-database-url', 'cryptography', 'python-decouple'):
        try:
            packages[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            packages[name] = None
    report = {'service': service, 'python': platform.python_version(), 'os': platform.system(),
              'machine': platform.machine(), 'packages': packages,
              'source': fingerprint(SERVICE_ROOTS[service]),
              'database_engine': config.get('database_mode', 'sqlite'),
              'connection_max_age': 0, 'database_ownership': 'fresh run only'}
    if service == 'game':
        report['websocket_database_workers'] = (
            int(os.environ.get('GAME_WS_DB_WORKERS', '4'))
            if config.get('database_mode') == 'postgresql' else 1
        )
    if config.get('database_mode') == 'postgresql':
        from postgresql_runtime import readonly
        with readonly(config, service) as database:
            report['postgresql'] = dict(database.execute(
                "SELECT current_setting('server_version') AS version, "
                "current_setting('server_version_num') AS version_number, "
                "current_setting('default_transaction_isolation') AS isolation, "
                "current_setting('fsync') AS fsync, current_setting('synchronous_commit') AS synchronous_commit, "
                "current_setting('full_page_writes') AS full_page_writes, "
                "current_setting('max_connections') AS max_connections").fetchone())
    import redis
    from e2e_common import PORTS
    client = redis.Redis(host='127.0.0.1', port=PORTS['redis'], socket_connect_timeout=5, socket_timeout=5)
    try:
        info = client.info('server')
        report['redis'] = {key: info.get(key) for key in ('redis_version', 'memurai_version', 'redis_mode')}
    finally:
        client.close()
    write_private(Path(config['run_dir']) / f'runtime-{service}.json', json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
