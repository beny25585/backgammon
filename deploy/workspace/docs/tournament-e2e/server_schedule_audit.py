"""Read-only systemd/cron inventory. Share summaries, never raw command arguments."""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import shlex
import subprocess

APP = re.compile(r'backgammon|tournament|t32[-_]|analysis|dice|push|drivecards?', re.I)
UNIT = re.compile(r'[A-Za-z0-9_.:@\\-]+\.(?:service|timer|socket|path)')
MANAGEMENT = ('run_tasks', 'run_tasks_worker', 'process_analyses', 'run_push_notifications',
              'purge_expired', 'reconcile_tranzila', 'schedule_tasks')
PROPERTIES = ('Id', 'Names', 'LoadState', 'ActiveState', 'SubState', 'UnitFileState', 'UnitFilePreset',
              'FragmentPath', 'DropInPaths', 'Type', 'User', 'WorkingDirectory', 'MainPID',
              'Triggers', 'TriggeredBy', 'Wants', 'Requires', 'WantedBy', 'RequiredBy',
              'RemainAfterExit', 'Restart', 'Result', 'ExecMainStatus', 'ExecMainCode',
              'ExecMainStartTimestamp', 'ExecMainExitTimestamp', 'LastTriggerUSec',
              'NextElapseUSecRealtime', 'TimersCalendar', 'TimersMonotonic', 'Persistent', 'ExecStart')


def execute(arguments, diagnostics, label):
    try:
        result = subprocess.run(arguments, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, errors='replace', timeout=40,
                                env=dict(os.environ, LC_ALL='C', SYSTEMD_COLORS='0', SYSTEMD_PAGER='cat'))
    except (OSError, subprocess.TimeoutExpired):
        diagnostics.append({'check': label, 'available': False})
        return 1, ''
    if result.returncode:
        diagnostics.append({'check': label, 'exit_code': result.returncode})
    return result.returncode, result.stdout.strip()


def command_summary(text):
    """Recognize scheduler targets without returning passwords or shell text."""
    try:
        words = shlex.split(text)
    except ValueError:
        words = []
    managed = sorted({word for word in words if word in MANAGEMENT})
    targets = sorted(set(re.findall(r'\bsystemctl\s+(?:(?:--?[^\s]+)\s+)*'
        r'(?:start|restart|try-restart)\s+["\']?([A-Za-z0-9_.:@-]+\.service)', text)))
    scripts = sorted(set(re.findall(r'(?<![A-Za-z0-9])(/[A-Za-z0-9_./+-]+\.(?:py|sh|pl))(?=[\s;"\'}]|$)', text)))
    paths = sorted(set(re.findall(r'(?:^|\s|path=)(/[A-Za-z0-9_./+-]+)(?=[\s;]|$)', text)))
    return {'management_commands': managed, 'systemd_service_targets': targets, 'script_paths': scripts,
            'executable_names': sorted({Path(item).name for item in paths}),
            'backgammon_reference': bool(APP.search(text)), 'raw_command_omitted': True}


def file_entries(directory, diagnostics):
    _, value = execute(['sudo', 'find', directory, '-maxdepth', '1', '(', '-type', 'f', '-o', '-type', 'l', ')',
                        '-print'], diagnostics, 'files:' + directory)
    return sorted(item for item in value.splitlines() if item.startswith(directory + '/'))


def cron_rows(text, source, system=False, anacron=False):
    entries, variables, unparsed = [], set(), 0
    for number, original in enumerate(text.splitlines(), 1):
        line = original.strip()
        enabled = not line.startswith('#')
        line = line.lstrip('#').strip()
        if not line:
            continue
        if re.match(r'^[A-Za-z_][A-Za-z0-9_]*\s*=', line):
            variables.add(line.split('=', 1)[0].strip())
            continue
        fields = line.split()
        width = None
        if anacron and len(fields) >= 4 and (fields[0].isdigit() or fields[0].startswith('@')) and fields[1].isdigit():
            width = 3
        elif fields[0].startswith('@') and fields[0] in ('@reboot', '@yearly', '@annually', '@monthly', '@weekly', '@daily', '@midnight', '@hourly'):
            width = 1
        elif len(fields) >= 6 and all(re.fullmatch(r'[0-9*/,-]+', field) for field in fields[:3]) and all(
                re.fullmatch(r'[A-Za-z0-9*/,-]+', field) for field in fields[3:5]):
            width = 5
        if width is None:
            unparsed += int(enabled)
            continue
        offset = width + int(system and not anacron)
        if len(fields) <= offset:
            unparsed += int(enabled)
            continue
        if system and not anacron and not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_.-]*\$?', fields[width]):
            unparsed += int(enabled)
            continue
        row = {'source': source, 'line': number, 'enabled_line': enabled,
               'schedule': ' '.join(fields[:width]), 'command': command_summary(' '.join(fields[offset:]))}
        if system and not anacron:
            row['run_as'] = fields[width]
        entries.append(row)
    return {'source': source, 'entries': entries, 'environment_variable_names': sorted(variables),
            'unparsed_active_lines': unparsed}


def show_units(names, diagnostics, prefix=None):
    result = {}
    prefix = prefix or ['systemctl']

    def add_output(output):
        for block in output.split('\n\n'):
            values = {key: value for key, value in
                      (line.split('=', 1) for line in block.splitlines() if '=' in line)
                      if key in PROPERTIES}
            identifier = values.get('Id')
            if identifier:
                values['ExecStartSummary'] = command_summary(values.pop('ExecStart', ''))
                result[identifier] = values

    for offset in range(0, len(names), 64):
        _, output = execute([*prefix, 'show', '--no-pager', '--property=' + ','.join(PROPERTIES),
                             '--', *names[offset:offset + 64]], [], 'systemd:show-batch')
        add_output(output)
    observed = set(result)
    for values in result.values():
        observed.update(values.get('Names', '').split())
    for name in sorted(set(names) - observed):
        # Template definitions have no individual runtime state until instantiated.
        if '@.' in name:
            continue
        _, output = execute([*prefix, 'show', '--no-pager', '--property=' + ','.join(PROPERTIES),
                             '--', name], diagnostics, 'systemd:show:' + name)
        add_output(output)
    return result


def complete_systemd(path):
    """Reuse existing cron evidence; refresh only system-level unit details."""
    if not path.is_file() or path.is_symlink():
        raise ValueError('Expected the existing audit JSON file')
    report = json.loads(path.read_text(encoding='utf-8'))
    if report.get('read_only') is not True or not isinstance(report.get('cron_sources'), list):
        raise ValueError('Input is not a service/schedule audit')
    diagnostics = []
    code, output = execute(['systemctl', 'list-unit-files', '--no-legend', '--no-pager'], diagnostics, 'systemd:installed')
    if code:
        raise RuntimeError('Cannot enumerate installed systemd units')
    installed = [line.split()[:3] for line in output.splitlines() if len(line.split()) >= 2]
    code, output = execute(['systemctl', 'list-units', '--all', '--plain', '--no-legend', '--no-pager'], diagnostics, 'systemd:loaded')
    if code:
        raise RuntimeError('Cannot enumerate loaded systemd units')
    loaded = [line.split()[:4] for line in output.splitlines() if len(line.split()) >= 4]
    names = sorted({row[0] for row in installed + loaded if UNIT.fullmatch(row[0])})
    print('Completing systemd details; existing cron and journal evidence retained...', flush=True)
    report['installed_unit_files'], report['loaded_units'] = installed, loaded
    report['unit_details'] = show_units(names, diagnostics)
    observed = set(report['unit_details'])
    for values in report['unit_details'].values():
        observed.update(values.get('Names', '').split())
    report['systemd_missing_runtime_details'] = [name for name in names if '@.' not in name and name not in observed]
    _, report['timer_table'] = execute(['systemctl', 'list-timers', '--all', '--no-pager'], diagnostics, 'systemd:timers')
    report['backgammon_units'] = {key: value for key, value in report['unit_details'].items() if APP.search(key)}
    report['systemd_completed_at_utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    report['systemd_completion_diagnostics'] = diagnostics
    return report


def collect():
    diagnostics = []
    report = {'collected_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'read_only': True, 'diagnostics': diagnostics,
              'limitations': ['An installed/disabled unit can still be started by cron or another unit.',
                              'inactive alone does not prove retirement; inspect oneshot results and scheduling.',
                              'Journal summaries omit raw application errors and shell arguments.',
                              'Schedules and successful process exits do not alone prove database task completion.']}
    print('Reading installed and loaded systemd units...', flush=True)
    code, output = execute(['systemctl', 'list-unit-files', '--no-legend', '--no-pager'], diagnostics, 'systemd:installed')
    if code:
        raise RuntimeError('Cannot enumerate installed systemd units')
    installed = [line.split()[:3] for line in output.splitlines() if len(line.split()) >= 2]
    _, output = execute(['systemctl', 'list-units', '--all', '--plain', '--no-legend', '--no-pager'], diagnostics, 'systemd:loaded')
    loaded = [line.split()[:4] for line in output.splitlines() if len(line.split()) >= 4]
    names = sorted({row[0] for row in installed + loaded if UNIT.fullmatch(row[0])})
    report['installed_unit_files'] = installed
    report['loaded_units'] = loaded
    report['unit_details'] = show_units(names, diagnostics)
    observed = set(report['unit_details'])
    for values in report['unit_details'].values():
        observed.update(values.get('Names', '').split())
    report['systemd_missing_runtime_details'] = [name for name in names if '@.' not in name and name not in observed]
    _, report['timer_table'] = execute(['systemctl', 'list-timers', '--all', '--no-pager'], diagnostics, 'systemd:timers')

    print('Reading system and user cron schedules...', flush=True)
    report['cron_sources'] = []
    for file in ['/etc/crontab', '/etc/anacrontab', *file_entries('/etc/cron.d', diagnostics)]:
        code, text = execute(['sudo', 'cat', '--', file], diagnostics, 'cron:' + file)
        if code == 0:
            parsed = cron_rows(text, file, system=True, anacron=file == '/etc/anacrontab')
            if file.startswith('/etc/cron.d/'):
                parsed['filename_accepted_by_cron'] = bool(re.fullmatch(r'[A-Za-z0-9_-]+', Path(file).name))
            report['cron_sources'].append(parsed)
    # Query every local account's crontab, including accounts without a login shell.
    _, accounts = execute(['getent', 'passwd'], diagnostics, 'accounts')
    users = []
    for line in accounts.splitlines():
        fields = line.split(':')
        if len(fields) == 7 and fields[2].isdigit():
            users.append({'name': fields[0], 'uid': fields[2], 'home': fields[5]})
    users_without_crontab = []
    for user in users:
        # A missing crontab is expected; don't add it to failure diagnostics.
        scratch = []
        code, text = execute(['sudo', 'crontab', '-u', user['name'], '-l'], scratch, 'user-cron')
        if code == 0:
            parsed = cron_rows(text, 'user:' + user['name'])
            parsed['run_as'] = user['name']
            report['cron_sources'].append(parsed)
        else:
            users_without_crontab.append(user['name'])
    report['accounts_without_readable_crontab'] = users_without_crontab
    report['periodic_scripts'] = []
    for directory in ('/etc/cron.hourly', '/etc/cron.daily', '/etc/cron.weekly', '/etc/cron.monthly'):
        _, selected = execute(['sudo', 'run-parts', '--test', directory], diagnostics, 'run-parts:test:' + directory)
        eligible = set(selected.splitlines())
        for file in file_entries(directory, diagnostics):
            report['periodic_scripts'].append({'path': file, 'eligible_for_run_parts': file in eligible})

    print('Reading user systemd managers and scheduler references...', flush=True)
    report['user_systemd'] = []
    for user in users:
        runtime = '/run/user/' + user['uid']
        # Only inspect existing user managers; never start a login session.
        code, _ = execute(['sudo', 'test', '-S', runtime + '/bus'], [], 'user-bus')
        if code:
            continue
        prefix = ['sudo', '-u', user['name'], 'env', 'XDG_RUNTIME_DIR=' + runtime,
                  'DBUS_SESSION_BUS_ADDRESS=unix:path=' + runtime + '/bus', 'systemctl', '--user']
        _, output = execute([*prefix, 'list-unit-files', '--no-legend', '--no-pager'], diagnostics, 'user:installed:' + user['name'])
        rows = [line.split()[:3] for line in output.splitlines() if len(line.split()) >= 2]
        _, output = execute([*prefix, 'list-units', '--all', '--plain', '--no-legend', '--no-pager'], diagnostics, 'user:loaded:' + user['name'])
        live = [line.split()[:4] for line in output.splitlines() if len(line.split()) >= 4]
        user_names = sorted({row[0] for row in rows + live if UNIT.fullmatch(row[0])})
        report['user_systemd'].append({'user': user['name'], 'installed': rows, 'loaded': live,
                                     'details': show_units(user_names, diagnostics, prefix)})
    # Include user unit files even if their manager is currently stopped.
    report['user_unit_file_paths'] = []
    roots = ['/etc/systemd/user', '/usr/lib/systemd/user', '/usr/local/lib/systemd/user',
             *(user['home'] + '/.config/systemd/user' for user in users if user['home'].startswith(('/home/', '/root')))]
    for directory in sorted(set(roots)):
        code, _ = execute(['sudo', 'test', '-d', directory], [], 'user-unit-directory')
        if code == 0:
            report['user_unit_file_paths'].extend(file_entries(directory, diagnostics))

    scripts = {item['path'] for item in report['periodic_scripts']}
    for source in report['cron_sources']:
        for row in source['entries']:
            scripts.update(row['command']['script_paths'])
    for row in report['unit_details'].values():
        scripts.update(row['ExecStartSummary']['script_paths'])
    report['script_references'] = {}
    for file in sorted(scripts):
        code, content = execute(['sudo', 'head', '-c', '262144', '--', file], [], 'script-read')
        if code == 0:
            report['script_references'][file] = command_summary(content)

    print('Reading recent Backgammon/cron execution evidence...', flush=True)
    units = sorted({name for name in names if APP.search(name)} | {'cron.service', 'crond.service'})
    arguments = ['sudo', 'journalctl', '--since', '2 hours ago', '--no-pager', '-n', '1500', '-o', 'json']
    for name in units:
        arguments.extend(['-u', name])
    _, output = execute(arguments, diagnostics, 'journal:scheduler-and-applications')
    events = []
    for line in output.splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        message = row.get('MESSAGE', '')
        if not isinstance(message, str):
            continue
        lower = message.lower()
        summary = command_summary(message)
        if not any(word in lower for word in ('starting', 'started', 'finished', 'succeeded', 'deactivated', 'failed', 'error', 'cmd (')):
            continue
        event = {'unit': row.get('UNIT') or row.get('_SYSTEMD_UNIT', ''), 'timestamp_us': row.get('__REALTIME_TIMESTAMP'),
                 'priority': row.get('PRIORITY'), 'event': 'scheduler_dispatch' if 'cmd (' in lower else
                 'failure_reported' if 'failed' in lower or 'error' in lower else
                 'completed' if 'finished' in lower or 'succeeded' in lower or 'deactivated' in lower else 'started'}
        if summary['backgammon_reference'] or summary['management_commands'] or summary['systemd_service_targets']:
            event['references'] = summary
        events.append(event)
    report['recent_execution_events'] = events
    _, output = execute(['ps', '-eo', 'user=,pid=,ppid=,etimes=,args='], diagnostics, 'processes')
    report['application_processes'] = []
    for line in output.splitlines():
        fields = line.split(None, 4)
        if len(fields) == 5 and (APP.search(fields[4]) or any(item in fields[4] for item in MANAGEMENT)):
            report['application_processes'].append({'user': fields[0], 'pid': fields[1], 'parent_pid': fields[2],
                'elapsed_seconds': fields[3], 'command': command_summary(fields[4])})
    report['backgammon_units'] = {key: value for key, value in report['unit_details'].items() if APP.search(key)}
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--complete-systemd-from', type=Path)
    args = parser.parse_args()
    if args.output.exists() or args.output.is_symlink():
        raise ValueError('Choose a new output file; existing files are preserved')
    report = complete_systemd(args.complete_systemd_from) if args.complete_systemd_from else collect()
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
        json.dump(report, stream, indent=2)
        stream.write('\n')
    print('SANITIZED SERVICE/SCHEDULE AUDIT: ' + str(args.output))
    print(json.dumps({'installed_units': len(report['installed_unit_files']),
                      'inspected_services_timers_sockets_paths': len(report['unit_details']),
                      'cron_sources': len(report['cron_sources']),
                      'recent_execution_events': len(report['recent_execution_events']),
                      'missing_runtime_details': report.get('systemd_missing_runtime_details'),
                      'backgammon_units': {name: {key: values.get(key) for key in
                          ('Type', 'ActiveState', 'UnitFileState', 'Result', 'ExecMainExitTimestamp')}
                          for name, values in report['backgammon_units'].items()}}, indent=2))


if __name__ == '__main__':
    main()
