"""Static checks only: no app imports, databases, services, tests or builds."""
import ast
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parent
python_files = ['e2e_common.py', 'backend_bootstrap.py', 'postgresql_runtime.py',
                'runtime_inventory.py', 'tournament_settings.py', 'check-syntax.py',
                'run-postgresql-reliability.py', 'server_rehearsal.py', 'rehearsal_app.py',
                'rehearsal_context.py', 'rehearsal_context_test.py', 'rehearsal_nginx_test.py',
                'rehearsal_audit_test.py',
                'rehearsal_entry.py', 'rehearsal_entry_test.py', 'rehearsal_settings.py', 'rehearsal_asgi.py',
                'entry_flow_report.py', 'entry_flow_report_test.py', 'rehearsal_observer_config_test.py',
                '../../Backgammon Game/backend/backgammon_project/asgi.py',
                '../../Backgammon Game/backend/backgammon_project/settings.py',
                '../../Backgammon Game/backend/game/consumers.py',
                '../../Backgammon Game/backend/game/ai_consumer.py',
                '../../Backgammon Game/backend/game/room_execution.py',
                '../../Backgammon Game/backend/game/tests/test_action_latency.py',
                '../../Backgammon Game/backend/game/tests/test_connection_setup.py',
                '../../Backgammon Game/backend/game/tests/test_room_execution.py']
javascript_files = ['run-e2e.mjs', 'production-ui.mjs', 'parity-report.mjs',
                    'scenario-config.mjs', 'tournament.spec.mjs', 'game-driver.mjs', 'performance-report.mjs',
                    'performance-policy.mjs', 'shared-progress.mjs', 'source-versions.mjs']
javascript_files += ['destination-policy.mjs', 'destination-policy.test.mjs', 'run-remote-e2e.mjs', 'playwright.config.mjs']
javascript_files += ['scenario-config.test.mjs', 'game-driver.test.mjs', 'performance-policy.test.mjs']
javascript_files += ['admission-timing.test.mjs']
javascript_files += ['entry-flow.mjs', 'entry-flow.test.mjs']
for name in python_files:
    compile(ast.parse((root / name).read_text(encoding='utf-8-sig'), filename=name), name, 'exec')
print(f'Python static syntax: {len(python_files)} files passed', flush=True)
node = shutil.which('node')
if not node:
    node = str(Path(sys.executable).parents[2] / 'node' / 'bin' / 'node.exe')
for name in javascript_files:
    subprocess.run([node, '--check', str(root / name)], check=True)
print(f'JavaScript static syntax: {len(javascript_files)} files passed', flush=True)
changed = [name for name in python_files if not name.startswith('../../')] + javascript_files + ['run-tournament-e2e.ps1', 'run-repair-validation.ps1',
                                           'LOCAL_16_PLAYERS.he.md', 'LOCAL_32_PLAYERS.he.md',
                                           'README.he.md', 'REPAIR_VALIDATION.he.md', 'ENTRY_FLOW.he.md', 'PERFORMANCE.he.md']
bad = [f'{name}:{index}' for name in changed
       for index, line in enumerate((root / name).read_text(encoding='utf-8-sig').splitlines(), 1)
       if line.rstrip() != line]
if bad:
    raise SystemExit('Trailing whitespace: ' + ', '.join(bad))
print('Trailing whitespace: none')
