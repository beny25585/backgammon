"""Build and switch the approved entry patch in the existing browser rehearsal only."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import server_rehearsal as rehearsal
from rehearsal_context import require_fresh_database_context


OLD_REVISION = 'f4eaa6073c38a9f01157f7f525ebda00a73ac6ee'
NEW_REVISION = '4cae43076a208c0abe824c0aa227c2b41dd0a31b'
OLD_IMAGE = 'sha256:5dd9ea6392176a97a32b8a27c1e4c0c6eb6a5e68da4b0d84a2b6bcde4dce9b81'
TAG = 'bg-20261006-entry-4cae430'
IMAGE = 'backgammon-production-tournaments:' + TAG
SERVICES = ('tournaments-api', 'tournaments-tasks', 'tournaments-migrate')
ARTIFACTS = ('session.json', 'identity.json', 'server-client.json', 'compose.e2e.json', 'nginx.candidate.conf')
PATCH_FILES = {'tournaments/gamelink/consumers.py', 'tournaments/gamelink/entry_presence.py',
               'tournaments/gamelink/test_event_entry.py'}


def read(path):
    rehearsal.require(path.is_file() and not path.is_symlink(), 'Unsafe or missing file: ' + str(path))
    return json.loads(path.read_text())


def save(path, value):
    rehearsal.require(not path.is_symlink(), 'Refusing symlink: ' + str(path))
    encoded = json.dumps(value, indent=2) + '\n'
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        stream.write(encoded)


def git(directory, *args):
    return rehearsal.run(['git', '-C', directory, *args], capture=True)


def validate_old(session):
    identity = session['identity']
    require_fresh_database_context(identity)
    source = next(item for item in identity['sources'] if item['path'] == 'backgammon-tournaments-backend')
    rehearsal.require(source['revision'] == OLD_REVISION and identity['images']['tournaments'] == OLD_IMAGE,
                      'Expected the measured R2 tournament release')


def candidate(session, overrides, built, tools):
    validate_old(session)
    updated = copy.deepcopy(session)
    config = copy.deepcopy(overrides)
    for service in SERVICES:
        rehearsal.require(config['services'][service]['image'] == OLD_IMAGE, 'Unexpected original image')
        config['services'][service]['image'] = built['id']
    updated['identity']['images']['tournaments'] = built['id']
    updated['identity']['image_tag'] = TAG
    for item in updated['identity']['sources']:
        if item['path'] == 'backgammon-tournaments-backend':
            item['revision'] = NEW_REVISION
    updated['tools_dir'] = str(tools)
    return updated, config


def build(args, state, tools):
    session = rehearsal.verify_config(args, state)
    validate_old(session)
    rehearsal.verify_live(session)
    rehearsal.check_listener(session)
    rehearsal.require(read(state / 'server-client.json')['identity'] == session['identity']
                      == read(state / 'identity.json'), 'Prepared identity artifacts differ')
    plan = {'session_id': session['identity']['session_id'], 'revision': NEW_REVISION, 'image': IMAGE}
    if args.update.exists():
        rehearsal.require(not args.update.is_symlink() and read(args.update / 'plan.json') == plan
                          and not (args.update / 'before').exists(), 'Existing update belongs to another operation')
    else:
        args.update.mkdir(mode=0o700)
        save(args.update / 'plan.json', plan)
    context = args.update / 'context'
    context.mkdir(mode=0o700, exist_ok=True)
    source = context / 'backgammon-tournaments-backend'
    if not source.exists():
        rehearsal.run(['git', 'clone', '--no-checkout', 'git@github.com:Maestroxr/tournaments.git', source])
        rehearsal.run(['git', '-C', source, 'checkout', '--detach', NEW_REVISION])
    rehearsal.require(git(source, 'rev-parse', 'HEAD') == NEW_REVISION and not git(source, 'status', '--porcelain'),
                      'Build source is not the clean approved commit')
    changed = set(git(source, 'diff', '--name-only', OLD_REVISION, NEW_REVISION).splitlines())
    rehearsal.require(changed == PATCH_FILES, 'Entry update includes unrelated source changes')
    release = read(args.project / '.workspace-release.json')
    names = ('python.Dockerfile', 'runtime_env.py', 'prepare_local.py',
             'tournaments_transfer.py', 'service_runtime.py')
    (context / 'docker').mkdir(exist_ok=True)
    for name in names:
        relative = 'docker/' + name
        file = args.project / relative
        rehearsal.require(not file.is_symlink() and hashlib.sha256(file.read_bytes()).hexdigest()
                          == release['files'].get(relative), 'R2 build file changed: ' + relative)
        shutil.copyfile(file, context / relative)
    # This context contains only a clean Git checkout and the verified public build files.
    (context / '.dockerignore').write_text('**/.git\n**/__pycache__\n**/.env\n**/.env.*\n')
    builder = 'backgammon-build-' + TAG
    buildkit = args.project / 'docker/buildkit.production.toml'
    rehearsal.require(hashlib.sha256(buildkit.read_bytes()).hexdigest()
                      == release['files'].get('docker/buildkit.production.toml'), 'R2 builder configuration changed')
    exists = subprocess.run(['sudo', 'docker', 'buildx', 'inspect', builder],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    if not exists:
        rehearsal.docker('buildx', 'create', '--name', builder, '--driver', 'docker-container',
                         '--driver-opt', 'memory=3g,memory-swap=3g,cpu-period=100000,cpu-quota=100000,default-load=true,restart-policy=no',
                         '--buildkitd-config', buildkit)
    try:
        rehearsal.docker('buildx', 'inspect', builder, '--bootstrap')
        limits = rehearsal.docker('inspect', 'buildx_buildkit_' + builder + '0', '--format',
                                  '{{.HostConfig.Memory}} {{.HostConfig.MemorySwap}} {{.HostConfig.CpuPeriod}} {{.HostConfig.CpuQuota}}', capture=True)
        rehearsal.require(limits == '3221225472 3221225472 100000 100000', 'Builder limits differ')
        rehearsal.docker('buildx', 'build', '--builder', builder, '--load', '--progress', 'plain',
                         '--build-arg', 'APP_DIR=backgammon-tournaments-backend',
                         '--build-arg', 'SOURCE_REVISION=' + NEW_REVISION, '--build-arg', 'RELEASE_TAG=' + TAG,
                         '-t', IMAGE, '-f', context / 'docker/python.Dockerfile', context)
    finally:
        rehearsal.docker('buildx', 'stop', builder)
    image = json.loads(rehearsal.docker('image', 'inspect', IMAGE, '--format',
                                       '{"id":{{json .Id}},"revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}},"release":{{json (index .Config.Labels "io.backgammon.release")}}}', capture=True))
    rehearsal.require(image['revision'] == NEW_REVISION and image['release'] == TAG, 'Built image labels differ')
    save(args.update / 'built.json', image)
    print('BUILD VERIFIED. R2 and the running test applications are preserved. Next: apply.')


def remove_stopped_tournaments(args, state, session, allowed_images=None):
    allowed_images = allowed_images or {session['identity']['images']['tournaments']}
    for service in SERVICES:
        identifiers = rehearsal.docker('ps', '-aq', '--filter', 'label=com.docker.compose.project=' + rehearsal.PROJECT,
                                       '--filter', 'label=com.docker.compose.service=' + service, capture=True).splitlines()
        for identifier in identifiers:
            value = json.loads(rehearsal.docker('inspect', identifier, '--format',
                                                '{"image":{{json .Image}},"status":{{json .State.Status}}}', capture=True))
            rehearsal.require(value['image'] in allowed_images
                              and value['status'] in ('created', 'exited'), 'Unexpected tournament container')
    # No volumes, infrastructure, or production containers are removed.
    rehearsal.compose(args, state, 'rm', '-f', *SERVICES)


def command(args, tools, action):
    rehearsal.run([sys.executable, tools / 'server_rehearsal.py', action,
                   '--project', args.project, '--rehearsal', args.rehearsal])


def apply(args, state, tools):
    session = rehearsal.verify_config(args, state)
    validate_old(session)
    rehearsal.verify_live(session)
    rehearsal.check_listener(session)
    built = read(args.update / 'built.json')
    rehearsal.require(read(args.update / 'plan.json')['session_id'] == session['identity']['session_id'],
                      'Built update belongs to another test session')
    rehearsal.require(rehearsal.docker('image', 'inspect', IMAGE, '--format', '{{.Id}}', capture=True)
                      == built['id'] and built['revision'] == NEW_REVISION, 'Prepared image changed')
    backup = args.update / 'before'
    rehearsal.require(not backup.exists(), 'Backup already exists; use rollback before retrying apply')
    backup.mkdir(mode=0o700)
    for name in ARTIFACTS:
        file = state / name
        rehearsal.require(file.is_file() and not file.is_symlink(), 'Unsafe prepared artifact')
        shutil.copy2(file, backup / name)
    save(args.update / 'previous.json', {'tools_dir': session['tools_dir']})
    updated, overrides = candidate(session, read(state / 'compose.e2e.json'), built, tools)
    command(args, Path(session['tools_dir']), 'stop')
    remove_stopped_tournaments(args, state, session)
    try:
        save(state / 'compose.e2e.json', overrides)
        identity = updated['identity']
        save(state / 'session.json', updated)
        save(state / 'identity.json', identity)
        save(state / 'server-client.json', {'identity': identity, 'admin': updated['admin'],
                                           'harness_files': updated['harness_files']})
        command(args, tools, 'start')
        command(args, tools, 'check')
        command(args, tools, 'baseline')
    except Exception:
        print('UPDATE FAILED. Restoring the previous browser rehearsal.', flush=True)
        rollback(args, state, tools)
        raise
    print('ENTRY UPDATE READY. Download server-client.json again, then run 16 players.')


def rollback(args, state, tools):
    backup = args.update / 'before'
    old_session = read(backup / 'session.json')
    validate_old(old_session)
    session = read(state / 'session.json')
    require_fresh_database_context(session['identity'])
    rehearsal.require(session['identity']['session_id'] == old_session['identity']['session_id']
                      and session['identity']['images']['tournaments'] in (OLD_IMAGE, read(args.update / 'built.json')['id']),
                      'Rollback target differs from the prepared update')
    # Recover even if interruption occurred between artifact writes. The base
    # Compose files still pin the original rehearsal; only this override changed.
    current_overrides = read(state / 'compose.e2e.json')
    old_overrides = read(backup / 'compose.e2e.json')
    for service in SERVICES:
        rehearsal.require(current_overrides['services'][service]['image']
                          in (OLD_IMAGE, read(args.update / 'built.json')['id']), 'Unexpected rollback image')
        current_overrides['services'][service]['image'] = old_overrides['services'][service]['image']
    # Observer mounts/command may already have been refreshed by start. Every
    # other override, including database/cache identity, must match the backup.
    for service in rehearsal.SERVICES:
        current = current_overrides['services'][service]
        previous = old_overrides['services'][service]
        targets = {'/opt/e2e/' + name for name in ('rehearsal_app.py', 'rehearsal_entry.py',
                                                 'rehearsal_settings.py', 'rehearsal_asgi.py', 'rehearsal_context.py')}
        if 'volumes' in previous:
            unchanged = [volume for volume in current.get('volumes', []) if volume.get('target') not in targets]
            expected = [volume for volume in previous['volumes'] if volume.get('target') not in targets]
            rehearsal.require(unchanged == expected, 'Unexpected volume changes during rollback')
            current['volumes'] = previous['volumes']
        if service in ('game-api', 'tournaments-api'):
            for key in ('DJANGO_SETTINGS_MODULE', 'E2E_ADMISSION_KIND', 'PYTHONPATH'):
                if key in previous.get('environment', {}):
                    current.setdefault('environment', {})[key] = previous['environment'][key]
    rehearsal.require(current_overrides == old_overrides, 'Unexpected override changes during rollback')
    if rehearsal.CONF.exists():
        contents = rehearsal.run(['sudo', 'cat', rehearsal.CONF], capture=True)
        rehearsal.require('Session ' + old_session['identity']['session_id'] in contents, 'Unexpected test listener')
        rehearsal.run(['sudo', 'rm', '--', rehearsal.CONF])
        rehearsal.run(['sudo', 'nginx', '-t'])
        rehearsal.run(['sudo', 'systemctl', 'reload', 'nginx'])
    rehearsal.compose(args, state, 'stop', *rehearsal.WORKERS, *rehearsal.APPS)
    remove_stopped_tournaments(args, state, session, {OLD_IMAGE, read(args.update / 'built.json')['id']})
    for name in ARTIFACTS:
        shutil.copy2(backup / name, state / name)
    old_tools = Path(read(args.update / 'previous.json')['tools_dir'])
    command(args, old_tools, 'start')
    command(args, old_tools, 'check')
    print('R2 TEST REHEARSAL RESTORED. Production and database contents were preserved.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('build', 'apply', 'rollback'))
    args = parser.parse_args()
    tools = Path(__file__).resolve().parent
    account_home = Path.home()
    args.project = account_home / 'backgammon-deploy/bg-20261005-git-r2'
    args.rehearsal = account_home / 'backgammon-backups/rehearsal-20261005T184922Z/docker-rehearsal'
    args.update = account_home / ('backgammon-deploy/' + TAG)
    rehearsal.require(account_home == Path('/home/administrator'), 'Expected the observed server account')
    rehearsal.require(git(tools, 'status', '--porcelain') == '', 'Tools checkout must be clean')
    state = args.rehearsal / 'browser-e2e-r2'
    {'build': build, 'apply': apply, 'rollback': rollback}[args.action](args, state, tools)


if __name__ == '__main__':
    main()
