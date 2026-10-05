"""Two real HTTP/ASGI servers, two accounts, real dice, legal play, restart, outage and restore.

Run with Python + the game backend's installed dependencies. No live database is touched.
The dice service must already be running (default http://127.0.0.1:8400).
"""
import argparse
import asyncio
import importlib.util
import json
import os
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
GAME = ROOT / 'Backgammon Game' / 'backend'
TOURNAMENTS = ROOT / 'backgammon-tournaments-backend' / 'tournaments'
sys.path.insert(0, str(GAME / '.venv' / 'Lib' / 'site-packages'))
import httpx
from autobahn.asyncio.websocket import WebSocketClientFactory, WebSocketClientProtocol
from backup_restore import backup_and_restore

spec = importlib.util.spec_from_file_location('acceptance_engine', GAME / 'game' / 'engine.py')
engine_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine_module)
Engine = engine_module.BackgammonEngine


class Peer(WebSocketClientProtocol):
    def onOpen(self):
        self.factory.ready.set_result(self)
        self.queue = asyncio.Queue()

    def onMessage(self, payload, isBinary):
        self.queue.put_nowait(json.loads(payload))

    async def next(self, predicate, timeout=20):
        async def read():
            while True:
                message = await self.queue.get()
                if message['type'] == 'error':
                    raise AssertionError(message)
                if predicate(message):
                    return message
        return await asyncio.wait_for(read(), timeout)

    def intent(self, payload):
        self.sendMessage(json.dumps({'type': 'state_update', 'payload': payload}).encode())


async def connect(room, token, port):
    factory = WebSocketClientFactory(f'ws://127.0.0.1:{port}/ws/game/{room}/?token={token}')
    factory.protocol = Peer
    factory.ready = asyncio.get_running_loop().create_future()
    await asyncio.get_running_loop().create_connection(factory, '127.0.0.1', port)
    peer = await asyncio.wait_for(factory.ready, 10)
    initial = await peer.next(lambda m: m['type'] == 'state_update' and m.get('initial'))
    return peer, initial


class Stack:
    def __init__(self, output, dice_url):
        self.output = output
        self.processes = {}
        self.logs = []
        self.envs = {}
        self.dirs = {'game': GAME, 'tournaments': TOURNAMENTS}
        self.ports = {'game': 8410, 'tournaments': 8411}
        for service in self.dirs:
            database = output / f'{service}.sqlite3'
            base = 'backgammon_project.settings' if service == 'game' else 'tournaments.settings.development'
            shared = f'''
from {base} import *
DEBUG = True
SECRET_KEY = 'acceptance-only-django-secret-do-not-deploy'
ALLOWED_HOSTS = ['127.0.0.1', 'localhost', 'testserver']
DATABASES = {{'default': {{'ENGINE': 'django.db.backends.sqlite3', 'NAME': {str(database)!r}, 'OPTIONS': {{'timeout': 30}}}}}}
CHANNEL_LAYERS = {{'default': {{'BACKEND': 'channels.layers.InMemoryChannelLayer'}}}}
GAMELINK_ENABLED = True
GAMELINK_BACKGAMMON_URL = 'http://127.0.0.1:8410'
GAMELINK_TOURNAMENTS_URL = 'http://127.0.0.1:8411'
GAMELINK_FRONTEND_URL = 'http://127.0.0.1:8510/backgammon'
GAMELINK_TOURNAMENTS_FRONTEND_URL = 'http://127.0.0.1:8511'
ACCOUNT_FRONTEND_URL = 'http://127.0.0.1:8511/tournaments'
GAMELINK_TICKET_SECRET = 'acceptance-ticket-secret-01234567890123456789'
GAMELINK_TICKET_SECRETS = [GAMELINK_TICKET_SECRET]
GAMELINK_RESULT_SECRET = 'acceptance-result-secret-01234567890123456789'
GAMELINK_RESULT_SECRETS = [GAMELINK_RESULT_SECRET]
EMAIL_BACKEND = 'django.core.mail.backends.filebased.EmailBackend'
EMAIL_FILE_PATH = {str(output / 'mail')!r}
CSRF_TRUSTED_ORIGINS = ['http://127.0.0.1:8511', 'http://127.0.0.1:8411']
LOGGING = {{'version': 1, 'disable_existing_loggers': False, 'handlers': {{'console': {{'class': 'logging.StreamHandler'}}}}, 'root': {{'handlers': ['console'], 'level': 'WARNING'}}}}
'''
            (output / f'acceptance_{service}_settings.py').write_text(shared, encoding='utf-8')
            packages = GAME / '.venv' / 'Lib' / 'site-packages' if service == 'game' else TOURNAMENTS.parent / 'venv' / 'Lib' / 'site-packages'
            self.envs[service] = {**os.environ, 'PYTHONPATH': os.pathsep.join([str(output), str(packages), str(self.dirs[service])]),
                'DJANGO_SETTINGS_MODULE': f'acceptance_{service}_settings', 'DICE_SERVICE_URL': dice_url,
                'SECRET_KEY': 'acceptance-only-django-secret-do-not-deploy', 'CHANNEL_LAYER_BACKEND': 'memory'}

    def command(self, service, *args):
        result = subprocess.run([sys.executable, 'manage.py', *args], cwd=self.dirs[service],
            env=self.envs[service], capture_output=True, text=True, timeout=90)
        if result.returncode:
            raise RuntimeError(f'{service} command failed: {result.stderr[-3000:]}')
        return result.stdout

    def start(self, service):
        module = 'backgammon_project.asgi:application' if service == 'game' else 'tournaments.asgi:application'
        log = (self.output / f'{service}.log').open('a', encoding='utf-8')
        self.logs.append(log)
        self.processes[service] = subprocess.Popen([sys.executable, '-m', 'daphne', '-b', '127.0.0.1', '-p', str(self.ports[service]), module],
            cwd=self.dirs[service], env=self.envs[service], stdout=log, stderr=log,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            try:
                response = httpx.get(f'http://127.0.0.1:{self.ports[service]}/api/health/', timeout=1)
                if response.status_code in (200, 503):
                    return
            except httpx.HTTPError:
                pass
            time.sleep(.2)
        raise RuntimeError(f'{service} did not start; inspect {self.output / (service + ".log")}')

    def stop(self, service):
        process = self.processes.pop(service, None)
        if process:
            process.terminate()
            process.wait(timeout=10)

    def close(self):
        for service in list(self.processes):
            self.stop(service)
        for log in self.logs:
            log.close()


def api(client, path, data=None, expected=200):
    client.get('/api/csrf/')
    response = client.post(path, json=data or {}, headers={'X-CSRFToken': client.cookies['csrftoken']})
    assert response.status_code == expected, (path, response.status_code, response.text[:1000])
    return response


def mail_link(output, email):
    from email import policy
    from email.parser import Parser
    for path in sorted((output / 'mail').glob('*'), key=lambda p: p.stat().st_mtime, reverse=True):
        message = Parser(policy=policy.default).parsestr(path.read_text(encoding='utf-8'))
        if email in message['To']:
            content = message.get_content()
            query = content.split('#', 1)[1].splitlines()[0]
            return {key: value[0] for key, value in parse_qs(query).items()}
    raise AssertionError('Verification email missing')


def read_row(output, database, sql):
    with sqlite3.connect((output / f'{database}.sqlite3').as_uri() + '?mode=ro', uri=True) as db:
        return db.execute(sql).fetchone()


async def journey(stack):
    output = stack.output
    base = 'http://127.0.0.1:8411'
    password = 'Acceptance-Player-Secret-937!'
    clients = [httpx.Client(base_url=base, timeout=15) for _ in range(2)]
    admin = httpx.Client(base_url=base, timeout=15)
    api(admin, '/api/auth/login', {'username': 'Operator', 'password': password})
    users = []
    for index, client in enumerate(clients):
        email = f'player{index}@example.test'
        api(client, '/api/auth/signup', {'username': f'Player{index}', 'email': email,
            'password1': password, 'password2': password}, 201)
        api(client, '/api/auth/verify/confirm', mail_link(output, email))
        user = api(client, '/api/auth/login', {'username': f'Player{index}', 'password': password}).json()
        users.append(user['id'])
        assert client.get('/api/admin/users').status_code == 403
    print('PASS two verified accounts, authenticated website sessions, player/admin boundary', flush=True)
    tournament = api(admin, '/api/admin/tournaments', {'name': 'Product acceptance', 'template': 'knockout',
        'min_players': 2, 'max_players': 2, 'open_registration': True, 'target_points': 1, 'time_control': 'none'}, 201).json()['id']
    for client in clients:
        api(client, f'/api/tournaments/{tournament}/join')
    api(admin, f'/api/admin/tournaments/{tournament}/start')
    entries = []
    for client in clients:
        response = api(client, f'/t/tournament/{tournament}/play', expected=302)
        handoff = httpx.get(response.headers['location'], follow_redirects=False)
        assert handoff.status_code == 302, handoff.text
        entries.append({key: values[0] for key, values in parse_qs(urlsplit(handoff.headers['location']).fragment).items()})
    assert entries[0]['room'] == entries[1]['room']
    assert {entry['color'] for entry in entries} == {'white', 'black'}
    room = entries[0]['room']
    peers = {}
    state = None
    for entry in entries:
        peer, initial = await connect(room, entry['access'], 8410)
        assert initial['playerColor'] == entry['color']
        peers[entry['color']] = peer
        state = initial['payload']
    print('PASS signed tickets put both identities in one room with opposite seats', flush=True)
    restart_checked = False
    outage = False
    moves = 0
    actions = 0
    winner = None
    while actions < 2500:
        phase, color = state['phase'], state['turn']
        if state.get('winner'):
            winner = state['winner']
            break
        if phase == 'opening_result':
            message = await peers[color].next(lambda m: m['type'] == 'state_update' and m['payload'].get('phase') == 'moving')
            state = message['payload']
            continue
        if phase in ('opening_roll', 'rolling'):
            intent = {'action': 'roll'}
        elif phase == 'moving':
            choices = Engine(state).all_legal_moves(color)
            if choices:
                def priority(move):
                    distance = 25 if move['from'] == 'bar' else (move['from'] + 1 if color == 'white' else 24 - move['from'])
                    return (move['to'] == 'off', distance, move['die'])
                move = max(choices, key=priority)
                intent = {'action': 'move', 'from': move['from'], 'to': move['to']}
                moves += 1
            else:
                intent = {'action': 'end_turn'}
        else:
            raise AssertionError(f'Unexpected phase: {phase}')
        if moves >= 6 and not restart_checked:
            before = {key: state.get(key) for key in ['points', 'bar', 'home', 'dice', 'remaining', 'turn', 'version']}
            for peer in peers.values():
                peer.transport.abort()  # Abrupt network loss, no leave/resign message.
            await asyncio.sleep(.2)
            stack.stop('game')
            stack.start('game')
            for entry in entries:
                peer, initial = await connect(room, entry['access'], 8410)
                assert initial['playerColor'] == entry['color']
                assert {key: initial['payload'].get(key) for key in before} == before
                peers[entry['color']] = peer
                state = initial['payload']
            # Re-entry through the website must map to the same user and room after restart.
            again = api(clients[0], f'/t/tournament/{tournament}/play', expected=302)
            handoff = httpx.get(again.headers['location'])
            assert parse_qs(urlsplit(handoff.headers['location']).fragment)['room'][0] == room
            assert read_row(output, 'game', 'SELECT COUNT(*) FROM game_linkedidentity')[0] == 2
            restart_checked = True
            print('PASS abrupt disconnect + game server restart restores board, dice, version, seats and identities', flush=True)
        if moves >= 10 and not outage:
            stack.stop('tournaments')
            outage = True
        old_version = state.get('version', 0)
        peers[color].intent(intent)
        message = await peers[color].next(lambda m: (m['type'] == 'state_update' and m['payload'].get('version', 0) > old_version)
                                         or m['type'] == 'game_ended')
        if message['type'] == 'game_ended':
            winner = message['payload'].get('winner')
            break
        state = message['payload']
        actions += 1
        if moves and moves % 50 == 0:
            print(f'Legal play: {moves} moves', flush=True)
    assert winner and restart_checked and outage
    # Closing both clients cannot erase the completed result or its queued delivery.
    for peer in peers.values():
        peer.transport.abort()
    await asyncio.sleep(.5)
    assert read_row(output, 'game', 'SELECT COUNT(*) FROM game_match')[0] == 1
    assert read_row(output, 'game', 'SELECT result_status FROM game_tournamentlink')[0] == 'queued'
    print(f'PASS complete legal game ({moves} moves), one saved match; result survives tournament outage', flush=True)
    stack.stop('game')
    # Both writers stopped: coherent backup of identities, match state and the pending outbox.
    manifest = backup_and_restore({name: output / f'{name}.sqlite3' for name in ['game', 'tournaments']}, output / 'backup')
    for name in ['game', 'tournaments']:
        recovered = output / 'backup' / 'restore-drill' / f'{name}.sqlite3'
        config = output / f'acceptance_{name}_settings.py'
        config.write_text(config.read_text(encoding='utf-8') + f'\nDATABASES["default"]["NAME"] = {str(recovered)!r}\n', encoding='utf-8')
    stack.start('tournaments')
    stack.start('game')
    # Do not edit task run_at: run the real scheduler until its backoff naturally expires.
    deadline = time.monotonic() + 65
    while time.monotonic() < deadline:
        stack.command('game', 'run_tasks')
        restored = output / 'backup' / 'restore-drill'
        if read_row(restored, 'game', 'SELECT result_status FROM game_tournamentlink')[0] == 'delivered':
            break
        await asyncio.sleep(2)
    assert read_row(restored, 'game', 'SELECT result_status FROM game_tournamentlink')[0] == 'delivered'
    assert read_row(restored, 'game', 'SELECT COUNT(*) FROM game_match')[0] == 1
    result_before = read_row(restored, 'tournaments', 'SELECT score1, score2 FROM tournaments_fixture')
    assert max(result_before) >= 1
    # Real signed duplicate callback: receiver must acknowledge without rescoring.
    stack.command('game', 'shell', '-c', "import json, uuid; from django.utils import timezone; from game.link.models import TournamentLink; from game.link.signing import sign_result_body; import httpx; link=TournamentLink.objects.get(); raw=json.dumps(link.result_body,sort_keys=True,separators=(',',':')).encode(); ts=str(int(timezone.now().timestamp())); nonce=uuid.uuid4().hex; r=httpx.post('http://127.0.0.1:8411/api/gamelink/result/',content=raw,headers={'Content-Type':'application/json','X-Gamelink-Timestamp':ts,'X-Gamelink-Nonce':nonce,'X-Gamelink-Issuer':'backgammon','X-Gamelink-Signature':sign_result_body(raw,ts,nonce)}); assert r.status_code==200, r.status_code")
    assert read_row(restored, 'tournaments', 'SELECT score1, score2 FROM tournaments_fixture') == result_before
    for index, client in enumerate(clients):
        assert client.get('/api/auth/me').json()['id'] == users[index]
        detail = client.get(f'/api/tournaments/{tournament}').json()
        assert detail['state'] == 'finished', detail
    stack.command('game', 'check_delivery_health')
    report = {'passed': True, 'players': 2, 'legal_moves': moves, 'winner': winner,
              'score': list(result_before), 'network_disconnect': True, 'game_server_restart': True,
              'tournament_outage': True, 'duplicate_callback': True, 'restored_pending_delivery': True,
              'manual_data_repairs': 0, 'databases_verified': list(manifest['databases']),
              'scope': 'HTTP/ASGI acceptance; mobile rendering tested separately'}
    (output / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2), flush=True)
    for client in [*clients, admin]:
        client.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--dice-url', default='http://127.0.0.1:8400')
    args = parser.parse_args()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    assert httpx.get(args.dice_url + '/health').status_code == 200, 'Real dice service required'
    stack = Stack(output, args.dice_url)
    try:
        for service in ['game', 'tournaments']:
            stack.command(service, 'migrate', '--noinput')
        stack.command('tournaments', 'shell', '-c', "from django.contrib.auth.models import User; User.objects.create_superuser('Operator', password='Acceptance-Player-Secret-937!')")
        for service in ['game', 'tournaments']:
            stack.start(service)
        asyncio.run(journey(stack))
    finally:
        stack.close()


if __name__ == '__main__':
    main()
