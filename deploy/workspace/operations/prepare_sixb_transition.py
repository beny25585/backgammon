"""Prepare reviewable /6b/ routing/runtime files. Never apply them or contact a server."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import re

from release_pipeline import MANAGED_NGINX_INCLUDE, SERVICE_IMAGE, maintenance_config, own_locations, require


def proposed_routing(original, snippet):
    directive = 'include ' + MANAGED_NGINX_INCLUDE + ';'
    if re.search(r'(?m)^[ \t]*' + re.escape(directive) + r'[ \t]*$', original):
        require(original.count(directive) == 1, 'The managed include must occur once')
        return original
    selectors = set(re.findall(r'(?m)^location\s+([^\n{]+)\s*\{', snippet))
    selectors = {' '.join(selector.split()) for selector in selectors}
    selected = []
    found = []
    for start, end in own_locations(original):
        selector = ' '.join(original[start:end].split('{', 1)[0].split()[1:])
        if selector in selectors:
            selected.append((start, end))
            found.append(selector)
    require({'/backgammon/', '/tournaments/'} <= set(found),
            'Expected legacy frontend locations are missing; inspect the actual routing')
    require(len(found) == len(set(found)), 'Duplicate frontend locations need manual review')
    first = selected[0][0]
    for start, end in reversed(selected):
        original = original[:start] + (directive if start == first else '') + original[end:]
    return original


def proposed_runtime(original):
    candidate = copy.deepcopy(original)
    changes = []
    for service, definition in candidate['services'].items():
        kind = SERVICE_IMAGE.get(service)
        if kind not in ('game', 'tournaments'):
            continue
        key, old_path, new_path = (
            ('GAMELINK_FRONTEND_URL', '/backgammon', '/6b/backgammon') if kind == 'game'
            else ('ACCOUNT_FRONTEND_URL', '/tournaments', '/6b/tournaments'))
        environment = definition.get('environment', {})
        value = environment.get(key, '').rstrip('/')
        require(value.startswith(('http://', 'https://')), 'Missing frontend URL in ' + service)
        if value.endswith(new_path):
            continue
        require(value.endswith(old_path), 'Unexpected frontend path in ' + service)
        environment[key] = value[:-len(old_path)] + new_path
        changes.append({'service': service, 'key': key})
    # The proposal keeps image IDs, API origins, credentials and data mounts intact.
    return candidate, changes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--nginx-file', type=Path, required=True)
    parser.add_argument('--compose-file', type=Path, required=True,
                        help='Canonical JSON snapshot of the CURRENT production runtime')
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    original = args.nginx_file.read_text(encoding='utf-8')
    runtime = json.loads(args.compose_file.read_text(encoding='utf-8'))
    snippet = Path(__file__).resolve().parents[1] / 'docker/nginx.production.locations.conf'
    source = snippet.read_text(encoding='utf-8')
    final = proposed_routing(original, source)
    maintenance = maintenance_config(final, source)
    candidate, changes = proposed_runtime(runtime)
    args.output_dir.mkdir(parents=True, exist_ok=False)
    args.output_dir.chmod(0o700)
    files = {
        'nginx.original.conf': original,
        'nginx.6b.conf': final,
        'nginx.maintenance.conf': maintenance,
        'nginx.production.locations.conf': source,
        'compose.original.private.json': json.dumps(runtime, indent=2) + '\n',
        'compose.6b.private.json': json.dumps(candidate, indent=2) + '\n',
    }
    hashes = {}
    for name, contents in files.items():
        destination = args.output_dir / name
        destination.write_text(contents, encoding='utf-8')
        destination.chmod(0o600)
        hashes[name] = hashlib.sha256(contents.encode('utf-8')).hexdigest()
    plan = {'applied': False, 'managed_include': MANAGED_NGINX_INCLUDE,
            'runtime_changes': changes, 'sha256': hashes,
            'images_changed': False, 'requires_tested_new_images': True}
    plan_file = args.output_dir / 'plan.json'
    plan_file.write_text(json.dumps(plan, indent=2) + '\n', encoding='utf-8')
    plan_file.chmod(0o600)
    print('Preparation saved. No Nginx reload, Docker operation, database write or deployment performed.')
    print('The runtime proposal still contains the CURRENT images. Do not start it as a completed migration.')


if __name__ == '__main__':
    main()
