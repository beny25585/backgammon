"""Run-owned PostgreSQL databases on the existing local cluster.

Provisioning is opt-in and happens only when the user runs the harness. Neither
application receives the administrator password or permission to create roles.
"""
from contextlib import contextmanager
from pathlib import Path
import os
import secrets

from e2e_common import WORKSPACE, require


def provision(config):
    import psycopg2
    try:
        _provision(config)
    except psycopg2.Error as error:
        # Never let an administrator error print bound CREATE ROLE passwords.
        raise RuntimeError(f'Local PostgreSQL provisioning failed; SQLSTATE={error.pgcode or "connection"}. '
                           'Inspect the local server log; private recovery credentials were retained.') from None


def _provision(config):
    import psycopg2
    from psycopg2 import sql

    cluster = WORKSPACE / 'backgammon-tournaments-backend' / '.local-postgresql'
    password_file = Path(os.environ.get('E2E_PG_ADMIN_PASSWORD_FILE') or cluster / 'admin.password')
    data_directory = Path(os.environ.get('E2E_PG_DATA_DIRECTORY') or cluster / 'data').resolve()
    require(password_file.is_file() and not password_file.is_symlink(),
            'local PostgreSQL administrator password file is missing')
    port = int(os.environ.get('E2E_PG_PORT', '55432'))
    require(1 <= port <= 65535, 'invalid local PostgreSQL port')
    require(port not in config['ports'].values(), 'PostgreSQL port conflicts with an E2E service')
    prefix = 'e2e_' + config['run_id']
    databases = {
        service: {'ENGINE': 'django.db.backends.postgresql', 'NAME': f'{prefix}_{service}',
                  'USER': f'{prefix}_{service}', 'PASSWORD': secrets.token_urlsafe(36),
                  'HOST': '127.0.0.1', 'PORT': str(port), 'CONN_MAX_AGE': 0,
                  'OPTIONS': {'connect_timeout': 5, 'application_name': f'e2e:{service}'}}
        for service in ('game', 'tournament')
    }
    # Save recovery credentials before creating anything. No destructive cleanup
    # is attempted after partial provisioning or after a failed test.
    config['database_mode'] = 'postgresql'
    config['postgresql'] = databases
    config['databases'] = {key: value['NAME'] for key, value in databases.items()}
    from e2e_common import write_private
    import json
    write_private(Path(config['run_dir']) / 'postgresql-recovery.json', json.dumps(databases, indent=2))
    admin = psycopg2.connect(host='127.0.0.1', port=port, dbname='postgres', user='postgres',
                            password=password_file.read_text(encoding='utf-8').strip(), connect_timeout=5)
    try:
        admin.autocommit = True
        with admin.cursor() as cursor:
            cursor.execute('SHOW data_directory')
            require(Path(cursor.fetchone()[0]).resolve() == data_directory,
                    'PostgreSQL is not the requested local cluster; nothing was provisioned')
            for database in databases.values():
                name = database['NAME']
                cursor.execute('SELECT 1 FROM pg_database WHERE datname=%s', (name,))
                require(cursor.fetchone() is None, 'run database already exists; refusing to reuse it')
                cursor.execute('SELECT 1 FROM pg_roles WHERE rolname=%s', (name,))
                require(cursor.fetchone() is None, 'run role already exists; refusing to reuse it')
                cursor.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD %s NOSUPERUSER NOCREATEDB NOCREATEROLE').format(sql.Identifier(name)),
                               (database['PASSWORD'],))
                cursor.execute(sql.SQL("CREATE DATABASE {} OWNER {} ENCODING 'UTF8' TEMPLATE template0").format(
                    sql.Identifier(name), sql.Identifier(name)))
                cursor.execute(sql.SQL('COMMENT ON DATABASE {} IS %s').format(sql.Identifier(name)),
                               ('tournament-e2e:' + config['run_id'],))
    finally:
        admin.close()


def validate(config):
    databases = config.get('postgresql', {})
    require(set(databases) == {'game', 'tournament'}, 'both PostgreSQL databases are required')
    for service, database in databases.items():
        expected = f"e2e_{config['run_id']}_{service}"
        require(database == {
            'ENGINE': 'django.db.backends.postgresql', 'NAME': expected, 'USER': expected,
            'PASSWORD': database.get('PASSWORD'), 'HOST': '127.0.0.1', 'PORT': database.get('PORT'),
            'CONN_MAX_AGE': 0, 'OPTIONS': {'connect_timeout': 5, 'application_name': f'e2e:{service}'},
        }, 'unexpected PostgreSQL connection settings')
        require(isinstance(database['PASSWORD'], str) and len(database['PASSWORD']) >= 32,
                'missing disposable PostgreSQL password')
        require(str(database['PORT']).isdigit() and 1 <= int(database['PORT']) <= 65535
                and int(database['PORT']) not in config['ports'].values(), 'invalid PostgreSQL port')
        require(config['databases'].get(service) == expected, 'PostgreSQL database name escaped its run')


def install_connection_guard(config, service):
    # libpq opens sockets in C, outside Python's socket audit hooks. Enforce the
    # same isolation at both supported Django driver's connection entry points.
    target = config['postgresql'][service]

    def guarded(original, parse):
        def connect(dsn='', *args, **kwargs):
            require(not args, 'unexpected PostgreSQL positional connection arguments')
            values = {**parse(dsn or ''), **kwargs}
            for key, expected in (('dbname', target['NAME']), ('user', target['USER']),
                                  ('host', target['HOST']), ('port', target['PORT']),
                                  ('password', target['PASSWORD'])):
                require(str(values.get(key, '')) == str(expected), 'PostgreSQL connection escaped its run')
            require(not any(key in values for key in ('service', 'servicefile', 'hostaddr')),
                    'PostgreSQL service files and alternate addresses are forbidden')
            return original(dsn, **kwargs)
        return connect

    import psycopg2
    from psycopg2.extensions import parse_dsn
    psycopg2.connect = guarded(psycopg2.connect, parse_dsn)
    try:
        import psycopg
    except ImportError:
        return
    from psycopg.conninfo import conninfo_to_dict
    psycopg.connect = guarded(psycopg.connect, conninfo_to_dict)


class Rows:
    """The small SQLite-like read interface used by the existing status report."""
    def __init__(self, connection):
        self.connection = connection

    def execute(self, statement, parameters=()):
        from psycopg2.extras import DictCursor
        cursor = self.connection.cursor(cursor_factory=DictCursor)
        cursor.execute(statement.replace('?', '%s'), parameters)
        return cursor

    def columns(self, table):
        rows = self.execute('SELECT column_name FROM information_schema.columns '
                            "WHERE table_schema='public' AND table_name=%s", (table,))
        return {row[0] for row in rows}


@contextmanager
def readonly(config, service):
    import psycopg2
    database = config['postgresql'][service]
    connection = psycopg2.connect(host=database['HOST'], port=database['PORT'], dbname=database['NAME'],
                                  user=database['USER'], password=database['PASSWORD'], connect_timeout=5)
    try:
        connection.set_session(readonly=True)
        rows = Rows(connection)
        # Database comments are cluster-wide (pg_shdescription), rather than
        # per-database object comments (pg_description).
        identity = rows.execute("SELECT datname, pg_get_userbyid(datdba), "
                                "shobj_description(oid, 'pg_database') FROM pg_database "
                                "WHERE datname=current_database()").fetchone()
        require(identity is not None and identity[0] == database['NAME'] and identity[1] == database['USER']
                and identity[2] == 'tournament-e2e:' + config['run_id'], 'database ownership marker is missing')
        yield rows
    finally:
        connection.close()
