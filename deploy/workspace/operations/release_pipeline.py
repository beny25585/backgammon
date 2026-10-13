"""Check committed sources, push/pull exact revisions, and update existing Docker production.

No commit, reset, force push, database import, or production volume removal.
The initial Docker cutover must have completed successfully before deployment.
"""
import argparse
import base64
import contextlib
import copy
from datetime import datetime, timezone
import hashlib
import io
import json
import os
import inspect
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
WORKFLOW_VERSION = 2
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
RESUME_TOURNAMENT_TEST_FILES = {
    'tournaments/billing/test_payment_operations.py',
    'tournaments/frontend/test_head_to_head.py',
    'tournaments/frontend/test_incident_recovery.py',
    'tournaments/frontend/test_mode_rules.py',
    'tournaments/frontend/test_push_health.py',
    'tournaments/frontend/test_tournament_reminders.py',
    'tournaments/frontend/tests.py',
    'tournaments/gamelink/test_loss_settlement.py',
    'tournaments/gamelink/test_rematch_settlement.py',
    'tournaments/gamelink/tests.py',
    'tournaments/tournaments/tests.py',
}
TOURNAMENT_RESUME_STAGES = (
    'tournaments-dependencies', 'tournaments-frontend-tests', 'tournaments-frontend-build',
    *('build-' + kind for kind in IMAGES),
    'test-network', 'test-postgres', 'test-redis', 'game-migrations',
    'test-dice', 'test-dice-ready', 'game-tests', 'tournaments-migrations',
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
        self.timings = []

    def run(self, stage, args, cwd=None, env=None):
        self.stage = stage
        self.counter += 1
        log = self.directory / f'{self.counter:03d}-{stage}.log'
        print(f'\n[{stage}] Log: {log}', flush=True)
        started = time.monotonic()
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
        elapsed = round(time.monotonic() - started, 3)
        self.timings.append({'stage': stage, 'seconds': elapsed, 'exit_code': result})
        save(self.directory / 'timings.json', self.timings)
        print(f'[{stage}] Finished in {elapsed:.3f}s (exit {result})', flush=True)
        require(result == 0, f'{stage} failed (exit {result}). Log: {log}')

    def retain(self, stage, source):
        self.stage = stage
        self.counter += 1
        target = self.directory / f'{self.counter:03d}-{stage}.log'
        shutil.copyfile(source, target)
        target.chmod(0o600)
        self.timings.append({'stage': stage, 'seconds': 0, 'exit_code': 0, 'reused_from': str(source)})
        save(self.directory / 'timings.json', self.timings)
        print(f'[{stage}] ALREADY VERIFIED. Evidence: {target}', flush=True)


def tool_hashes():
    tool = Path(__file__).resolve()
    return {name: sha(tool.with_name(name)) for name in ('release_pipeline.py', 'release_test_settings.py')}


@contextlib.contextmanager
def workspace_lock(root):
    folder = root / 'artifacts/auto-releases'
    require(folder.resolve().is_relative_to(root.resolve()), 'Release receipts escape the workspace')
    folder.mkdir(parents=True, exist_ok=True)
    with (folder / '.local-release.lock').open('a+b') as lock:
        lock.seek(0, os.SEEK_END)
        if lock.tell() == 0:
            lock.write(b'0')
            lock.flush()
        lock.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            raise RuntimeError('Another local release is running. Wait for it to finish.') from error
        try:
            yield
        finally:
            if os.name == 'nt':
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


def latest_progress(base, sources, scope):
    if not base.is_dir():
        return None
    tools = tool_hashes()
    for folder in sorted(base.iterdir(), key=lambda item: item.stat().st_mtime_ns, reverse=True):
        if not folder.is_dir() or folder.is_symlink() or not re.fullmatch(r'bg-release-\d{8}t\d{6}z-[a-f0-9]{8}', folder.name):
            continue
        path = folder / 'progress.json'
        if not path.is_file():
            continue
        require(not path.is_symlink(), 'Redirected release progress: ' + str(path))
        progress = json.loads(path.read_text(encoding='utf-8'))
        if (progress.get('workflow_version') != WORKFLOW_VERSION or progress.get('sources') != sources
                or progress.get('tools') != tools or progress.get('scope') != scope):
            continue
        require(progress.get('release_id') == folder.name, 'Progress belongs to another release')
        status_path = folder / 'status.json'
        require(status_path.is_file() and not status_path.is_symlink(), 'Missing or redirected release status')
        status = json.loads(status_path.read_text(encoding='utf-8'))
        require(status.get('sources') == sources, 'Progress and release sources differ')
        if scope == 'server':
            if status.get('stage') == 'production_open':
                continue
            require(all(status.get(key) is False for key in
                        ('production_changed', 'migrations_started', 'public_writes_opened')),
                    'Previous deployment needs manual recovery; automatic continuation refused: ' + str(folder))
        return folder, progress
    return None


class ReleaseProgress:
    """Retain complete phases only, with unchanged sources, inputs and verified logs."""

    def __init__(self, runner, manifest, scope, previous=None):
        self.runner = runner
        self.previous = previous
        self.value = {'workflow_version': WORKFLOW_VERSION, 'release_id': manifest['release_id'],
                      'sources': manifest['sources'], 'tools': tool_hashes(), 'scope': scope, 'phases': {}}
        if previous:
            require(previous[1].get('release_id') == previous[0].name
                    and all(previous[1].get(key) == self.value[key]
                            for key in ('workflow_version', 'sources', 'tools', 'scope')),
                    'Retained progress inputs differ')
            self.value['previous_release'] = previous[0].name
        save(runner.directory / 'progress.json', self.value)

    def candidates(self, name, fingerprint):
        previous = self.previous
        visited = set()
        while previous:
            folder, progress = previous
            require(folder.name not in visited, 'Release continuation contains a cycle')
            visited.add(folder.name)
            phase = progress.get('phases', {}).get(name)
            if phase and phase.get('inputs') == fingerprint:
                yield folder, phase
            parent = progress.get('previous_release')
            if not parent:
                return
            require(re.fullmatch(r'bg-release-\d{8}t\d{6}z-[a-f0-9]{8}', parent), 'Unsafe continuation parent')
            path = folder.parent / parent
            require(path.is_dir() and not path.is_symlink(), 'Missing or redirected continuation parent')
            journal = path / 'progress.json'
            require(journal.is_file() and not journal.is_symlink(), 'Missing continuation journal')
            progress = json.loads(journal.read_text(encoding='utf-8'))
            require(progress.get('release_id') == parent
                    and all(progress.get(key) == self.value[key] for key in ('workflow_version', 'tools', 'sources', 'scope')),
                    'Continuation parent inputs differ')
            if self.value['scope'] == 'server':
                status = json.loads((path / 'status.json').read_text(encoding='utf-8'))
                require(all(status.get(key) is False for key in
                            ('production_changed', 'migrations_started', 'public_writes_opened')),
                        'Continuation parent requires production recovery')
            previous = path, progress

    def run(self, name, stages, action, inputs=None, verify=None):
        require(bool(stages), 'A resumable phase must contain completed commands')
        fingerprint = hashlib.sha256(json.dumps(inputs, sort_keys=True).encode()).hexdigest()
        for folder, phase in self.candidates(name, fingerprint):
            require(phase.get('result_sha256') == hashlib.sha256(json.dumps(phase['result'], sort_keys=True).encode()).hexdigest(),
                    'Retained phase result changed: ' + name)
            logs = phase.get('logs', [])
            require([item['stage'] for item in logs] == list(stages), 'Incomplete retained phase: ' + name)
            paths = []
            for item in logs:
                filename = item['file']
                require(re.fullmatch(r'\d{3}-[\w-]+\.log', filename), 'Unsafe retained log name')
                path = folder / filename
                require(path.is_file() and not path.is_symlink() and sha(path) == item['sha256'],
                        'Completed evidence changed: ' + str(path))
                paths.append(path)
            if name == 'images':
                verify_image_logs(phase['result'], dict(zip((item['stage'] for item in logs), paths)))
            if verify is None or verify(phase['result'], phase['origin_release']):
                start = len(self.runner.timings)
                for item, path in zip(logs, paths):
                    self.runner.retain(item['stage'], path)
                self.record(name, start, phase['result'], fingerprint, phase['origin_release'], stages)
                return phase['result']
            print('Retained resources are unavailable; rechecking phase: ' + name, flush=True)
        start = len(self.runner.timings)
        result = action()
        self.record(name, start, result, fingerprint, self.value['release_id'], stages)
        return result

    def record(self, name, start, result, fingerprint, origin, stages):
        rows = self.runner.timings[start:]
        require([row['stage'] for row in rows] == list(stages) and all(row['exit_code'] == 0 for row in rows),
                'Phase did not complete successfully: ' + name)
        logs = []
        for index, row in enumerate(rows, start + 1):
            path = self.runner.directory / f"{index:03d}-{row['stage']}.log"
            logs.append({'stage': row['stage'], 'file': path.name, 'sha256': sha(path)})
        if name == 'images':
            verify_image_logs(result, {item['stage']: self.runner.directory / item['file'] for item in logs})
        self.value['phases'][name] = {'inputs': fingerprint, 'origin_release': origin, 'logs': logs, 'result': result,
                                    'result_sha256': hashlib.sha256(json.dumps(result, sort_keys=True).encode()).hexdigest()}
        save(self.runner.directory / 'progress.json', self.value)


def verify_image_logs(images, logs):
    require(isinstance(images, dict) and set(images) == set(IMAGES), 'Built image set differs')
    for kind, image in images.items():
        text = logs['build-' + kind].read_text(encoding='utf-8')
        digests = re.findall(r'exporting (?:config|manifest(?: list)?) (sha256:[a-f0-9]{64})', text)
        require(image in digests, 'Image ID does not belong to its completed build: ' + kind)


def verify_images(images, sources, origin, sudo=False):
    require(isinstance(images, dict) and set(images) == set(IMAGES), 'Retained image set differs')
    docker = ['sudo', '-n', 'docker'] if sudo else ['docker']
    for kind, image in images.items():
        require(re.fullmatch(r'sha256:[a-f0-9]{64}', image), 'Image is not an immutable Docker ID: ' + kind)
        try:
            items = json.loads(capture([*docker, 'image', 'inspect', image]))
        except RuntimeError as error:
            if 'No such image' in str(error):
                return False
            raise
        require(len(items) == 1, 'Ambiguous retained image: ' + kind)
        item = items[0]
        labels = item['Config'].get('Labels') or {}
        require(item['Id'] == image and item['Os'] == 'linux' and item['Architecture'] == 'amd64'
                and labels.get('org.opencontainers.image.revision') == sources[IMAGES[kind][0]]['revision']
                and labels.get('io.backgammon.release') == origin, 'Retained image identity differs: ' + kind)
    return True


def checked_images(workspace, manifest, runner, progress, sudo=False):
    stages = (['configure-build-worker'] if sudo else []) + ['build-' + kind for kind in IMAGES]
    return progress.run('images', stages, lambda: image_builds(workspace, manifest, runner, sudo=sudo),
                        verify=lambda images, origin: verify_images(images, manifest['sources'], origin, sudo=sudo))


def checked_backends(workspace, images, runner, progress, sudo=False):
    docker = ['sudo', '-n', 'docker'] if sudo else ['docker']
    engine = capture([*docker, 'version', '--format', '{{.Server.Version}} {{.Server.Arch}}']).decode().strip()
    test_images = {}
    for service, tag in (('postgres', 'postgres:16'), ('redis', 'redis:7-alpine')):
        try:
            items = json.loads(capture([*docker, 'image', 'inspect', tag]))
        except RuntimeError as error:
            if 'No such image' not in str(error):
                raise
            runner.run('prepare-test-image-' + service, [*docker, 'pull', tag])
            items = json.loads(capture([*docker, 'image', 'inspect', tag]))
        require(len(items) == 1 and re.fullmatch(r'sha256:[a-f0-9]{64}', items[0]['Id']),
                'Disposable test image identity differs: ' + service)
        test_images[service] = items[0]['Id']
    for kind in BACKENDS:
        stages = ['test-network', 'test-postgres', 'test-redis', kind + '-migrations']
        if kind == 'game':
            stages += ['test-dice', 'test-dice-ready']
        stages += [kind + '-tests']
        progress.run('backend-' + kind, stages,
                     lambda kind=kind: backend_checks(workspace, images, runner, sudo=sudo, only=(kind,),
                                                      test_images=test_images),
                     inputs={'images': images, 'docker_engine': engine, 'test_images': test_images})


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


def local_environment(root):
    sources = source_inventory(root)
    for executable in ('git', 'docker', 'node', 'scp', 'ssh'):
        require(shutil.which(executable), 'Required executable missing: ' + executable)
    require(shutil.which('pnpm.cmd' if os.name == 'nt' else 'pnpm'), 'pnpm is required')
    require(capture(['docker', 'info', '--format', '{{.OSType}}']).strip() == b'linux', 'Docker must use Linux containers')
    return sources


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
        runner.run('configure-build-worker', [sys.executable, workspace / 'docker/configure_builder.py',
                                            '--builder', builder, '--sudo-docker'])
        limits = capture([*docker, 'inspect', 'buildx_buildkit_' + builder + '0', '--format',
            '{{.HostConfig.Memory}} {{.HostConfig.MemorySwap}} {{.HostConfig.CpuPeriod}} {{.HostConfig.CpuQuota}}']).decode().strip()
        require(limits == '3221225472 3221225472 100000 200000', 'Server builder resource limits differ')
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
                    '--build-arg', 'VITE_TOURNAMENTS_URL=' + ORIGIN + '/6b/tournaments/', '--build-arg', 'VITE_GAME_URL=/6b/backgammon/']
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
    """Reuse verified local stages from supported unpublished failures."""
    require(isinstance(release_id, str) and re.fullmatch(r'bg-release-\d{8}t\d{6}z-[a-f0-9]{8}', release_id),
            'ResumeFrom must be a local release ID, not a directory path')
    parent = (root / 'artifacts/auto-releases').resolve()
    directory = parent / release_id
    require(directory.is_dir() and not directory.is_symlink() and directory.resolve().parent == parent,
            'Missing or redirected local release directory')
    status = json.loads((directory / 'status.json').read_text(encoding='utf-8'))
    previous = {'schema_version': 1, 'release_id': status.get('release_id'), 'sources': status.get('sources')}
    validate_manifest(previous)
    if status.get('failed_stage') == 'admin-frontend-build':
        return resume_frontends(root, directory, release_id, sources, previous, status)
    if status.get('failed_stage') == 'tournaments-tests':
        return resume_tournaments(root, directory, release_id, sources, previous, status)
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
        images[kind] = retained_image(directory, previous, kind, index)
    return images, {'release_id': release_id, 'sources': previous['sources'], 'images': images,
                    'tool_changes': changes, 'completed_log_sha256': log_hashes}


def retained_image(directory, previous, kind, index):
    log = directory / f'{index:03d}-build-{kind}.log'
    contents = log.read_text(encoding='utf-8')
    configs = re.findall(r'exporting config (sha256:[a-f0-9]{64})', contents)
    require(len(configs) == 1, 'Missing or ambiguous built image digest: ' + kind)
    # Docker Desktop may expose a manifest/index digest rather than the config.
    digests = re.findall(r'exporting (?:config|manifest(?: list)?) (sha256:[a-f0-9]{64})', contents)
    items = json.loads(capture(['docker', 'image', 'inspect',
                               f"backgammon-production-{kind}:{previous['release_id']}"]))
    require(len(items) == 1, 'Ambiguous retained image: ' + kind)
    item = items[0]
    labels = item['Config'].get('Labels') or {}
    source = IMAGES[kind][0]
    require(item['Id'] in digests and item['Os'] == 'linux' and item['Architecture'] == 'amd64'
            and labels.get('org.opencontainers.image.revision') == previous['sources'][source]['revision']
            and labels.get('io.backgammon.release') == previous['release_id'],
            'Retained image identity differs; run the full checks: ' + kind)
    return item['Id']


def resume_tournaments(root, directory, release_id, sources, previous, status):
    """Continue the known frontend-resume layout after successful game tests."""
    failed_log = directory / '019-tournaments-tests.log'
    require(previous['release_id'] == release_id and status.get('stage') == 'failed'
            and status.get('published') == {} and failed_log.is_file()
            and str(failed_log) in status.get('error', ''),
            'Tournament resume requires an unpublished attempt with the expected failed test log')
    parent_evidence = status.get('resumed_from') or {}
    parent_release = parent_evidence.get('release_id')
    require(isinstance(parent_release, str) and parent_release != release_id
            and re.fullmatch(r'bg-release-\d{8}t\d{6}z-[a-f0-9]{8}', parent_release),
            'Invalid original frontend release')
    parent_directory = directory.parent / parent_release
    require(parent_directory.is_dir() and not parent_directory.is_symlink()
            and parent_directory.resolve().parent == directory.parent.resolve(),
            'Missing or redirected original frontend release')
    parent_status = json.loads((parent_directory / 'status.json').read_text(encoding='utf-8'))
    parent_previous = {'schema_version': 1, 'release_id': parent_status.get('release_id'),
                       'sources': parent_status.get('sources')}
    validate_manifest(parent_previous)
    require(parent_status.get('failed_stage') == 'admin-frontend-build', 'Unexpected original frontend stage')
    parent_images, verified_parent = resume_frontends(
        root, parent_directory, parent_release, previous['sources'], parent_previous, parent_status)
    require(parent_images is None and verified_parent == parent_evidence,
            'Original game/admin frontend evidence differs')
    hashes = {}
    for index, stage in enumerate(TOURNAMENT_RESUME_STAGES, 1):
        log = directory / f'{index:03d}-{stage}.log'
        require(log.is_file() and not log.is_symlink(), 'Missing completed-stage log: ' + stage)
        hashes[log.name] = sha(log)
    game_log = (directory / '017-game-tests.log').read_text(encoding='utf-8')
    require(re.search(r'(?m)^OK(?: \(skipped=\d+\))?\s*$', game_log), 'Game test success is missing')
    changes = {}
    for name, source in previous['sources'].items():
        require(sources[name]['branch'] == source['branch'] and sources[name]['url'] == source['url'],
                'Resume source identity differs: ' + name)
        changed = git(root / name, 'diff', '--no-ext-diff', '--no-textconv', '--name-only',
                      '--no-renames', '-z', source['revision'], sources[name]['revision'], '--')
        paths = set(filter(None, changed.split('\0')))
        allowed = set()
        if name == 'Backgammon Game':
            # Shared settings must stay unchanged to retain passed game tests.
            allowed = RESUME_TOOL_FILES - {'deploy/workspace/operations/release_test_settings.py'}
        elif name == 'backgammon-tournaments-backend':
            allowed = RESUME_TOURNAMENT_TEST_FILES
        require(paths <= allowed, 'Inputs outside tournament test fixes changed; run full checks: ' + name)
        changes[name] = sorted(paths)
    images = {kind: retained_image(directory, previous, kind, index)
              for index, kind in enumerate(IMAGES, 4)}
    hashes[failed_log.name] = sha(failed_log)
    return images, {'release_id': release_id, 'sources': previous['sources'], 'images': images,
                    'source_changes': changes, 'completed_log_sha256': hashes,
                    'frontend_evidence': parent_evidence, 'resume_backend': 'tournaments',
                    'rebuild_images': ['tournaments'] if changes['backgammon-tournaments-backend'] else []}


def resume_frontends(root, directory, release_id, sources, previous, status):
    """Reuse unchanged game/admin checks; recheck tournaments changed during the run."""
    require(previous['release_id'] == release_id and status.get('stage') == 'failed'
            and status.get('published') == {} and status.get('error') ==
            'backgammon-tournaments: commit your changes before running this tool (including new files)',
            'Frontend resume requires an unpublished attempt stopped by uncommitted tournaments changes')
    logs = {}
    for index, stage in enumerate(RESUME_COMPLETED_STAGES[:10], 1):
        log = directory / f'{index:03d}-{stage}.log'
        require(log.is_file() and not log.is_symlink(), 'Missing completed-stage log: ' + stage)
        logs[log.name] = sha(log)
    # The final frontend command completed, then the source-inventory guard failed.
    build_log = directory / '010-admin-frontend-build.log'
    clean_log = re.sub(r'\x1b\[[0-9;]*m', '', build_log.read_text(encoding='utf-8'))
    require(re.search(r'\bbuilt in \d', clean_log), 'Admin build completion is missing')
    changes = {}
    for name, source in previous['sources'].items():
        require(sources[name]['branch'] == source['branch'] and sources[name]['url'] == source['url'],
                'Resume source identity differs: ' + name)
        changed = git(root / name, 'diff', '--no-ext-diff', '--no-textconv', '--name-only',
                      '--no-renames', '-z', source['revision'], sources[name]['revision'], '--')
        paths = set(filter(None, changed.split('\0')))
        if name != 'backgammon-tournaments':
            allowed = RESUME_TOOL_FILES if name == 'Backgammon Game' else set()
            require(paths <= allowed, 'Checked game/admin inputs changed; run the full checks: ' + name)
        changes[name] = sorted(paths)
    # Dirty files may have changed during tests without changing HEAD. Always
    # recheck this frontend, even when committing leaves the same tree as before.
    return None, {'release_id': release_id, 'sources': previous['sources'],
                  'source_changes': changes, 'completed_log_sha256': logs,
                  'skipped_frontends': ['game', 'admin'], 'rerun_frontends': ['tournaments']}


def start_test_dice(images, runner, docker, network, labels, created):
    """Start the built dice service only inside this attempt's disposable network."""
    container = network + '-dice'
    created.append(container)
    runner.run('test-dice', [*docker, 'run', '-d', '--name', container, *labels,
        '--network', network, '--network-alias', 'release-dice', '--memory', '256m', '--cpus', '1',
        '-e', 'PORT=4000', '-e', 'DICE_BIND_HOST=0.0.0.0', images['dice']])
    # Each attempt lasts at most two seconds plus one second between attempts.
    # The readiness command streams its output to a dedicated stage log.
    health = ('attempt=0; until curl --fail --silent --max-time 2 http://127.0.0.1:4000/health; '
              'do attempt=$((attempt + 1)); if [ "$attempt" -ge 30 ]; '
              'then echo "Dice service did not become ready" >&2; exit 1; fi; sleep 1; done')
    runner.run('test-dice-ready', [*docker, 'exec', container, 'sh', '-c', health])


def backend_checks(workspace, images, runner, sudo=False, only=None, test_images=None):
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
            (test_images or {}).get('postgres', 'postgres:16')])
        created.append(redis)
        runner.run('test-redis', [*docker, 'run', '-d', '--name', redis, *labels,
            '--network', network, '--network-alias', 'release-redis', '--memory', '128m',
            (test_images or {}).get('redis', 'redis:7-alpine')])
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
            'DICE_SERVICE_URL': 'http://release-dice:4000',
            'ALLOWED_HOSTS': 'testserver,localhost', 'GAMELINK_ENABLED': '0',
            'GAMELINK_BACKGAMMON_URL': 'https://game.example.test', 'GAMELINK_TOURNAMENTS_URL': 'https://club.example.test',
            'WEB_PUSH_PUBLIC_KEY': '', 'WEB_PUSH_PRIVATE_KEY': '', 'WEB_PUSH_SUBJECT': '',
            'TRANZILA_ENABLED': '0', 'TRANZILA_PURCHASES_ENABLED': '0', 'ACCOUNT_EMAIL_ACTIONS_ENABLED': '0',
        }
        for kind, (directory, base) in BACKENDS.items():
            if only is not None and kind not in only:
                continue
            service_environment = dict(environment, RELEASE_BASE_SETTINGS=base)
            if kind == 'tournaments':
                # Distinct disposable keys only for this test service.
                service_environment.update(
                    GAMELINK_TICKET_SECRET='release-test-only-ticket-key-0123456789abcdef',
                    GAMELINK_RESULT_SECRETS='release-test-only-result-key-0123456789abcdef',
                    GAMELINK_COMMAND_SECRET='release-test-only-command-key-0123456789abcdef',
                )
            for action, command in (
                ('migrations', ['makemigrations', '--check', '--dry-run']),
                ('tests', ['test', '--noinput', '--verbosity', '2']),
            ):
                if kind == 'game' and action == 'tests':
                    start_test_dice(images, runner, docker, network, labels, created)
                container = network + '-' + kind + '-' + action
                created.append(container)
                args = [*docker, 'run', '--name', container, *labels, '--network', network,
                    '--memory', '1536m', '--cpus', '1', '--entrypoint', 'python', '--workdir', directory,
                    '--mount', 'type=bind,source=' + str(test_tools) + ',target=/opt/release,readonly']
                for key, value in service_environment.items():
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


def frontend_checks(root, runner, only=None):
    pnpm = shutil.which('pnpm.cmd' if os.name == 'nt' else 'pnpm')
    require(pnpm, 'pnpm is required')
    environment = dict(os.environ, CI='true')
    sites = (
        ('game', root / 'Backgammon Game/frontend', ['test', '--workers=2']),
        ('tournaments', root / 'backgammon-tournaments', ['test:unit', '--run']),
        ('admin', root / 'backgammon-tournaments-backend/admin-frontend', ['test:unit', '--run']),
    )
    for name, directory, test in sites:
        if only is not None and name not in only:
            continue
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


def publish_exact(root, sources, runner, receipt):
    publish(root, sources, runner, receipt)
    for name, source in sources.items():
        remote = git(root / name, 'ls-remote', '--exit-code', 'origin', 'refs/heads/' + source['branch']).split()[0]
        require(remote == source['revision'], 'Published branch changed: ' + name)


def dice_checks(workspace, release_id, runner):
    recipe = workspace / 'docker/dice.Dockerfile'
    test_recipe = runner.directory / 'dice-tests.Dockerfile'
    test_recipe.write_text(recipe.read_text().split('FROM debian:')[0]
                          + '\nCOPY ["Backgammon Game/dice_service/test/", "/app/test/"]\nRUN MIX_ENV=test mix test\n',
                          encoding='utf-8')
    runner.run('dice-tests', ['docker', 'build', '--file', test_recipe,
               '--tag', 'backgammon-dice-tests:' + release_id, workspace])


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


def read_server_state(config):
    """Standalone read-only probe sent over SSH before expensive local checks."""
    import fcntl
    import json
    from pathlib import Path
    import subprocess

    def output(args):
        result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if result.returncode:
            raise RuntimeError(result.stderr.decode('utf-8', errors='replace')[-2000:])
        return result.stdout.decode('utf-8')

    subprocess.run(['sudo', '-v'], check=True)
    folder = Path(config['root']) / 'reports/auto-releases'
    current = folder / 'current.json'
    if not current.is_file() or current.is_symlink():
        raise RuntimeError('A registered current production receipt is required before automatic releases')
    with (folder / '.deployment.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another server deployment is running; wait for it to finish')
        state = json.loads(current.read_text())
        if state.get('stage') != 'production_open':
            raise RuntimeError('Production requires recovery: ' + str(state.get('stage')))
        nginx = output(['sudo', '-n', 'cat', state['nginx_file']])
        if 'if ($remote_addr != 127.0.0.1) { return 503; }' in nginx:
            raise RuntimeError('Production is already in maintenance; inspect its receipt before retrying')
        ids = output(['sudo', '-n', 'docker', 'ps', '-q', '--filter',
                      'label=com.docker.compose.project=' + config['project']]).split()
        if not ids:
            raise RuntimeError('Production containers are missing')
        containers = {}
        for item in json.loads(output(['sudo', '-n', 'docker', 'inspect', *ids])):
            labels = item['Config'].get('Labels') or {}
            if labels.get('com.docker.compose.oneoff', '').lower() != 'true':
                service = labels.get('com.docker.compose.service')
                if service in containers:
                    raise RuntimeError('Ambiguous production service: ' + service)
                containers[service] = item
        if not all(service in containers for service in config['services']):
            raise RuntimeError('A production service is not running; inspect the current stack')
        command = (
            'import json; from game.models import GameRoom; from game.operations import delivery_health; '
            'rooms=GameRoom.objects.exclude(status__in=["completed","cancelled"]); '
            'print("BG_RELEASE_RUNTIME "+json.dumps({"active_count":rooms.count(), '
            '"rooms":list(rooms.order_by("created_at").values("code","status","updated_at")[:20]), '
            '"delivery":delivery_health()},default=str))'
        )
        text = output(['sudo', '-n', 'docker', 'exec', containers['game-api']['Id'],
                       'python', '/opt/docker/runtime_env.py', 'python', 'manage.py', 'shell', '-c', command])
        lines = [line.split('BG_RELEASE_RUNTIME ', 1)[1] for line in text.splitlines() if 'BG_RELEASE_RUNTIME ' in line]
        if len(lines) != 1:
            raise RuntimeError('Production readiness returned no unambiguous result')
        runtime = json.loads(lines[0])
        already_current = state.get('sources') == config['sources'] and all(
            containers[service]['Image'] == state.get('images', {}).get(config['service_image'][service])
            for service in config['service_image'] if service in config['services']
        ) and all(containers[service]['State'].get('Health', {}).get('Status') == 'healthy'
                  for service in config['apps'])
        return dict(runtime, already_current=already_current, current_release=state.get('release_id'))


def server_readiness(sources, runner):
    config = {'root': SERVER_ROOT.as_posix(), 'project': PROJECT, 'sources': sources,
              'services': list(APPS + WORKERS + ('postgres', 'redis')),
              'apps': list(APPS), 'service_image': SERVICE_IMAGE}
    code = inspect.getsource(read_server_state) + '\nimport json\nprint("BG_RELEASE_SERVER_STATE " + json.dumps(read_server_state('
    code += repr(config) + '), ensure_ascii=True))\n'
    encoded = base64.b64encode(code.encode()).decode('ascii')
    bootstrap = 'import base64;exec(compile(base64.b64decode(' + repr(encoded) + '),"release-readiness","exec"))'
    runner.run('server-readiness', ['ssh', '-tt', SSH_TARGET, 'python3 -c ' + shlex.quote(bootstrap)])
    path = runner.directory / f'{runner.counter:03d}-server-readiness.log'
    marker = 'BG_RELEASE_SERVER_STATE '
    lines = [line.split(marker, 1)[1] for line in path.read_text(encoding='utf-8').splitlines() if marker in line]
    require(len(lines) == 1, 'Server readiness returned no unambiguous result; inspect ' + str(path))
    return json.loads(lines[0])


def require_ready(state):
    require(state.get('active_count') == 0, 'Production has active/waiting games: ' + json.dumps(state.get('rooms', []))
            + '. Finish or resolve them, then run the same command again.')
    delivery = state.get('delivery', {})
    require(delivery.get('status') == 'ok' and delivery.get('queued_results') == 0,
            'Production result deliveries are not drained: ' + json.dumps(delivery)
            + '. Resolve the reported deliveries, then run the same command again.')


def release_tool_checks(runner):
    # These tests deliberately simulate publication/deployment failures. Keep
    # their fake workflow output separate from the live release's stage output.
    code = (
        'import contextlib,io,sys,unittest\n'
        f'workflow=unittest.TestLoader().discover({str(Path(__file__).resolve().parent)!r},pattern="test_release*.py")\n'
        f'builder=unittest.TestLoader().discover({str(Path(__file__).resolve().parents[1] / "docker")!r},pattern="test_configure_builder.py")\n'
        'suite=unittest.TestSuite([workflow,builder])\n'
        'captured=io.StringIO()\n'
        'with contextlib.redirect_stdout(captured):\n'
        '    result=unittest.TextTestRunner(stream=sys.stderr,verbosity=2).run(suite)\n'
        'if not result.wasSuccessful(): sys.stdout.write(captured.getvalue())\n'
        'raise SystemExit(0 if result.wasSuccessful() else 1)\n'
    )
    runner.run('release-tool-tests', [sys.executable, '-c', code])


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
            if selector.split()[-1].startswith(('/6b', '/backgammon', '/tournaments'))
            or selector.split()[-1] in ('/api/link/', '/api/gamelink/', '/api/admin/')]


MANAGED_NGINX_INCLUDE = '/etc/backgammon-docker/nginx.production.locations.conf'


def maintenance_config(text, managed_include=None):
    directive = re.compile(r'(?m)^[ \t]*include[ \t]+'
                           + re.escape(MANAGED_NGINX_INCLUDE) + r'[ \t]*;[ \t]*$')
    if directive.search(text):
        require(managed_include is not None, 'The managed /6b/ Nginx include must be inspected before maintenance')
        # Inline the inspected include in the temporary maintenance file so
        # every /6b/ route receives the same write guard as the existing APIs.
        text = directive.sub(lambda _: managed_include, text)
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
        # docker exec bypasses the image entrypoint that loads runtime secrets.
        self.runner.run('active-games', [*self.compose(self.old_file), 'exec', '-T', 'game-api',
                                        'python', '/opt/docker/runtime_env.py',
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
        for path in ('/backgammon/api/health/', '/tournaments-api/health/', '/6b/backgammon/', '/6b/tournaments/', '/tournaments-admin/'):
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
        include = None
        if re.search(r'(?m)^[ \t]*include[ \t]+' + re.escape(MANAGED_NGINX_INCLUDE)
                     + r'[ \t]*;[ \t]*$', self.original_nginx):
            include = capture(['sudo', '-n', 'cat', MANAGED_NGINX_INCLUDE]).decode()
        self.nginx_apply(maintenance_config(self.original_nginx, include), 'maintenance')
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



def legacy_local_main(args):
    root = args.root.resolve()
    sources = local_environment(root)
    reused = resume_checks(root, args.resume_from, sources) if args.resume_from else None
    if args.preflight_only:
        print('PREFLIGHT PASSED. No tests, builds, push, SSH or production changes were performed.')
        if reused:
            print('RESUME PREFLIGHT PASSED. Completed stages and unchanged reused inputs verified.')
        return
    release = 'bg-release-' + datetime.now(timezone.utc).strftime('%Y%m%dt%H%M%Sz') + '-' + uuid.uuid4().hex[:8]
    manifest = {'schema_version': 1, 'release_id': release, 'sources': sources}
    runner = Runner(root / 'artifacts/auto-releases' / release)
    receipt = {'stage': 'checking', 'release_id': release, 'sources': sources, 'published': {}}
    if reused:
        receipt['resumed_from'] = reused[1]
    save(runner.directory / 'status.json', receipt)
    try:
        if reused and reused[1].get('resume_backend') == 'tournaments':
            print('RESUMING LOCAL CHECKS from ' + args.resume_from
                  + ': all frontend checks and game backend tests already completed. '
                  'Rebuilding changed tournament test image, then checking tournaments, analysis and dice.', flush=True)
        elif reused and reused[0] is None:
            print('RESUMING LOCAL CHECKS from ' + args.resume_from
                  + ': game/admin frontend tests and builds already completed. '
                  'Rechecking changed tournaments frontend, then building images and running backend checks.', flush=True)
            frontend_checks(root, runner, only=reused[1]['rerun_frontends'])
        elif reused:
            print('RESUMING LOCAL CHECKS from ' + args.resume_from
                  + ': frontend tests/builds and seven local image builds already completed. '
                  'Continuing at game-migrations. Server builds/checks still run during deployment.', flush=True)
        else:
            frontend_checks(root, runner)
        assert_sources(root, sources)
        workspace = exported_workspace(root, manifest, runner.directory / 'source')
        images = dict(reused[0]) if reused and reused[0] is not None else image_builds(workspace, manifest, runner)
        if reused and reused[1].get('resume_backend') == 'tournaments':
            rebuild = reused[1]['rebuild_images']
            if rebuild:
                images.update(image_builds(workspace, manifest, runner, kinds=rebuild))
            backend_checks(workspace, images, runner, only=('tournaments', 'analysis'))
        else:
            backend_checks(workspace, images, runner)
        dice_checks(workspace, release, runner)
        assert_sources(root, sources)
        receipt['stage'] = 'checks_passed'
        save(runner.directory / 'status.json', receipt)
        if args.checks_only:
            print('CHECKS PASSED. No push, SSH or production changes were performed. Receipts: ' + str(runner.directory))
            return
        publish_exact(root, sources, runner, receipt)
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


def server_main(manifest):
    automatic = manifest.get('workflow_version') == WORKFLOW_VERSION
    import fcntl
    validate_manifest(manifest)
    if automatic:
        require(manifest.get('tools') == tool_hashes(), 'Uploaded release tools differ from checked inputs')
    root = SERVER_ROOT / 'reports/auto-releases'
    require(SERVER_ROOT.is_dir(), 'Expected Bot1 project root is missing')
    root.mkdir(parents=True, exist_ok=True)
    root.chmod(0o700)
    with (root / '.deployment.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        subprocess.run(['sudo', '-v'], check=True)
        directory = root / manifest['release_id']
        require(not directory.exists(), 'Release attempt already exists; inspect its receipt')
        runner = Runner(directory)
        production = None
        try:
            production = Production(runner)
            production.status.update(release_id=manifest['release_id'], sources=manifest['sources'])
            if automatic:
                production.status.update(workflow_version=WORKFLOW_VERSION, tools=manifest['tools'])
            production.checkpoint('production_verified')
            save(directory / 'manifest.json', manifest)
            previous = latest_progress(root, manifest['sources'], 'server') if automatic and not manifest.get('fresh') else None
            progress = ReleaseProgress(runner, manifest, 'server', previous) if automatic else None
            if previous:
                production.status['resumed_from'] = previous[0].name
                print('CONTINUING SERVER WORK from ' + previous[0].name, flush=True)
            source_root = SERVER_ROOT / 'sources'
            source_inventory(source_root, server=True)
            for name, expected in manifest['sources'].items():
                checkout = source_root / SOURCES[name][2]
                remote = git(checkout, 'ls-remote', '--exit-code', 'origin', 'refs/heads/' + expected['branch']).split()[0]
                require(remote == expected['revision'], 'Remote branch moved after local checks: ' + name)
                runner.run('pull-' + name.replace(' ', '-'), ['git', '-c', 'safe.directory=' + checkout.as_posix(),
                           '-C', checkout, 'pull', '--ff-only', 'origin', expected['branch']])
                require(git(checkout, 'rev-parse', 'HEAD') == expected['revision'], 'Pulled revision differs: ' + name)
            require(source_inventory(source_root, server=True) == manifest['sources'], 'Server sources differ')
            workspace = exported_workspace(source_root, manifest, directory / 'source', server=True)
            images = (checked_images(workspace, manifest, runner, progress, sudo=True) if automatic
                      else image_builds(workspace, manifest, runner, sudo=True))
            production.checkpoint('images_verified')
            if automatic:
                checked_backends(workspace, images, runner, progress, sudo=True)
            else:
                backend_checks(workspace, images, runner, sudo=True)
            production.checkpoint('server_checks_passed')
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


def automatic_local_main(args):
    root = args.root.resolve()
    sources = local_environment(root)
    fresh = getattr(args, 'fresh', False) is True
    previous = None if fresh else latest_progress(root / 'artifacts/auto-releases', sources, 'local')
    if args.preflight_only:
        print('PREFLIGHT PASSED. No tests, builds, push, SSH or production changes were performed.')
        if previous:
            print('Automatic continuation candidate: ' + previous[0].name
                  + '. Its completed phases/resources will be verified before reuse.')
        return
    release_id = 'bg-release-' + datetime.now(timezone.utc).strftime('%Y%m%dt%H%M%Sz') + '-' + uuid.uuid4().hex[:8]
    manifest = {'schema_version': 1, 'workflow_version': WORKFLOW_VERSION, 'release_id': release_id,
                'sources': sources, 'tools': tool_hashes(), 'fresh': fresh}
    directory = root / 'artifacts/auto-releases' / release_id
    require(not directory.exists(), 'Release attempt already exists; inspect its receipt')
    runner = Runner(directory)
    receipt = dict(manifest, stage='checking', published={})
    if previous:
        receipt['resumed_from'] = previous[0].name
    save(runner.directory / 'status.json', receipt)
    progress = ReleaseProgress(runner, manifest, 'local', previous)
    try:
        if not args.checks_only:
            state = server_readiness(sources, runner)
            assert_sources(root, sources)
            if state.get('already_current') and not fresh:
                receipt.update(stage='production_open', already_current=True, current_release=state['current_release'])
                save(runner.directory / 'status.json', receipt)
                print('THESE COMMITS ARE ALREADY IN HEALTHY PRODUCTION. Current release: ' + str(state['current_release']))
                return
            require_ready(state)
        if previous:
            print('CONTINUING LOCAL WORK from ' + previous[0].name, flush=True)
        tool_inputs = {'python': sys.version, 'platform': sys.platform,
                       'compose': capture(['docker', 'compose', 'version', '--short']).decode().strip()}
        progress.run('release-tool-tests', ['release-tool-tests'], lambda: release_tool_checks(runner), inputs=tool_inputs)
        frontend_inputs = {'node': capture(['node', '--version']).decode().strip(),
                           'pnpm': capture([shutil.which('pnpm.cmd' if os.name == 'nt' else 'pnpm'), '--version']).decode().strip(),
                           'platform': sys.platform}
        for site in ('game', 'tournaments', 'admin'):
            stages = [site + '-dependencies'] + (['playwright-browser'] if site == 'game' else [])
            stages += [site + '-frontend-tests', site + '-frontend-build']
            def check_frontend(site=site):
                frontend_checks(root, runner, only=(site,))
                assert_sources(root, sources)
            progress.run('frontend-' + site, stages, check_frontend,
                         inputs=frontend_inputs)
            assert_sources(root, sources)
        workspace = exported_workspace(root, manifest, runner.directory / 'source')
        images = checked_images(workspace, manifest, runner, progress)
        checked_backends(workspace, images, runner, progress)

        progress.run('dice-tests', ['dice-tests'], lambda: dice_checks(workspace, release_id, runner), inputs=images)
        assert_sources(root, sources)
        receipt['stage'] = 'checks_passed'
        save(runner.directory / 'status.json', receipt)
        if args.checks_only:
            print('CHECKS PASSED. No push, SSH or production changes. Receipts: ' + str(runner.directory))
            return
        # Check again after lengthy tests, before publishing anything.
        require_ready(server_readiness(sources, runner))
        assert_sources(root, sources)
        publish_exact(root, sources, runner, receipt)
        receipt['stage'] = 'published'
        save(runner.directory / 'status.json', receipt)
        upload_and_deploy(manifest, runner)
        receipt['stage'] = 'production_open'
        save(runner.directory / 'status.json', receipt)
        print('CHECKS, PUBLICATION AND PRODUCTION UPDATE COMPLETE. Receipts: ' + str(runner.directory))
    except BaseException as error:
        receipt.update(stage='failed', failed_stage=runner.stage, error=str(error))
        save(runner.directory / 'status.json', receipt)
        print('\nFAILED STAGE: ' + runner.stage + '\nERROR: ' + str(error) + '\nRECEIPTS: ' + str(runner.directory)
              + '\nAfter resolving the error, run PUBLISH_AND_DEPLOY.ps1 again.', flush=True)
        if receipt['published']:
            print('Published commits retained: ' + json.dumps(receipt['published']), flush=True)
        raise


def local_main(args):
    with workspace_lock(args.root.resolve()):
        if args.resume_from:
            return legacy_local_main(args)
        return automatic_local_main(args)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    # The SSH upload lives in a shallower directory than the versioned local tool.
    # PowerShell supplies the local workspace explicitly; server mode uses SERVER_ROOT.
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--checks-only', action='store_true')
    parser.add_argument('--preflight-only', action='store_true')
    parser.add_argument('--resume-from', help='Reuse verified stages from a supported unpublished local failure')
    parser.add_argument('--fresh', action='store_true', help='Start full checks without reusing completed phases')
    parser.add_argument('--server', action='store_true')
    parser.add_argument('--manifest', type=Path)
    args = parser.parse_args()
    try:
        require(not (args.fresh and args.resume_from), 'Fresh and ResumeFrom cannot be combined')
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
