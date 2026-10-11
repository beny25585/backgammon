"""Check committed sources, push/pull exact revisions, and update existing Docker production.

No commit, reset, force push, database import, or production volume removal.
The initial Docker cutover must have completed successfully before deployment.
"""
import argparse
import copy
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import subprocess
import sys
import tarfile
import time
import uuid
import zipfile

SERVER_ROOT = Path('/home/dev/backgammon-project')
SSH_TARGET = 'administrator@38.247.146.17'
PROJECT = 'backgammon-candidate-da383537b98a4b08b3fe814cd44c880a'
ORIGIN = 'https://38.247.146.17.nip.io'
CUTOVER = SERVER_ROOT / 'reports/production-cutover/r8-20261008T081712Z-7a2cfbd7edd9'
SOURCES = {
    'Backgammon Game': ('master', 'beny25585/backgammon', 'backgammon'),
    'backgammon-tournaments': ('master', 'beny25585/backgammon-tournament-ui', 'backgammon-tournament-ui'),
    'backgammon-tournaments-backend': ('master', 'Maestroxr/tournaments', 'backgammon-tournaments-backend'),
    'backgammon-analysis-service': ('main', 'beny25585/backgammon-analysis-service', 'backgammon-analysis-service'),
}
IMAGES = {
    'game': ('Backgammon Game', 'docker/python.Dockerfile', 'Backgammon Game/backend'),
    'tournaments': ('backgammon-tournaments-backend', 'docker/python.Dockerfile', 'backgammon-tournaments-backend'),
    'analysis': ('backgammon-analysis-service', 'docker/analysis.Dockerfile', None),
    'dice': ('Backgammon Game', 'docker/dice.Dockerfile', None),
    'game-frontend': ('Backgammon Game', 'docker/frontend.Dockerfile', 'Backgammon Game/frontend'),
    'tournaments-frontend': ('backgammon-tournaments', 'docker/frontend.Dockerfile', 'backgammon-tournaments'),
    'admin-frontend': ('backgammon-tournaments-backend', 'docker/frontend.Dockerfile', 'backgammon-tournaments-backend/admin-frontend'),
}
BACKENDS = {
    'game': ('/app', 'backgammon_project.settings_docker'),
    'tournaments': ('/app/tournaments', 'tournaments.settings.docker'),
    'analysis': ('/app', 'config.docker'),
}
SERVICE_IMAGE = {
    'game-api': 'game', 'game-tasks': 'game', 'game-migrate': 'game',
    'tournaments-api': 'tournaments', 'tournaments-tasks': 'tournaments',
    'push-worker': 'tournaments', 'tournaments-migrate': 'tournaments', 'tournaments-transfer': 'tournaments',
    'analysis-api': 'analysis', 'analysis-worker': 'analysis', 'analysis-migrate': 'analysis',
    'dice': 'dice', 'game-frontend': 'game-frontend',
    'tournaments-frontend': 'tournaments-frontend', 'admin-frontend': 'admin-frontend',
}
APPS = ('game-api', 'tournaments-api', 'analysis-api', 'game-frontend', 'tournaments-frontend', 'admin-frontend', 'dice')
WORKERS = ('game-tasks', 'tournaments-tasks', 'analysis-worker', 'push-worker')
PROFILES = ('--profile', 'live', '--profile', 'workers', '--profile', 'tournament-workers', '--profile', 'operations')
# These files are outside the application/image inputs. Backend checks still rerun
# with the current release-test settings mounted into the retained images.
RESUME_TOOL_FILES = {
    'deploy/workspace/operations/release_pipeline.py',
    'deploy/workspace/operations/release_test_settings.py',
    'deploy/workspace/operations/test_release_pipeline.py',
    'deploy/workspace/operations/publish_and_deploy.ps1',
    'deploy/workspace/operations/AUTOMATIC_RELEASE.he.md',
}
RESUME_COMPLETED_STAGES = (
    'game-dependencies', 'playwright-browser', 'game-frontend-tests', 'game-frontend-build',
    'tournaments-dependencies', 'tournaments-frontend-tests', 'tournaments-frontend-build',
    'admin-dependencies', 'admin-frontend-tests', 'admin-frontend-build',
    *('build-' + kind for kind in IMAGES),
    'test-network', 'test-postgres', 'test-redis',
)


def require(value, message):
    if not value:
        raise RuntimeError(message)


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    temporary.chmod(0o600)
    temporary.replace(path)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def capture(args, cwd=None):
    result = subprocess.run(list(map(str, args)), cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        # Callers never pass credentials as arguments. Environment/config output is private.
        detail = result.stderr.decode('utf-8', errors='replace')[-6000:]
        raise RuntimeError(f'{Path(str(args[0])).name} failed ({result.returncode}): {detail}')
    return result.stdout


class Runner:
    def __init__(self, directory):
        self.directory = directory
        directory.mkdir(parents=True, exist_ok=True)
        directory.chmod(0o700)
        self.stage = 'preflight'
        self.counter = 0

    def run(self, stage, args, cwd=None, env=None):
        self.stage = stage
        self.counter += 1
        log = self.directory / f'{self.counter:03d}-{stage}.log'
        print(f'\n[{stage}] Log: {log}', flush=True)
        with log.open('wb') as output:
            log.chmod(0o600)
            process = subprocess.Popen(list(map(str, args)), cwd=cwd, env=env,
                                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            try:
                for line in iter(process.stdout.readline, b''):
                    output.write(line)
                    output.flush()
                    print(line.decode('utf-8', errors='replace').rstrip(), flush=True)
                result = process.wait()
            except BaseException:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                raise
            finally:
                process.stdout.close()
        require(result == 0, f'{stage} failed (exit {result}). Log: {log}')


def git(repository, *args):
    return capture(['git', '-c', 'safe.directory=' + repository.as_posix(), '-C', repository, *args]).decode().strip()


def github_repository(url):
    match = re.fullmatch(r'(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)([\w.-]+/[\w.-]+?)(?:\.git)?/?', url, re.I)
    require(match, 'Unsupported GitHub remote; credentials in URLs are not supported')
    return match[1].lower()


def source_inventory(root, server=False):
    result = {}
    for name, (branch, origin, server_name) in SOURCES.items():
        repository = root / (server_name if server else name)
        require(repository.is_dir() and not repository.is_symlink(), f'Expected existing checkout: {repository}')
        require(Path(git(repository, 'rev-parse', '--show-toplevel')).resolve() == repository.resolve(),
                f'Unexpected repository root: {name}')
        require(git(repository, 'branch', '--show-current') == branch, f'{name}: expected branch {branch}')
        require(not git(repository, 'status', '--porcelain', '--untracked-files=all'),
                f'{name}: commit your changes before running this tool (including new files)')
        for mode in ([], ['--push']):
            urls = git(repository, 'remote', 'get-url', *mode, '--all', 'origin').splitlines()
            require(len(urls) == 1 and github_repository(urls[0]) == origin.lower(), f'Unexpected origin: {name}')
        head = git(repository, 'rev-parse', 'HEAD')
        require(re.fullmatch('[a-f0-9]{40}', head), f'Invalid revision: {name}')
        result[name] = {'revision': head, 'branch': branch, 'url': 'https://github.com/' + origin + '.git'}
    return result


def assert_sources(root, expected):
    require(source_inventory(root) == expected, 'Source changed during checks. No further publication/deployment is allowed.')


def validate_manifest(manifest):
    require(manifest.get('schema_version') == 1 and set(manifest.get('sources', {})) == set(SOURCES), 'Invalid release source set')
    require(re.fullmatch(r'bg-release-\d{8}t\d{6}z-[a-f0-9]{8}', manifest.get('release_id', '')), 'Invalid release ID')
    for name, (branch, origin, _) in SOURCES.items():
        source = manifest['sources'][name]
        require(source.get('branch') == branch and source.get('url') == 'https://github.com/' + origin + '.git'
                and re.fullmatch('[a-f0-9]{40}', source.get('revision', '')), 'Invalid pinned source: ' + name)


def export_commit(repository, revision, target):
    data = capture(['git', '-c', 'safe.directory=' + repository.as_posix(), '-C', repository, 'archive', '--format=tar', revision])
    target.mkdir(parents=True)
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        for member in archive.getmembers():
            relative = Path(member.name)
            require(not relative.is_absolute() and '..' not in relative.parts and (member.isdir() or member.isfile()),
                    'Unsafe Git archive entry: ' + member.name)
            destination = target / relative
            if member.isdir():
                destination.mkdir(parents=True, exist_ok=True)
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(archive.extractfile(member).read())
                destination.chmod(0o755 if member.mode & 0o111 else 0o644)


def exported_workspace(source_root, manifest, target, server=False):
    target.mkdir()
    for name, source in manifest['sources'].items():
        checkout = source_root / (SOURCES[name][2] if server else name)
        export_commit(checkout, source['revision'], target / name)
    infrastructure = target / 'Backgammon Game/deploy/workspace'
    shutil.copytree(infrastructure / 'docker', target / 'docker')
    shutil.copyfile(infrastructure / '.dockerignore', target / '.dockerignore')
    return target


def image_builds(workspace, manifest, runner, sudo=False, kinds=None):
    docker = ['sudo', '-n', 'docker'] if sudo else ['docker']
    tag = manifest['release_id']
    builder = 'backgammon-release-builder'
    if sudo:
        probe = subprocess.run([*docker, 'buildx', 'inspect', builder], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if probe.returncode:
            runner.run('create-build-worker', [*docker, 'buildx', 'create', '--name', builder, '--driver', 'docker-container',
                '--driver-opt', 'memory=3g,memory-swap=3g,cpu-period=100000,cpu-quota=100000,default-load=true,restart-policy=no',
                '--buildkitd-config', workspace / 'docker/buildkit.production.toml'])
        runner.run('start-build-worker', [*docker, 'buildx', 'inspect', '--bootstrap', builder])
        limits = capture([*docker, 'inspect', 'buildx_buildkit_' + builder + '0', '--format',
            '{{.HostConfig.Memory}} {{.HostConfig.MemorySwap}} {{.HostConfig.CpuPeriod}} {{.HostConfig.CpuQuota}}']).decode().strip()
        require(limits == '3221225472 3221225472 100000 100000', 'Server builder resource limits differ')
    images = {}
    try:
        for kind in (kinds or IMAGES):
            source, recipe, app = IMAGES[kind]
            image = f'backgammon-production-{kind}:{tag}'
            command = [*docker, 'buildx', 'build', '--load', '--platform', 'linux/amd64']
            if sudo:
                command += ['--builder', builder]
            command += ['--file', workspace / recipe, '--tag', image,
                '--build-arg', 'SOURCE_REVISION=' + manifest['sources'][source]['revision'], '--build-arg', 'RELEASE_TAG=' + tag]
            if app:
                command += ['--build-arg', 'APP_DIR=' + app]
            if 'frontend' in kind:
                command += ['--target', 'production', '--build-arg', 'VITE_SERVER_URL=/backgammon',
                    '--build-arg', 'VITE_TOURNAMENTS_URL=' + ORIGIN + '/tournaments/', '--build-arg', 'VITE_GAME_URL=/backgammon/']
            runner.run('build-' + kind, [*command, workspace])
            item = json.loads(capture([*docker, 'image', 'inspect', image]))[0]
            labels = item['Config'].get('Labels') or {}
            require(item['Os'] == 'linux' and item['Architecture'] == 'amd64'
                    and labels.get('org.opencontainers.image.revision') == manifest['sources'][source]['revision']
                    and labels.get('io.backgammon.release') == tag, 'Built image identity differs: ' + kind)
            images[kind] = item['Id']
        return images
    finally:
        if sudo:
            subprocess.run([*docker, 'buildx', 'stop', builder], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def resume_checks(root, release_id, sources):
    """Reuse only a local attempt stopped at its first backend check, before push."""
    require(isinstance(release_id, str) and re.fullmatch(r'bg-release-\d{8}t\d{6}z-[a-f0-9]{8}', release_id),
            'ResumeFrom must be a local release ID, not a directory path')
    parent = (root / 'artifacts/auto-releases').resolve()
    directory = parent / release_id
    require(directory.is_dir() and not directory.is_symlink() and directory.resolve().parent == parent,
            'Missing or redirected local release directory')
    status = json.loads((directory / 'status.json').read_text(encoding='utf-8'))
    previous = {'schema_version': 1, 'release_id': status.get('release_id'), 'sources': status.get('sources')}
    validate_manifest(previous)
    require(previous['release_id'] == release_id and status.get('stage') == 'failed'
            and status.get('failed_stage') == 'game-migrations' and status.get('published') == {},
            'Resume requires an unpublished local attempt that failed at game-migrations')
    # The original runner is sequential and stops on any nonzero exit. Reaching
    # its 21st stage proves the preceding 20 commands returned successfully.
    failed_log = directory / '021-game-migrations.log'
    require(failed_log.is_file() and str(failed_log) in status.get('error', ''),
            'Receipt does not identify the expected first backend-check log')
    log_hashes = {}
    for index, stage in enumerate(RESUME_COMPLETED_STAGES, 1):
        log = directory / f'{index:03d}-{stage}.log'
        require(log.is_file(), 'Missing completed-stage log: ' + stage)
        log_hashes[log.name] = sha(log)
    changes = {}
    for name, source in previous['sources'].items():
        require(sources[name]['branch'] == source['branch'] and sources[name]['url'] == source['url'],
                'Resume source identity differs: ' + name)
        changed = git(root / name, 'diff', '--no-ext-diff', '--no-textconv', '--name-only',
                      '--no-renames', '-z', source['revision'], sources[name]['revision'], '--')
        paths = set(filter(None, changed.split('\0')))
        allowed = RESUME_TOOL_FILES if name == 'Backgammon Game' else set()
        require(paths <= allowed, 'Application/build inputs changed; run the full checks: ' + name)
        changes[name] = sorted(paths)
    images = {}
    for index, (kind, (source, _, _)) in enumerate(IMAGES.items(), 11):
        log = directory / f'{index:03d}-build-{kind}.log'
        configs = re.findall(r'exporting config (sha256:[a-f0-9]{64})', log.read_text(encoding='utf-8'))
        require(len(configs) == 1, 'Missing or ambiguous built image digest: ' + kind)
        # Classic Docker exposes the config digest as Id; Docker Desktop's
        # containerd store exposes the manifest/index digest instead.
        digests = re.findall(r'exporting (?:config|manifest(?: list)?) (sha256:[a-f0-9]{64})',
                             log.read_text(encoding='utf-8'))
        image = f'backgammon-production-{kind}:{release_id}'
        items = json.loads(capture(['docker', 'image', 'inspect', image]))
        require(len(items) == 1, 'Ambiguous retained image: ' + kind)
        item = items[0]
        labels = item['Config'].get('Labels') or {}
        require(item['Id'] in digests and item['Os'] == 'linux' and item['Architecture'] == 'amd64'
                and labels.get('org.opencontainers.image.revision') == previous['sources'][source]['revision']
                and labels.get('io.backgammon.release') == release_id,
                'Retained image identity differs; run the full checks: ' + kind)
        images[kind] = item['Id']
    return images, {'release_id': release_id, 'sources': previous['sources'], 'images': images,
                    'tool_changes': changes, 'completed_log_sha256': log_hashes}


def backend_checks(workspace, images, runner, sudo=False):
    docker = ['sudo', '-n', 'docker'] if sudo else ['docker']
    token = uuid.uuid4().hex
    network = 'bg-release-tests-' + token
    labels = ['--label', 'io.backgammon.release-test=' + token]
    postgres, redis = network + '-postgres', network + '-redis'
    settings = Path(__file__).with_name('release_test_settings.py').resolve()
    require(settings.is_file(), 'Missing isolated test settings')
    test_tools = runner.directory / 'test-tools'
    test_tools.mkdir(exist_ok=True)
    test_tools.chmod(0o755)
    shutil.copyfile(settings, test_tools / settings.name)
    (test_tools / settings.name).chmod(0o644)
    created = []
    network_created = False
    try:
        runner.run('test-network', [*docker, 'network', 'create', '--internal', *labels, network])
        network_created = True
        created.append(postgres)
        runner.run('test-postgres', [*docker, 'run', '-d', '--name', postgres, *labels,
            '--network', network, '--network-alias', 'release-postgres', '--memory', '768m', '--cpus', '1',
            '--tmpfs', '/var/lib/postgresql/data:rw,size=512m', '-e', 'POSTGRES_PASSWORD=disposable-release-tests',
            'postgres:16'])
        created.append(redis)
        runner.run('test-redis', [*docker, 'run', '-d', '--name', redis, *labels,
            '--network', network, '--network-alias', 'release-redis', '--memory', '128m', 'redis:7-alpine'])
        deadline = time.monotonic() + 90
        while True:
            probe = subprocess.run([*docker, 'exec', postgres, 'pg_isready', '-U', 'postgres'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if not probe.returncode:
                break
            require(time.monotonic() < deadline, 'Disposable PostgreSQL did not become ready')
            time.sleep(1)
        environment = {
            'BACKGAMMON_RELEASE_TEST': '1', 'DJANGO_SETTINGS_MODULE': 'release_test_settings',
            'PYTHONPATH': '/opt/release', 'DB_HOST': 'release-postgres', 'DB_NAME': 'postgres', 'DB_USER': 'postgres',
            'DB_PASSWORD': 'disposable-release-tests', 'DATABASE_URL': 'postgresql://postgres:disposable-release-tests@release-postgres/postgres',
            'SECRET_KEY': 'release-test-only-key-not-a-production-credential-0123456789',
            'REDIS_URL': 'redis://release-redis:6379/0', 'CHANNEL_LAYER_BACKEND': 'redis', 'DEBUG': '1',
            'ALLOWED_HOSTS': 'testserver,localhost', 'GAMELINK_ENABLED': '0',
            'GAMELINK_BACKGAMMON_URL': 'https://game.example.test', 'GAMELINK_TOURNAMENTS_URL': 'https://club.example.test',
            'WEB_PUSH_PUBLIC_KEY': '', 'WEB_PUSH_PRIVATE_KEY': '', 'WEB_PUSH_SUBJECT': '',
            'TRANZILA_ENABLED': '0', 'TRANZILA_PURCHASES_ENABLED': '0', 'ACCOUNT_EMAIL_ACTIONS_ENABLED': '0',
        }
        for kind, (directory, base) in BACKENDS.items():
            environment['RELEASE_BASE_SETTINGS'] = base
            for action, command in (
                ('migrations', ['makemigrations', '--check', '--dry-run']),
                ('tests', ['test', '--noinput', '--verbosity', '2']),
            ):
                container = network + '-' + kind + '-' + action
                created.append(container)
                args = [*docker, 'run', '--name', container, *labels, '--network', network,
                    '--memory', '1536m', '--cpus', '1', '--entrypoint', 'python', '--workdir', directory,
                    '--mount', 'type=bind,source=' + str(test_tools) + ',target=/opt/release,readonly']
                for key, value in environment.items():
                    args += ['-e', key + '=' + value]
                runner.run(kind + '-' + action, [*args, images[kind], 'manage.py', *command])
    finally:
        failures = []
        # Ownership and exact names are checked before removal; no production volumes are involved.
        for name in reversed(created):
            probe = subprocess.run([*docker, 'inspect', name], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            if not probe.returncode:
                item = json.loads(probe.stdout)[0]
                if (item['Config'].get('Labels') or {}).get('io.backgammon.release-test') != token:
                    failures.append(name)
                    continue
                result = subprocess.run([*docker, 'rm', '-f', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if result.returncode:
                    failures.append(name)
        if network_created:
            item = json.loads(capture([*docker, 'network', 'inspect', network]))[0]
            require((item.get('Labels') or {}).get('io.backgammon.release-test') == token, 'Test network ownership differs')
            result = subprocess.run([*docker, 'network', 'rm', network], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if result.returncode:
                failures.append(network)
        require(not failures, 'Disposable test cleanup needs attention: ' + ', '.join(failures))


def frontend_checks(root, runner):
    pnpm = shutil.which('pnpm.cmd' if os.name == 'nt' else 'pnpm')
    require(pnpm, 'pnpm is required')
    environment = dict(os.environ, CI='true')
    sites = (
        ('game', root / 'Backgammon Game/frontend', ['test', '--workers=1']),
        ('tournaments', root / 'backgammon-tournaments', ['test:unit', '--run']),
        ('admin', root / 'backgammon-tournaments-backend/admin-frontend', ['test:unit', '--run']),
    )
    for name, directory, test in sites:
        runner.run(name + '-dependencies', [pnpm, 'install', '--frozen-lockfile'], directory, environment)
        if name == 'game':
            runner.run('playwright-browser', [pnpm, 'exec', 'playwright', 'install', 'chromium'], directory, environment)
        runner.run(name + '-frontend-tests', [pnpm, 'run', *test], directory, environment)
        runner.run(name + '-frontend-build', [pnpm, 'run', 'build'], directory, environment)


def publish(root, sources, runner, receipt):
    assert_sources(root, sources)
    # Validate ALL remote branches before pushing the first repository.
    for name, source in sources.items():
        repository = root / name
        remote = git(repository, 'ls-remote', '--exit-code', 'origin', 'refs/heads/' + source['branch']).split()[0]
        git(repository, 'merge-base', '--is-ancestor', remote, source['revision'])
    for name, source in sources.items():
        assert_sources(root, sources)
        repository = root / name
        runner.run('push-' + name.replace(' ', '-'), ['git', '-c', 'safe.directory=' + repository.as_posix(),
            '-C', repository, 'push', 'origin', source['revision'] + ':refs/heads/' + source['branch']])
        remote = git(repository, 'ls-remote', '--exit-code', 'origin', 'refs/heads/' + source['branch']).split()[0]
        require(remote == source['revision'], 'Remote changed during publication: ' + name)
        url = source['url'].removesuffix('.git') + '/commit/' + source['revision']
        receipt.setdefault('published', {})[name] = url
        save(runner.directory / 'status.json', receipt)
        print('Published: ' + url, flush=True)
    assert_sources(root, sources)


def upload_and_deploy(manifest, runner):
    token = 'bg-release-upload-' + uuid.uuid4().hex
    archive = runner.directory / (token + '.zip')
    tool = Path(__file__).resolve()
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
        bundle.write(tool, 'release_pipeline.py')
        bundle.write(tool.with_name('release_test_settings.py'), 'release_test_settings.py')
        bundle.writestr('manifest.json', json.dumps(manifest))
    runner.run('upload-release', ['scp', archive, SSH_TARGET + ':' + archive.name])
    bootstrap = (
        'import hashlib,pathlib,zipfile,os,sys;'
        f'p=pathlib.Path({archive.name!r});assert p.is_file() and not p.is_symlink();'
        f'assert hashlib.sha256(p.read_bytes()).hexdigest()=={sha(archive)!r};'
        f'd=pathlib.Path({token!r});d.mkdir(mode=0o700);'
        'z=zipfile.ZipFile(p);assert set(z.namelist())=={"release_pipeline.py","release_test_settings.py","manifest.json"};'
        'z.extractall(d);'
        'os.execv(sys.executable,[sys.executable,str(d/"release_pipeline.py"),"--server","--manifest",str(d/"manifest.json")])'
    )
    runner.run('server-pull-build-deploy', ['ssh', '-tt', SSH_TARGET, 'python3 -c ' + shlex.quote(bootstrap)])


def updated_config(before, images):
    after = copy.deepcopy(before)
    for service, kind in SERVICE_IMAGE.items():
        if service in after['services']:
            after['services'][service]['image'] = images[kind]
    expected = copy.deepcopy(after)
    for service in expected['services']:
        if service in SERVICE_IMAGE:
            expected['services'][service]['image'] = before['services'][service]['image']
    require(expected == before, 'Release would change runtime settings beyond image IDs')
    return after


def own_locations(text):
    blocks = []
    for match in re.finditer(r'(?m)^[ \t]*location[ \t]+([^\n{]+)\{', text):
        if any(start <= match.start() < end for start, end, _ in blocks):
            continue
        depth, quote, comment, escaped = 1, None, False, False
        index = match.end()
        while index < len(text) and depth:
            char = text[index]
            if comment:
                comment = char != '\n'
            elif escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif quote:
                if char == quote:
                    quote = None
            elif char in ('"', "'"):
                quote = char
            elif char == '#':
                comment = True
            elif char == '{':
                depth += 1
            elif char == '}':
                depth -= 1
            index += 1
        require(depth == 0, 'Unbalanced Nginx location')
        blocks.append((match.start(), index, ' '.join(match[1].split())))
    return [(start, end) for start, end, selector in blocks
            if selector.split()[-1].startswith(('/backgammon', '/tournaments'))
            or selector.split()[-1] in ('/api/link/', '/api/gamelink/', '/api/admin/')]


def maintenance_config(text):
    blocks = own_locations(text)
    require(len(blocks) >= 10, 'Backgammon Nginx routing inventory is incomplete')
    for start, end in reversed(blocks):
        point = text.index('{', start, end) + 1
        text = text[:point] + '\n    if ($remote_addr != 127.0.0.1) { return 503; }\n' + text[point:]
    return text


class Production:
    def __init__(self, runner):
        self.runner = runner
        self.docker = ['sudo', '-n', 'docker']
        self.state_path = SERVER_ROOT / 'reports/auto-releases/current.json'
        self.maintenance = False
        self.stopped = False
        self.migrations_started = False
        self.writes_opened = False
        self.status = {'stage': 'preflight', 'production_changed': False, 'public_writes_opened': False}
        self.discover()

    def compose(self, file):
        return [*self.docker, 'compose', '-p', PROJECT, '-f', file, *PROFILES]

    def discover(self):
        if self.state_path.exists():
            state = json.loads(self.state_path.read_text())
            require(state['stage'] == 'production_open', 'Previous deployment requires recovery; automatic update refused')
            self.nginx = Path(state['nginx_file'])
            self.before = json.loads(capture([*self.compose(state['compose_file']), 'config', '--format', 'json']))
        else:
            attempts = []
            for folder in sorted(CUTOVER.glob('cutover-*'), reverse=True):
                file = folder / 'status.json'
                if file.is_file():
                    status = json.loads(file.read_text())
                    if status.get('cutover_performed') or status.get('final_backup') or status.get('public_writes_opened'):
                        attempts.append((folder, status))
            require(attempts, 'No completed Docker production cutover receipt. Finish the initial cutover first.')
            folder, status = attempts[0]
            require(status.get('stage') == 'production_open' and status.get('cutover_performed') is True,
                    'Latest cutover did not complete. This tool cannot perform the initial migration.')
            plan = json.loads((CUTOVER / 'plan.json').read_text())
            self.nginx = Path(plan['nginx_file'])
            containers = self.containers()
            files = containers['game-api']['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
            require(files and all(Path(file).is_file() for file in files), 'Active Compose files are missing')
            command = [*self.docker, 'compose', '--env-file', CUTOVER / 'production.env', '-p', PROJECT]
            for file in files:
                command += ['-f', file]
            self.before = json.loads(capture([*command, *PROFILES, 'config', '--format', 'json']))
        require(self.before['name'] == PROJECT and set(APPS + WORKERS + ('postgres', 'redis')) <= set(self.before['services']),
                'Unexpected production service inventory')
        require(self.nginx.is_absolute() and str(self.nginx).startswith('/etc/nginx/') and self.nginx.is_file(), 'Unexpected Nginx path')
        containers = self.containers()
        for service in (*APPS, *WORKERS, 'postgres', 'redis'):
            require(service in containers and containers[service]['State']['Running'], 'Production service is not running: ' + service)
            image = self.before['services'][service]['image']
            expected = json.loads(capture([*self.docker, 'image', 'inspect', image]))[0]['Id']
            require(containers[service]['Image'] == expected, 'Running image differs from production configuration: ' + service)
            require(not any(mount['Destination'].startswith('/opt/e2e') for mount in containers[service].get('Mounts', [])),
                    'Production still has a test observer: ' + service)
        self.original_nginx = capture(['sudo', '-n', 'cat', self.nginx]).decode()
        require('if ($remote_addr != 127.0.0.1) { return 503; }' not in self.original_nginx, 'Production is already in maintenance')
        self.old_file = self.runner.directory / 'previous.compose.private.json'
        # Compose's canonical output already escapes dollar signs for reuse.
        save(self.old_file, self.before)
        resolved = json.loads(capture([*self.compose(self.old_file), 'config', '--format', 'json']))
        require(resolved == self.before, 'Original runtime configuration cannot be safely reproduced')
        self.original_containers = {service: item['Id'] for service, item in containers.items() if service in APPS + WORKERS + ('postgres', 'redis')}
        self.status.update(nginx_file=str(self.nginx), previous_compose_file=str(self.old_file), project=PROJECT)
        self.checkpoint('production_verified')
        for unit in ('backgammon.service', 'backgammon_tournaments_backend.service', 'backgammon-analysis.service',
                     'backgammon-analysis-worker.service', 'backgammon-push.service', 'backgammon-tasks.timer',
                     'backgammon-tournaments-tasks.timer'):
            state = capture(['systemctl', 'show', unit, '--property=ActiveState', '--value']).decode().strip()
            require(state in ('inactive', 'failed'), 'A legacy production service/timer is still active: ' + unit)

    def containers(self):
        ids = capture([*self.docker, 'ps', '-aq', '--filter', 'label=com.docker.compose.project=' + PROJECT]).decode().split()
        require(ids, 'Production Docker project is missing')
        result = {}
        for item in json.loads(capture([*self.docker, 'inspect', *ids])):
            labels = item['Config'].get('Labels') or {}
            if labels.get('com.docker.compose.oneoff', '').lower() == 'true':
                continue
            service = labels['com.docker.compose.service']
            require(service not in result, 'Duplicate production service: ' + service)
            result[service] = item
        return result

    def checkpoint(self, stage):
        self.status.update(stage=stage, production_changed=self.maintenance or self.stopped,
                           migrations_started=self.migrations_started, public_writes_opened=self.writes_opened)
        save(self.runner.directory / 'status.json', self.status)
        if self.maintenance or self.stopped or self.writes_opened:
            save(self.state_path, self.status)

    def nginx_apply(self, data, label):
        path = self.runner.directory / (label + '.conf')
        path.write_text(data, encoding='utf-8')
        path.chmod(0o600)
        self.runner.run(label + '-install', ['sudo', '-n', 'install', '-m', '0644', path, self.nginx])
        self.runner.run(label + '-check', ['sudo', '-n', 'nginx', '-t'])
        self.runner.run(label + '-reload', ['sudo', '-n', 'systemctl', 'reload', 'nginx'])

    def prepare(self, images):
        self.new_file = self.runner.directory / 'production.compose.private.json'
        after = updated_config(self.before, images)
        save(self.new_file, after)
        resolved = json.loads(capture([*self.compose(self.new_file), 'config', '--format', 'json']))
        require(resolved == after, 'Resolved Compose settings changed during snapshot creation')
        self.images = images
        for kind in BACKENDS:
            self.runner.run('deployment-check-' + kind, [*self.compose(self.new_file), 'run', '-T', '--rm', '--no-deps',
                '--pull', 'never', kind + '-api', 'python', 'manage.py', 'check', '--deploy'])
        # Refuse disconnecting active games. Run again once players have finished.
        self.assert_no_active_games()
        self.checkpoint('ready_for_maintenance')

    def assert_no_active_games(self):
        command = (
            "from game.models import GameRoom; from game.operations import delivery_health; "
            "n=GameRoom.objects.exclude(status__in=['completed','cancelled']).count(); "
            "print('Active/waiting rooms:', n); "
            "assert n == 0, 'Players still have active/waiting games; retry after they finish'; "
            "state=delivery_health(); print('Result deliveries:', state); "
            "assert state['status'] == 'ok' and state['queued_results'] == 0, "
            "'Result deliveries have not drained; keep the current workers running and retry later'"
        )
        self.runner.run('active-games', [*self.compose(self.old_file), 'exec', '-T', 'game-api',
                                        'python', 'manage.py', 'shell', '-c', command])

    def backup(self):
        folder = self.runner.directory / 'backup'
        folder.mkdir(mode=0o700)
        databases = {}
        for kind in BACKENDS:
            name = self.before['services'][kind + '-api']['environment']['DB_NAME']
            require(re.fullmatch('bgp_r8_' + kind + '_[a-f0-9]{12}', name), 'Unexpected live database: ' + kind)
            destination = folder / (kind + '.dump')
            print('[backup-' + kind + '] ' + str(destination), flush=True)
            with destination.open('wb') as output:
                destination.chmod(0o600)
                result = subprocess.run([*self.compose(self.old_file), 'exec', '-T', '--user', 'postgres', 'postgres',
                    'pg_dump', '--format=custom', '--no-owner', '--no-acl', '--dbname', name], stdout=output, stderr=subprocess.PIPE)
            require(result.returncode == 0 and destination.stat().st_size > 0,
                    'Backup failed: ' + kind + ': ' + result.stderr.decode(errors='replace'))
            with destination.open('rb') as backup_input:
                subprocess.run([*self.compose(self.old_file), 'exec', '-T', '--user', 'postgres', 'postgres',
                    'pg_restore', '--list'], stdin=backup_input, stdout=subprocess.DEVNULL, check=True)
            databases[kind] = {'database': name, 'file': str(destination), 'sha256': sha(destination)}
        # Media/static files, Redis queues, and secret files also belong to the recovery boundary.
        containers = self.containers()
        self.runner.run('persist-redis-backup', [*self.compose(self.old_file), 'exec', '-T', 'redis', 'redis-cli', 'SAVE'])
        for service, destinations in (
            ('tournaments-api', ('/data/media', '/data/static')),
            ('game-api', ('/data/static',)), ('redis', ('/data',)),
        ):
            for destination in destinations:
                self.runner.run('backup-files-' + service + '-' + destination.rsplit('/', 1)[-1],
                    [*self.docker, 'cp', containers[service]['Id'] + ':' + destination,
                     folder / (service + '-' + destination.rsplit('/', 1)[-1])])
        for name, definition in self.before.get('secrets', {}).items():
            if 'file' in definition:
                self.runner.run('backup-secret-' + name, ['sudo', '-n', 'install', '-m', '0600',
                    definition['file'], folder / ('secret-' + name)])
        self.status['backup'] = databases
        self.checkpoint('backup_complete')

    def healthy(self, file):
        self.runner.run('start-production-apps', [*self.compose(file), 'up', '-d', '--wait', '--wait-timeout', '180',
                        '--no-build', '--no-deps', '--pull', 'never', *APPS])
        for path in ('/backgammon/api/health/', '/tournaments-api/health/', '/backgammon/', '/tournaments/', '/tournaments-admin/'):
            self.runner.run('https-' + path.strip('/').replace('/', '-'), ['curl', '--fail', '--silent', '--show-error',
                '--max-time', '20', '--noproxy', '*', '--resolve', '38.247.146.17.nip.io:443:127.0.0.1', ORIGIN + path])

    def deploy(self):
        require(capture(['sudo', '-n', 'cat', self.nginx]).decode() == self.original_nginx,
                'Nginx changed during release checks; deployment refused')
        current = self.containers()
        require(all(service in current and current[service]['Id'] == identifier
                    for service, identifier in self.original_containers.items()),
                'Production containers changed during release checks; deployment refused')
        self.maintenance = True
        self.checkpoint('entering_maintenance')
        self.nginx_apply(maintenance_config(self.original_nginx), 'maintenance')
        self.runner.run('stop-production-workers', [*self.compose(self.old_file), 'stop', *WORKERS])
        # Nginx denies new sessions; check again to catch games started before maintenance.
        self.assert_no_active_games()
        self.stopped = True
        self.runner.run('stop-production-apps', [*self.compose(self.old_file), 'stop', *APPS])
        self.checkpoint('writers_stopped')
        self.backup()
        self.migrations_started = True
        self.checkpoint('migrations_started')
        for kind in BACKENDS:
            self.runner.run('migrate-' + kind, [*self.compose(self.new_file), 'run', '-T', '--rm', '--no-deps',
                '--pull', 'never', kind + '-api', 'python', 'manage.py', 'migrate', '--noinput'])
            self.runner.run('deployment-check-after-' + kind, [*self.compose(self.new_file), 'run', '-T', '--rm', '--no-deps',
                '--pull', 'never', kind + '-api', 'python', 'manage.py', 'check', '--deploy'])
            if kind != 'analysis':
                self.runner.run('static-' + kind, [*self.compose(self.new_file), 'run', '-T', '--rm', '--no-deps',
                    '--pull', 'never', kind + '-api', 'python', 'manage.py', 'collectstatic', '--noinput'])
        self.healthy(self.new_file)
        self.status['compose_file'] = str(self.new_file)
        self.status['images'] = self.images
        # Workers can write before Nginx reopens. From this point never restore old data automatically.
        self.writes_opened = True
        self.checkpoint('opening_production')
        self.runner.run('start-production-workers', [*self.compose(self.new_file), 'up', '-d', '--no-build', '--no-deps',
                                                   '--pull', 'never', *WORKERS])
        time.sleep(5)
        containers = self.containers()
        for service in APPS + WORKERS:
            item = containers[service]
            require(item['State']['Running'] and item['Image'] == self.images[SERVICE_IMAGE[service]],
                    'New production service differs: ' + service)
            require(item.get('RestartCount', 0) == 0, 'New production service restarted: ' + service)
        self.nginx_apply(self.original_nginx, 'reopen-production')
        self.checkpoint('production_open')
        print('PRODUCTION UPDATE COMPLETE. Receipts: ' + str(self.runner.directory), flush=True)

    def failed(self):
        if not self.maintenance and not self.stopped:
            self.checkpoint('failed_before_production_change')
            print('Production was not changed.', flush=True)
        elif not self.migrations_started and not self.writes_opened:
            self.runner.run('restore-original-apps', [*self.compose(self.old_file), 'up', '-d', '--wait', '--wait-timeout', '180',
                '--no-build', '--no-deps', '--pull', 'never', *APPS])
            self.runner.run('restore-original-workers', [*self.compose(self.old_file), 'up', '-d', '--no-build', '--no-deps',
                '--pull', 'never', *WORKERS])
            self.nginx_apply(self.original_nginx, 'restore-original-routing')
            self.status['compose_file'] = str(self.old_file)
            self.checkpoint('production_open')
            print('Previous production restored before migrations. No database restore was performed.', flush=True)
        else:
            self.checkpoint('maintenance_requires_attention')
            print('PRODUCTION REQUIRES ATTENTION. Migrations or new writes may have begun. '
                  'No automatic database rollback. Preserve backup and logs: ' + str(self.runner.directory), flush=True)
        self.runner.run('failure-container-logs', [*self.compose(self.new_file if hasattr(self, 'new_file') else self.old_file),
                        'logs', '--no-color', '--tail', '80', *APPS, *WORKERS])


def server_main(manifest):
    import fcntl
    validate_manifest(manifest)
    require(SERVER_ROOT.is_dir(), 'Expected Bot1 project root is missing')
    root = SERVER_ROOT / 'reports/auto-releases'
    root.mkdir(parents=True, exist_ok=True)
    root.chmod(0o700)
    with (root / '.deployment.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        subprocess.run(['sudo', '-v'], check=True)
        directory = root / manifest['release_id']
        require(not directory.exists(), 'Release attempt already exists. Read its receipt before retrying.')
        runner = Runner(directory)
        production = None
        try:
            production = Production(runner)
            production.status.update(release_id=manifest['release_id'], sources=manifest['sources'])
            save(directory / 'manifest.json', manifest)
            source_root = SERVER_ROOT / 'sources'
            source_inventory(source_root, server=True)
            for name, expected in manifest['sources'].items():
                checkout = source_root / SOURCES[name][2]
                published = git(checkout, 'ls-remote', '--exit-code', 'origin', 'refs/heads/' + expected['branch']).split()[0]
                require(published == expected['revision'], 'Remote branch moved after local checks: ' + name)
                runner.run('pull-' + name.replace(' ', '-'), ['git', '-c', 'safe.directory=' + checkout.as_posix(), '-C', checkout,
                    'pull', '--ff-only', 'origin', expected['branch']])
                require(git(checkout, 'rev-parse', 'HEAD') == expected['revision'], 'Pulled revision differs: ' + name)
            require(source_inventory(source_root, server=True) == manifest['sources'], 'Server checkouts differ from release')
            workspace = exported_workspace(source_root, manifest, directory / 'source', server=True)
            images = image_builds(workspace, manifest, runner, sudo=True)
            backend_checks(workspace, images, runner, sudo=True)
            production.prepare(images)
            production.deploy()
        except BaseException as error:
            print('\nSERVER FAILED STAGE: ' + runner.stage + '\nERROR: ' + str(error)
                  + '\nSERVER RECEIPTS: ' + str(directory), flush=True)
            if production is not None:
                try:
                    production.failed()
                except BaseException as recovery_error:
                    production.checkpoint('recovery_requires_attention')
                    print('Recovery failed: ' + str(recovery_error), flush=True)
            raise


def local_main(args):
    root = args.root.resolve()
    sources = source_inventory(root)
    for executable in ('git', 'docker', 'node', 'scp', 'ssh'):
        require(shutil.which(executable), 'Required executable missing: ' + executable)
    require(shutil.which('pnpm.cmd' if os.name == 'nt' else 'pnpm'), 'pnpm is required')
    require(capture(['docker', 'info', '--format', '{{.OSType}}']).strip() == b'linux', 'Docker must use Linux containers')
    reused = resume_checks(root, args.resume_from, sources) if args.resume_from else None
    if args.preflight_only:
        print('PREFLIGHT PASSED. No tests, builds, push, SSH or production changes were performed.')
        if reused:
            print('RESUME PREFLIGHT PASSED. Retained images and unchanged application inputs verified.')
        return
    release = 'bg-release-' + datetime.now(timezone.utc).strftime('%Y%m%dt%H%M%Sz') + '-' + uuid.uuid4().hex[:8]
    manifest = {'schema_version': 1, 'release_id': release, 'sources': sources}
    runner = Runner(root / 'artifacts/auto-releases' / release)
    receipt = {'stage': 'checking', 'release_id': release, 'sources': sources, 'published': {}}
    if reused:
        receipt['resumed_from'] = reused[1]
    save(runner.directory / 'status.json', receipt)
    try:
        if reused:
            print('RESUMING LOCAL CHECKS from ' + args.resume_from
                  + ': frontend tests/builds and seven local image builds already completed. '
                  'Continuing at game-migrations. Server builds/checks still run during deployment.', flush=True)
        else:
            frontend_checks(root, runner)
        assert_sources(root, sources)
        workspace = exported_workspace(root, manifest, runner.directory / 'source')
        images = reused[0] if reused else image_builds(workspace, manifest, runner)
        backend_checks(workspace, images, runner)
        # Elixir's tests run in a dedicated build stage with the committed test directory.
        recipe = workspace / 'docker/dice.Dockerfile'
        test_recipe = runner.directory / 'dice-tests.Dockerfile'
        original = recipe.read_text()
        test_recipe.write_text(original.split('FROM debian:')[0] +
            '\nCOPY ["Backgammon Game/dice_service/test/", "/app/test/"]\nRUN MIX_ENV=test mix test\n', encoding='utf-8')
        runner.run('dice-tests', ['docker', 'build', '--file', test_recipe, '--tag', 'backgammon-dice-tests:' + release, workspace])
        assert_sources(root, sources)
        receipt['stage'] = 'checks_passed'
        save(runner.directory / 'status.json', receipt)
        if args.checks_only:
            print('CHECKS PASSED. No push, SSH or production changes were performed. Receipts: ' + str(runner.directory))
            return
        publish(root, sources, runner, receipt)
        # A multi-repository push is not atomic. Only start deployment when ALL refs match.
        for name, source in sources.items():
            remote = git(root / name, 'ls-remote', '--exit-code', 'origin', 'refs/heads/' + source['branch']).split()[0]
            require(remote == source['revision'], 'Published branch changed: ' + name)
        receipt['stage'] = 'published'
        save(runner.directory / 'status.json', receipt)
        upload_and_deploy(manifest, runner)
        receipt['stage'] = 'production_open'
        save(runner.directory / 'status.json', receipt)
        print('CHECKS, PUSH, PULL AND PRODUCTION UPDATE COMPLETE. ' + str(runner.directory))
    except BaseException as error:
        receipt.update(stage='failed', failed_stage=runner.stage, error=str(error))
        save(runner.directory / 'status.json', receipt)
        print('\nFAILED STAGE: ' + runner.stage + '\nERROR: ' + str(error) + '\nRECEIPTS: ' + str(runner.directory), flush=True)
        if receipt['published']:
            print('Already published commits (retained; no Git rollback): ' + json.dumps(receipt['published']), flush=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    # The SSH upload lives in a shallower directory than the versioned local tool.
    # PowerShell supplies the local workspace explicitly; server mode uses SERVER_ROOT.
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--checks-only', action='store_true')
    parser.add_argument('--preflight-only', action='store_true')
    parser.add_argument('--resume-from', help='Reuse completed local frontend checks/images from a failed game-migrations release')
    parser.add_argument('--server', action='store_true')
    parser.add_argument('--manifest', type=Path)
    args = parser.parse_args()
    try:
        if args.server:
            require(not args.resume_from, 'ResumeFrom is available only for local checks, never server deployment recovery')
            os.umask(0o077)
            def interrupted(signum, frame):
                raise RuntimeError('Deployment interrupted by signal ' + str(signum))
            for sig in (signal.SIGTERM, signal.SIGHUP):
                signal.signal(sig, interrupted)
            server_main(json.loads(args.manifest.read_text()))
        else:
            local_main(args)
    except BaseException as error:
        print('\nERROR: ' + str(error), file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
