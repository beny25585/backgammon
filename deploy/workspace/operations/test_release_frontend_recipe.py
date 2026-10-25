"""Frontend dependency cache boundaries; no Docker or application execution."""
import json
from pathlib import Path
import unittest


RECIPE = Path(__file__).resolve().parents[1] / 'docker/frontend.Dockerfile'


class FrontendDependencyCacheTests(unittest.TestCase):
    def test_install_layer_only_depends_on_manifests_and_workspace_policy(self):
        instructions = [line.strip() for line in RECIPE.read_text(encoding='utf-8').splitlines()
                        if line.strip() and not line.lstrip().startswith('#')]
        install = next(index for index, line in enumerate(instructions)
                       if line.startswith('RUN ') and 'pnpm install ' in line)
        dependency_sources = []
        for instruction in instructions[:install]:
            if instruction.startswith('COPY '):
                copied = json.loads(instruction.removeprefix('COPY '))
                dependency_sources.extend(copied[:-1])
        self.assertEqual(set(dependency_sources), {
            '${APP_DIR}/package.json', '${APP_DIR}/pnpm-lock.yaml', '${APP_DIR}/pnpm-workspace.yaml',
        })
        application_copy = next(index for index, line in enumerate(instructions)
                                if line.startswith('COPY ') and json.loads(line[5:])[:-1] == ['${APP_DIR}/'])
        build = next(index for index, line in enumerate(instructions)
                     if line.startswith('RUN ') and 'pnpm run build' in line)
        self.assertLess(install, application_copy)
        self.assertLess(application_copy, build)
        self.assertIn('--frozen-lockfile', instructions[install])
        self.assertIn('--store-dir=/pnpm/store', instructions[install])
        self.assertIn('--mount=type=cache,target=/pnpm/store', instructions[install])

    def test_workspace_recipe_copy_matches_versioned_release_recipe(self):
        workspace = Path(__file__).resolve().parents[4]
        workspace_recipe = workspace / 'docker/frontend.Dockerfile'
        if not (workspace / 'Backgammon Game').is_dir() or not workspace_recipe.is_file():
            self.skipTest('Standalone game checkout has no workspace recipe copy')
        self.assertEqual(workspace_recipe.read_text(encoding='utf-8'), RECIPE.read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
