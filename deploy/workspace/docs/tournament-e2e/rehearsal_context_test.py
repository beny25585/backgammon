"""Pure identity policy tests; no Django, Docker, database, service or network access."""
import copy
import unittest

from rehearsal_context import ORIGIN, PROJECT, fresh_database_context, require_fresh_database_context


class RehearsalContextTests(unittest.TestCase):
    def identity(self):
        session_id = 'a' * 32
        return {'project': PROJECT, 'origin': ORIGIN, 'session_id': session_id,
                'database_context': fresh_database_context(session_id)}

    def test_names_are_separate_from_transfer_and_production(self):
        context = require_fresh_database_context(self.identity())
        self.assertEqual(context['databases']['game'], 'backgammon_game_e2e_' + 'a' * 12)
        self.assertEqual(context['databases']['tournaments'], 'backgammon_tournaments_e2e_' + 'a' * 12)
        self.assertEqual(context['redis_databases'], {'game': 8, 'tournaments': 9})

    def test_untrusted_session_identifiers_cannot_become_sql_names(self):
        for value in (None, '', 'a' * 31, 'a' * 33, 'A' * 32, "a' ; DROP DATABASE postgres; --"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                fresh_database_context(value)

    def test_copied_database_or_cache_is_rejected(self):
        original = self.identity()
        for area, kind, value in (('databases', 'game', 'backgammon_game'),
                                  ('databases', 'tournaments', 'backgammon_tournaments'),
                                  ('redis_databases', 'game', 0), ('redis_databases', 'tournaments', 1)):
            identity = copy.deepcopy(original)
            identity['database_context'][area][kind] = value
            with self.subTest(area=area, kind=kind), self.assertRaises(ValueError):
                require_fresh_database_context(identity)

    def test_target_or_session_cannot_be_swapped(self):
        original = self.identity()
        for key, value in (('project', 'backgammon-production'), ('origin', ORIGIN.replace(':18443', '')),
                           ('session_id', 'b' * 32)):
            identity = copy.deepcopy(original)
            identity[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                require_fresh_database_context(identity)

    def test_legacy_manifest_is_rejected(self):
        identity = self.identity()
        del identity['database_context']
        with self.assertRaises(ValueError):
            require_fresh_database_context(identity)


if __name__ == '__main__':
    unittest.main()
