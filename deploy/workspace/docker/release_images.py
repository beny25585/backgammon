"""Allowlisted image identity report; never print container environments or secrets."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess

from verify_workspace import verify

IMAGE_SOURCES = {
    'game': 'Backgammon Game', 'dice': 'Backgammon Game',
    'game-frontend': 'Backgammon Game',
    'tournaments': 'backgammon-tournaments-backend',
    'admin-frontend': 'backgammon-tournaments-backend',
    'tournaments-frontend': 'backgammon-tournaments',
    'analysis': 'backgammon-analysis-service',
}


def inventory(sudo_docker=False):
    tag = verify()
    root = Path(__file__).resolve().parents[1]
    record = json.loads((root / '.workspace-release.json').read_text())
    revisions = {source['path']: source['revision'] for source in record['sources']}
    images = {}
    for service, source in IMAGE_SOURCES.items():
        name = f'backgammon-production-{service}:{tag}'
        # Docker's format selects only these fields, even before parsing.
        values = json.loads(subprocess.check_output([*(['sudo'] if sudo_docker else []),
            'docker', 'image', 'inspect', name, '--format',
            '{"id":{{json .Id}},"os":{{json .Os}},"architecture":{{json .Architecture}},'
            '"revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}},'
            '"release":{{json (index .Config.Labels "io.backgammon.release")}}}',
        ], text=True))
        if (values['revision'] != revisions[source] or values['release'] != tag
                or (values['os'], values['architecture']) != ('linux', 'amd64')):
            raise ValueError(f'Image identity differs from the release: {service}')
        images[service] = {'name': name, **values}
    return {'schema_version': 1, 'image_tag': tag,
            'infrastructure_revision': record['infrastructure_revision'],
            'created_at': datetime.now(timezone.utc).isoformat(),
            'sources': record['sources'], 'images': images}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--sudo-docker', action='store_true')
    args = parser.parse_args()
    report = inventory(args.sudo_docker)
    encoded = json.dumps(report, indent=2) + '\n'
    if args.output:
        # A new release must not silently replace an earlier image inventory.
        with args.output.open('x', encoding='utf-8', newline='\n') as stream:
            stream.write(encoded)
    print(encoded, end='')


if __name__ == '__main__':
    main()
