"""Read-only, sanitized inventory of production and the browser Docker rehearsal."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import urllib.error
import urllib.request

PROJECT = 'backgammon-rehearsal-20261005t184922z'
EXPECTED_SERVICES = ('postgres', 'redis', 'dice', 'game-api', 'game-tasks', 'tournaments-api',
                     'tournaments-tasks', 'game-frontend', 'tournaments-frontend', 'admin-frontend',
                     'analysis-api', 'analysis-worker', 'push-worker')
SAFE_ENV = {'DB_HOST', 'DB_NAME', 'DB_USER', 'REDIS_URL', 'DJANGO_SETTINGS_MODULE',
            'ANALYSIS_SERVICE_URL', 'AI_SERVICE_URL', 'EMAIL_BACKEND', 'EMAIL_HOST', 'EMAIL_PORT',
            'TRANZILA_ENABLED', 'TRANZILA_PURCHASES_ENABLED', 'TRANZILA_ENVIRONMENT',
            'ACCOUNT_EMAIL_ACTIONS_ENABLED', 'DEBUG'}
PRESENCE = {'WEB_PUSH_PUBLIC_KEY', 'WEB_PUSH_PRIVATE_KEY', 'WEB_PUSH_SUBJECT', 'ANALYSIS_API_TOKEN',
            'TRANZILA_TERMINAL', 'TRANZILA_APP_KEY', 'TRANZILA_APP_SECRET', 'EMAIL_HOST_USER',
            'EMAIL_HOST_PASSWORD', 'GOOGLE_CLIENT_ID'}


def command(arguments):
    result = subprocess.run([str(item) for item in arguments], text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return result.returncode, result.stdout.strip()


def read_json(file):
    if file.is_file() and not file.is_symlink():
        return json.loads(file.read_text())
    return None


def safe_environment(values):
    result = {key: value for key, value in values.items() if key in SAFE_ENV and isinstance(value, (str, int, bool))}
    # A Redis URI may contain authentication; retain only the selected logical DB.
    if 'REDIS_URL' in result:
        match = re.fullmatch(r'redis://redis:6379/(\d+)', result['REDIS_URL'])
        result['REDIS_URL'] = result['REDIS_URL'] if match else '[custom endpoint omitted]'
    for key in ('EMAIL_HOST', 'ANALYSIS_SERVICE_URL', 'AI_SERVICE_URL', 'DB_HOST'):
        if key in result and ('@' in str(result[key]) or '?' in str(result[key])):
            result[key] = '[custom endpoint omitted]'
    result['configured'] = {key: bool(values.get(key)) for key in sorted(PRESENCE)}
    return result


def collect(args):
    from rehearsal_context import rehearsal_project
    state = args.rehearsal / 'browser-e2e-r2'
    session = read_json(state / 'session.json')
    identity = session['identity'] if session else None
    project = rehearsal_project(identity) if identity else PROJECT
    report = {'collected_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'project_dir': str(args.project), 'rehearsal_dir': str(args.rehearsal),
              'target': identity, 'findings': [], 'read_only': True}
    memory = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
    report['host_resources'] = {'cpus': os.cpu_count(), 'memory_total': memory.get('MemTotal', '').strip(),
                              'memory_available': memory.get('MemAvailable', '').strip(),
                              'disk_free_bytes': shutil.disk_usage(args.project).free}
    code, output = command(['sudo', 'docker', 'ps', '-aq'])
    if code:
        raise RuntimeError('Cannot read Docker inventory; run sudo -v first')
    containers = []
    for identifier in output.splitlines():
        code, value = command(['sudo', 'docker', 'inspect', identifier, '--format',
            '{"name":{{json .Name}},"image":{{json .Image}},"status":{{json .State.Status}},'
            '"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},'
            '"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
            '"service":{{json (index .Config.Labels "com.docker.compose.service")}},'
            '"restart_count":{{json .RestartCount}},"ports":{{json .NetworkSettings.Ports}},'
            '"networks":{{json .NetworkSettings.Networks}}}'])
        if code:
            continue
        row = json.loads(value)
        row['networks'] = sorted(row['networks'])
        row['name'] = row['name'].lstrip('/')
        containers.append(row)
    report['containers'] = containers
    code, output = command(['sudo', 'docker', 'stats', '--no-stream', '--format',
                            '{"name":{{json .Name}},"cpu":{{json .CPUPerc}},"memory":{{json .MemUsage}},"pids":{{json .PIDs}}}'])
    report['container_resources'] = [json.loads(line) for line in output.splitlines()] if code == 0 else []
    observed = {item['service']: item for item in containers if item['project'] == project}
    report['missing_rehearsal_services'] = [name for name in EXPECTED_SERVICES
                                           if name not in observed or observed[name]['status'] != 'running']
    if report['missing_rehearsal_services']:
        report['findings'].append('Application services are missing or stopped in the browser rehearsal')
    report['image_alignment'] = {}
    if identity:
        image_kinds = {name: name for name in ('dice', 'game-frontend', 'tournaments-frontend', 'admin-frontend')}
        image_kinds.update({name: kind for kind, names in {
            'game': ('game-api', 'game-tasks'), 'tournaments': ('tournaments-api', 'tournaments-tasks', 'push-worker'),
            'analysis': ('analysis-api', 'analysis-worker')}.items() for name in names})
        for name, kind in image_kinds.items():
            actual = observed.get(name, {}).get('image')
            expected = identity['images'].get(kind)
            report['image_alignment'][name] = {'expected': expected, 'actual': actual,
                                               'matches': actual == expected if actual else None}
            if actual and actual != expected:
                report['findings'].append('Image mismatch: ' + name)
        for file in ('identity.json', 'server-client.json'):
            value = read_json(state / file)
            actual = value.get('identity') if file == 'server-client.json' and value else value
            if actual != identity:
                report['findings'].append('Prepared identity mismatch: ' + file)
        try:
            with urllib.request.urlopen(identity['origin'] + '/__e2e__/identity', timeout=10) as response:
                live = json.load(response)
            report['listener_identity_matches'] = live == identity
        except (urllib.error.URLError, ValueError, OSError):
            report['listener_identity_matches'] = False
        if not report['listener_identity_matches']:
            report['findings'].append('Test listener does not return the prepared identity')
        tools = Path(session['tools_dir'])
        digest = hashlib.sha256()
        for name in session['harness_files']:
            if Path(name).name != name or not (tools / name).is_file():
                report['findings'].append('Missing or unsafe pinned harness file')
                break
            digest.update((name + '\0').encode())
            digest.update((tools / name).read_bytes())
        report['harness_matches'] = digest.hexdigest() == identity.get('harness_sha256')
        report['sources'] = []
        for source in identity['sources']:
            directory = args.project / source['path']
            head_code, head = command(['git', '-C', directory, 'rev-parse', 'HEAD'])
            dirty_code, dirty = command(['git', '-C', directory, 'status', '--porcelain'])
            report['sources'].append({'path': source['path'], 'expected_image_source': source['revision'],
                'deployment_checkout': head if not head_code else None,
                'checkout_dirty': bool(dirty) if not dirty_code else None,
                'checkout_matches_image_source': head == source['revision'] if not head_code else None})
        # The entry patch was built from a separate Git checkout; an old base checkout alone is not an image mismatch.
        report['source_note'] = 'Image IDs are authoritative for running containers; deployment base checkouts can precede the separately built entry patch.'
    report['rehearsal_runtime'] = {}
    for kind in ('game', 'tournaments', 'analysis'):
        values = read_json(state / (kind + '.json'))
        if values:
            report['rehearsal_runtime'][kind] = safe_environment(values)
    report['captured_production_configuration'] = {}
    code, lines = command(['sudo', 'cat', args.project / 'docker/production.env'])
    config_dir = None
    if code == 0:
        for line in lines.splitlines():
            if line.startswith('CONFIG_DIR='):
                config_dir = Path(line.split('=', 1)[1].strip('"\''))
    if config_dir and config_dir.is_absolute():
        for kind in ('game', 'tournaments', 'analysis'):
            code, value = command(['sudo', 'cat', config_dir / (kind + '.json')])
            if code == 0:
                report['captured_production_configuration'][kind] = safe_environment(json.loads(value))
    code, output = command(['sudo', 'systemctl', 'list-units', '--type=service', '--all', '--no-legend', '--no-pager'])
    report['systemd_services'] = [line.split()[:4] for line in output.splitlines()
                                  if re.search(r'backgammon|tournament|analysis|push|dice|daphne|gunicorn|alloy|loki|grafana|prometheus|nginx|redis', line, re.I)] if code == 0 else []
    report['systemd_context'] = {}
    for parts in report['systemd_services']:
        unit = next((item for item in parts if item.endswith('.service')), None)
        if not unit:
            continue
        code, value = command(['sudo', 'systemctl', 'show', unit, '--no-pager',
                              '--property=User,WorkingDirectory,MainPID,FragmentPath,EnvironmentFiles,ActiveState'])
        if code == 0:
            report['systemd_context'][unit] = dict(line.split('=', 1) for line in value.splitlines() if '=' in line)
            context = report['systemd_context'][unit]
            if context.get('MainPID', '0').isdigit() and int(context['MainPID']) > 0:
                code, process_env = command(['sudo', 'cat', '/proc/' + context['MainPID'] + '/environ'])
                if code == 0:
                    values = dict(item.split('=', 1) for item in process_env.split('\0') if '=' in item)
                    context['process_configuration'] = safe_environment(values)
            directory = Path(context.get('WorkingDirectory', '/'))
            if directory.is_absolute() and directory != Path('/'):
                for dotenv in (directory / '.env', directory.parent / '.env'):
                    code, contents = command(['sudo', 'cat', dotenv])
                    if code == 0:
                        values = {}
                        for line in contents.splitlines():
                            key, separator, value = line.strip().partition('=')
                            if separator and re.fullmatch(r'[A-Z_][A-Z_0-9]*', key):
                                values[key] = value.strip().strip('"\'')
                        context.setdefault('dotenv_configuration', {})[str(dotenv)] = safe_environment(values)
    code, output = command(['sudo', 'docker', 'exec', '--user', 'postgres', project + '-postgres-1',
        'psql', '-X', '-At', '-U', 'postgres', '-d', 'postgres', '-c',
        "SELECT COALESCE(json_agg(json_build_object('name', datname, 'owner', pg_get_userbyid(datdba), "
        "'size_bytes', pg_database_size(datname), 'session_marker', shobj_description(oid, 'pg_database'))), '[]'::json) "
        "FROM pg_database WHERE datname LIKE 'backgammon_%'"])
    report['postgres_databases'] = json.loads(output) if code == 0 else None
    report['images'] = {}
    for image in sorted({item['image'] for item in containers}):
        code, value = command(['sudo', 'docker', 'image', 'inspect', image, '--format',
            '{"source_revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}},'
            '"release":{{json (index .Config.Labels "io.backgammon.release")}},"created":{{json .Created}}}'])
        if code == 0:
            report['images'][image] = json.loads(value)
    code, nginx = command(['sudo', 'nginx', '-T'])
    # Never share raw nginx/systemd environments: keep routing directives only and remove URI credentials/query strings.
    routes = []
    if code == 0:
        for line in nginx.splitlines():
            stripped = line.strip()
            if stripped.startswith(('listen ', 'server_name ', 'location ', 'proxy_pass ', 'root ', 'alias ', 'gzip ')):
                stripped = re.sub(r'://[^/\s]+@', '://[redacted]@', stripped)
                stripped = re.sub(r'\?[^\s;]+', '?[omitted]', stripped)
                routes.append(stripped)
    report['nginx_routes'] = routes
    code, output = command(['sudo', 'ss', '-lntH'])
    report['listening_tcp'] = [line.split()[3] for line in output.splitlines() if len(line.split()) > 3] if code == 0 else []
    if 'TRANZILA_ENVIRONMENT' in report.get('captured_production_configuration', {}).get('tournaments', {}):
        report['payment_note'] = 'TRANZILA_ENVIRONMENT=test is a local label; provider-side test-terminal confirmation is required.'
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True, type=Path)
    parser.add_argument('--rehearsal', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    args.project, args.rehearsal = args.project.resolve(), args.rehearsal.resolve()
    from server_rehearsal import configure_target
    configure_target(args)
    if args.output.is_symlink() or args.output.exists():
        raise ValueError('Choose a new, nonsymlink output file')
    report = collect(args)
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(report, stream, indent=2)
        stream.write('\n')
    args.output.chmod(0o600)
    print('SANITIZED SERVER INVENTORY: ' + str(args.output))
    print(json.dumps({'missing_rehearsal_services': report['missing_rehearsal_services'],
                      'findings': report['findings'], 'listener_identity_matches': report.get('listener_identity_matches'),
                      'harness_matches': report.get('harness_matches')}, indent=2))


if __name__ == '__main__':
    main()
