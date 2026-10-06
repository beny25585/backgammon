"""Private snapshots and durable stage records for the opt-in release rehearsal."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import uuid
from datetime import datetime, timezone


def require(value, message):
    if not value:
        raise ValueError(message)


def read(path):
    path = Path(path)
    require(path.is_file() and not path.is_symlink(), 'Missing or unsafe artifact: ' + path.name)
    return json.loads(path.read_text(encoding='utf-8'))


def save(path, value):
    path = Path(path)
    require(not path.is_symlink(), 'Unsafe output artifact')
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    with temporary.open('x', encoding='utf-8', newline='\n') as stream:
        temporary.chmod(0o600)
        json.dump(value, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def command(args, **kwargs):
    return subprocess.check_output([str(item) for item in args], **kwargs)


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def timestamp():
    return datetime.now(timezone.utc).isoformat()


class Stages:
    def __init__(self, directory, identity):
        self.directory = Path(directory)
        self.file = self.directory / 'report.json'
        if self.file.exists():
            self.report = read(self.file)
            require(self.report['identity'] == identity, 'A saved validation uses different source revisions')
        else:
            self.report = {'schema_version': 1, 'identity': identity, 'stages': {},
                           'passed': False, 'cutover_performed': False}
            save(self.file, self.report)

    def run(self, name, operation):
        previous = self.report['stages'].get(name, {})
        if previous.get('status') == 'passed':
            print('ALREADY VERIFIED: ' + name, flush=True)
            return previous['result']
        row = {'status': 'running', 'started_at': timestamp(),
               'attempt': previous.get('attempt', 0) + 1}
        self.report['stages'][name] = row
        self.report['passed'] = False
        save(self.file, self.report)
        print('START: ' + name, flush=True)
        try:
            row['result'] = operation()
        except BaseException as exc:
            # Detailed child output stays in private logs; exceptions can contain credentials.
            row.update(status='failed', error_type=type(exc).__name__, finished_at=timestamp())
            save(self.file, self.report)
            print('FAILED: ' + name + '; preserved report: ' + str(self.file), flush=True)
            raise
        row.update(status='passed', finished_at=timestamp())
        save(self.file, self.report)
        print('VERIFIED: ' + name, flush=True)
        return row['result']


class Postgres:
    def __init__(self, project):
        require(project == 'backgammon-rehearsal-20261005t184922z'
                or re.fullmatch(r'backgammon-candidate-[a-f0-9]{32}', project), 'Unexpected Docker project')
        self.container = project + '-postgres-1'
        value = json.loads(command(['sudo', 'docker', 'inspect', self.container, '--format',
            '{"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
            '"service":{{json (index .Config.Labels "com.docker.compose.service")}},'
            '"health":{{json .State.Health.Status}}}'], text=True))
        require(value == {'project': project, 'service': 'postgres', 'health': 'healthy'},
                'The pinned rehearsal PostgreSQL container is not healthy')
        self.prefix = ['sudo', 'docker', 'exec', '--user', 'postgres', self.container]

    def sql(self, database, sql):
        require(re.fullmatch(r'[a-z][a-z0-9_]{0,62}', database), 'Unsafe database name')
        return command([*self.prefix, 'psql', '-X', '-At', '-U', 'postgres', '-d', database,
                        '-v', 'ON_ERROR_STOP=1', '-c', sql], text=True).strip()

    @staticmethod
    def quote(identifier):
        return '"' + identifier.replace('"', '""') + '"'

    def fingerprint(self, database, columns=None):
        if columns is None:
            columns = json.loads(self.sql(database,
                "SELECT COALESCE(json_object_agg(table_name, names), '{}'::json) FROM "
                "(SELECT table_name, json_agg(column_name ORDER BY ordinal_position) names "
                "FROM information_schema.columns WHERE table_schema='public' AND table_name IN "
                "(SELECT table_name FROM information_schema.tables WHERE table_schema='public' "
                "AND table_type='BASE TABLE') GROUP BY table_name) s"))
        rows = {}
        for table, names in sorted(columns.items()):
            projection = ','.join(self.quote(name) for name in names)
            expression = f'(SELECT {projection} FROM public.{self.quote(table)}) t'
            sql = f'COPY (SELECT row_to_json(t)::text FROM {expression} ORDER BY row_to_json(t)::text COLLATE "C") TO STDOUT'
            args = [*self.prefix, 'psql', '-X', '-q', '-U', 'postgres', '-d', database,
                    '-v', 'ON_ERROR_STOP=1', '-c', sql]
            digest = hashlib.sha256()
            with subprocess.Popen(args, stdout=subprocess.PIPE) as process:
                for chunk in iter(lambda: process.stdout.read(1024 * 1024), b''):
                    digest.update(chunk)
                require(process.wait() == 0, 'Could not fingerprint restored data')
            count = int(self.sql(database, f'SELECT count(*) FROM public.{self.quote(table)}'))
            rows[table] = {'rows': count, 'sha256': digest.hexdigest()}
        return {'columns': columns, 'tables': rows}

    def sequences(self, database):
        names = json.loads(self.sql(database, "SELECT COALESCE(json_agg(sequencename ORDER BY sequencename), '[]'::json) "
                                   "FROM pg_sequences WHERE schemaname='public'"))
        return {name: self.sql(database, 'SELECT last_value::text || ' + "':' || is_called::text FROM public."
                               + self.quote(name)) for name in names}

    def create(self, name, role, marker):
        match = re.fullmatch(r'bgv_(restore|test)_([a-f0-9]{12})_[a-z0-9_]{1,22}', name)
        require(match,
                'Restoration/tests require a new run-owned database')
        require(role in ('backgammon_game', 'backgammon_tournaments', 'backgammon_analysis'),
                'Unexpected database owner')
        require(re.fullmatch(r'backgammon-validation:[a-f0-9]{32}:[a-z0-9_:]+', marker),
                'Invalid validation database marker')
        validation = marker.split(':')[1]
        require(match[2] == validation[:12]
                and marker == f'backgammon-validation:{validation}:{match[1]}:{name}',
                'Database name and marker must belong to the same validation')
        require(not self.sql('postgres', f"SELECT 1 FROM pg_database WHERE datname='{name}'"),
                'Refusing to overwrite an existing restoration/test database')
        self.sql('postgres', f'CREATE DATABASE "{name}" OWNER "{role}" TEMPLATE template0')
        self.sql('postgres', f"COMMENT ON DATABASE \"{name}\" IS '{marker}'")
        self.sql('postgres', f'REVOKE ALL ON DATABASE "{name}" FROM PUBLIC')

    def dump(self, name, destination):
        require(re.fullmatch(r'backgammon_(game|tournaments|analysis)(_e2e_[a-f0-9]{12})?', name),
                'Only the existing rehearsal databases may be backed up')
        with Path(destination).open('xb') as stream:
            os.chmod(destination, 0o600)
            subprocess.run([*self.prefix, 'pg_dump', '-U', 'postgres', '--format=custom', name],
                           stdout=stream, check=True)

    def restore(self, source, name, role):
        require(re.fullmatch(r'bgv_restore_[a-f0-9]{12}_[a-z0-9_]{1,22}', name)
                and role in ('backgammon_game', 'backgammon_tournaments', 'backgammon_analysis'),
                'Refusing to restore over a work database')
        with Path(source).open('rb') as stream:
            subprocess.run(['sudo', 'docker', 'exec', '-i', '--user', 'postgres', self.container,
                            'pg_restore', '-U', 'postgres', '-d', name, '--role', role,
                            '--single-transaction', '--exit-on-error', '--no-owner', '--no-acl'],
                           stdin=stream, check=True)


def declared_asset_sources(mounts):
    """Collect Docker paths; resolve/read them only in the privileged asset worker."""
    roots = set()
    for mount in mounts:
        destination = mount['Destination']
        if destination.startswith('/run/secrets/') or destination in (
                '/data/media', '/srv/media', '/opt/e2e/game.json', '/opt/e2e/tournaments.json',
                '/opt/e2e/analysis.json', '/opt/e2e/session.json'):
            source = mount['Source']
            require(isinstance(source, str) and PurePosixPath(source).is_absolute()
                    and '..' not in PurePosixPath(source).parts, 'Invalid declared asset mount source')
            roots.add(source)
    return roots


def asset_snapshot(roots, output):
    """Invoked with sudo; copy and restore only declared mounts into a new private directory."""
    output = Path(output)
    require(not output.exists(), 'Asset snapshot destination already exists')
    require(output.is_absolute() and output.is_relative_to(Path('/home/dev/backgammon-project/backups')),
            'Asset backup must remain under the managed backups directory')
    output.mkdir(mode=0o700)
    payload = output / 'payload'
    payload.mkdir(mode=0o700)
    for index, value in enumerate(roots):
        source = Path(value).resolve(strict=True)
        allowed = (source.is_relative_to(Path('/home/dev/backgammon-project'))
                   or source.is_relative_to(Path('/etc/backgammon-docker'))
                   or source.is_relative_to(Path('/var/lib/docker/volumes')))
        require(allowed, 'A declared secret/media mount is outside the managed backup scope')
        target = payload / str(index)
        if source.is_file():
            target.mkdir()
            shutil.copy2(source, target / 'file')
        else:
            require(source.is_dir(), 'Unsupported asset mount')
            for directory, folders, files in os.walk(source, followlinks=False):
                require(not any(Path(directory, name).is_symlink() for name in folders + files),
                        'Asset tree contains a symlink; inspect it before backup')
            shutil.copytree(source, target)
        original_paths = [source, *source.rglob('*')] if source.is_dir() else [source]
        for original in original_paths:
            copied = target / original.relative_to(source) if source.is_dir() else target / 'file'
            stat = original.stat()
            os.chown(copied, stat.st_uid, stat.st_gid)
    archive = output / 'assets.tar'
    with tarfile.open(archive, 'w') as bundle:
        bundle.add(payload, arcname='payload')
    archive.chmod(0o600)
    restored = output / 'restored-assets'
    restored.mkdir(mode=0o700)
    with tarfile.open(archive) as bundle:
        for entry in bundle:
            relative = Path(entry.name)
            require(not relative.is_absolute() and '..' not in relative.parts
                    and relative.parts[0] == 'payload' and (entry.isdir() or entry.isfile()),
                    'Unsafe asset archive entry')
            target = restored / relative
            if entry.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with bundle.extractfile(entry) as source, target.open('xb') as destination:
                    shutil.copyfileobj(source, destination)
            os.chown(target, entry.uid, entry.gid)
            target.chmod(entry.mode)
    def inventory(directory):
        return {file.relative_to(directory).as_posix(): {'sha256': sha(file), 'mode': file.stat().st_mode & 0o777,
                 'uid': file.stat().st_uid, 'gid': file.stat().st_gid}
                for file in directory.rglob('*') if file.is_file()}
    expected = inventory(payload)
    require(expected == inventory(restored / 'payload'), 'Restored secrets/media differ from the snapshot')
    result = {'restored_and_verified': True, 'file_count': len(expected), 'archive_sha256': sha(archive)}
    save(output / 'verified.json', result)
    return result


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    arguments = parser.parse_args()
    print(json.dumps(asset_snapshot(read(arguments.assets), arguments.output)))
