"""Operator-run refresh of an idle, cleaned r7 observer; preserve copied data.

Run this published program through stdin from the PC before updating Bot1's
canonical checkout. That lets the old tooling validate and retire its own
prepared identity before the source it pins changes.
"""
import json
from pathlib import Path
import re
import subprocess
import sys
import time
from types import SimpleNamespace
import uuid


def require(value, message):
    if not value:
        raise ValueError(message)


def refresh(revision):
    import fcntl
    require(re.fullmatch(r'[a-f0-9]{40}', revision), 'Pass the full published tools revision')
    root = Path('/home/dev/backgammon-project')
    tag = 'backgammon-production-candidate-20261007-r7'
    validation = '9b192fc698864e528a2fc78d1ede5567'
    project = root / 'deploy/backgammon-deploy' / tag
    rehearsal = root / 'backups/backgammon-backups' / ('validation-' + validation) / 'docker-rehearsal'
    repository = root / 'sources/backgammon'
    tools = repository / 'deploy/workspace/docs/tournament-e2e'
    state = rehearsal / 'browser-load'
    require(not state.is_symlink() and state.resolve(strict=True) == state,
            'Unsafe or missing current browser-load directory')
    require(json.loads((root / 'reports/release-validation' / tag / 'plan.json').read_text())['validation_id']
            == validation, 'Candidate identity changed')
    sys.path.insert(0, str(tools))
    # These imports intentionally load the still-pinned OLD canonical source.
    import server_rehearsal as server
    from copied_load import verify_prepared_tools
    from copied_runtime import check_runtime
    args = SimpleNamespace(project=project, rehearsal=rehearsal, copied_load=True)
    subprocess.run(['sudo', '-v'], check=True)
    server.configure_target(args)
    git = ['git', '-c', 'safe.directory=' + str(repository), '-C', str(repository)]
    require(server.run([*git, 'branch', '--show-current'], capture=True) == 'master'
            and server.run([*git, 'remote', 'get-url', 'origin'], capture=True)
            == 'https://github.com/beny25585/backgammon.git', 'Unexpected server repository or branch')
    # Fetch changes no worktree files; validate the destination before touching services.
    server.run([*git, 'fetch', 'origin', 'master'])
    require(server.run([*git, 'rev-parse', 'origin/master'], capture=True) == revision,
            'Remote master differs from the published revision requested by the PC')
    with (state / 'load-operation.lock').open('a') as guard:
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(not (state / 'load-run.lock').exists(), 'A run still needs cleanup; do not update source')
        session = server.verify_config(args, state)
        require(session['identity']['validation_id'] == validation, 'Prepared candidate differs')
        verify_prepared_tools(server, session)
        server.verify_live(session)
        reports = list(state.glob('load-*-report.json'))
        require(reports, 'No completed cleanup reports exist')
        for file in reports:
            require(not file.is_symlink(), 'Unsafe cleanup report')
            report = json.loads(file.read_text())
            cleanup = report.get('cleanup', {})
            require(report.get('targetSession') == session['identity']['session_id']
                    and cleanup.get('passed') is True and cleanup.get('servicesRestored') is True,
                    'An earlier run has incomplete cleanup: ' + file.name)
            for kind in ('game', 'tournaments', 'analysis'):
                receipt = cleanup.get('receipts', {}).get(kind, {})
                require(receipt.get('passed') is True and receipt.get('preExistingRowsProtected') is True
                        and receipt.get('kind') == kind and receipt.get('runId') == report.get('runId')
                        and receipt.get('targetSession') == report['targetSession'],
                        'Missing matching protected cleanup receipt: ' + file.name + '/' + kind)
        candidate = state / 'nginx.candidate.conf'
        require(candidate.is_file() and not candidate.is_symlink() and not server.CONF.is_symlink(),
                'Unsafe test listener')
        require(server.run(['sudo', 'cat', server.CONF], capture=True).strip() == candidate.read_text().strip(),
                'Test listener differs from prepared state')
        require(not session.get('load_overlay_disabled'), 'Observer already disabled; inspect retained state')
        require(all(not Path(file).is_relative_to(state) for file in session['compose_files']),
                'Base Compose files unexpectedly include the observer')
        previous = json.dumps(session, indent=2) + '\n'

        def listener():
            value = server.nginx(session['identity'], server.discover_upstreams(session))
            candidate.write_text(value, encoding='utf-8')
            server.run(['sudo', 'install', '-m', '0644', candidate, server.CONF])
            server.run(['sudo', 'nginx', '-t'])
            server.run(['sudo', 'systemctl', 'reload', 'nginx'])
            server.check_listener(session)

        try:
            print('RETIRE OBSERVER: restore the private candidate runtime; copied data stays in place', flush=True)
            session['load_overlay_disabled'] = True
            # Preserve the inode bind-mounted in the current APIs until recreation.
            (state / 'session.json').write_text(json.dumps(session, indent=2) + '\n', encoding='utf-8')
            server.verify_config(args, state)
            server.compose(args, state, 'up', '-d', '--no-build', '--no-deps', '--force-recreate',
                           'game-api', 'tournaments-api')
            server.wait_application_health(session, time.monotonic() + 180, bootstrap=True)
            check_runtime()  # Includes email and payment OFF in actual Django settings.
            listener()
        except BaseException:
            print('RETIRE FAILED: restoring the old prepared observer', flush=True)
            (state / 'session.json').write_text(previous, encoding='utf-8')
            session.pop('load_overlay_disabled', None)
            server.compose(args, state, 'up', '-d', '--no-build', '--no-deps', '--force-recreate',
                           'game-api', 'tournaments-api')
            server.wait_application_health(session, time.monotonic() + 180, bootstrap=True)
            listener()
            server.verify_live(session)
            raise
        archive = rehearsal / ('browser-load-retired-' + uuid.uuid4().hex)
        require(archive.parent.resolve(strict=True) == rehearsal and not archive.exists(), 'Unsafe archive target')
        state.rename(archive)
        print('OLD PREPARATION PRESERVED: ' + str(archive), flush=True)

    server.run([*git, 'pull', '--ff-only', 'origin', 'master'])
    require(server.run([*git, 'rev-parse', 'HEAD'], capture=True) == revision
            and not server.run([*git, 'status', '--porcelain', '--untracked-files=all'], capture=True),
            'Updated canonical source must be the exact clean published revision')
    # Tests are run by the human operator executing this program, never by the assistant.
    for pattern in ('copied_load_test.py', 'copied_runtime_test.py', 'copied_network_test.py',
                    'rehearsal_context_test.py', 'rehearsal_runtime_test.py'):
        subprocess.run(['python3', '-m', 'unittest', 'discover', '-s', str(tools), '-p', pattern], check=True)
    # Node readiness tests run on the PC before dispatch; no Bot1 Node install is required.
    common = ['--project', str(project), '--rehearsal', str(rehearsal), '--tools-revision', revision]
    subprocess.run(['python3', str(tools / 'copied_runtime.py'), *common], check=True)
    subprocess.run(['python3', str(tools / 'server_rehearsal.py'), 'prepare-load', '--copied-load', *common], check=True)
    # Carry retired account/callback guards forward; preserve all original receipts in archive.
    for name in ('load-retired-identities.json', 'load-retired-runs.json'):
        old, new = archive / 'audit' / name, state / 'audit' / name
        if old.exists():
            require(old.is_file() and not old.is_symlink() and not new.exists() and not new.is_symlink(),
                    'Unsafe retired identity receipt')
            require(isinstance(json.loads(old.read_text()), list), 'Invalid retired identity receipt')
            with new.open('xb') as stream:
                stream.write(old.read_bytes())
            new.chmod(0o644)
    print('READY: download ' + str(state / 'server-client.json') + ' and run 32 players from the PC', flush=True)


if __name__ == '__main__':
    require(len(sys.argv) == 2, 'Usage: refresh_r7_load.py FULL_PUBLISHED_TOOL_COMMIT')
    refresh(sys.argv[1])
