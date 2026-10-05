"""Pure audit policy tests; no Django, Docker, database, service or network access."""
from types import SimpleNamespace
import unittest

from rehearsal_app import require_tournament_finished, require_tournament_podium


class RehearsalAuditTests(unittest.TestCase):
    def tournament(self, **changes):
        values = {'name': 'Browser tournament', 'state': 'finished',
                  'entry_deadline_paused': False, 'results_confirmed_at': None}
        return SimpleNamespace(**dict(values, **changes))

    def participant(self, participant_id, position):
        return SimpleNamespace(participant_id=participant_id, podium_position=position)

    def test_automatic_finish_does_not_require_historical_organizer_approval(self):
        require_tournament_finished(self.tournament(), 'Browser tournament')

    def test_historical_approval_is_compatible_with_actual_finish(self):
        require_tournament_finished(self.tournament(results_confirmed_at='historical approval'),
                                    'Browser tournament')

    def test_approval_cannot_make_an_unfinished_tournament_pass(self):
        for state in ('draft', 'open', 'active'):
            with self.subTest(state=state), self.assertRaises(ValueError):
                require_tournament_finished(self.tournament(state=state, results_confirmed_at='approval'),
                                            'Browser tournament')

    def test_paused_tournament_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'did not finish normally'):
            require_tournament_finished(self.tournament(entry_deadline_paused=True), 'Browser tournament')

    def test_another_tournament_name_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'name differs'):
            require_tournament_finished(self.tournament(name='Another tournament'), 'Browser tournament')

    def test_zero_position_champion_is_preserved_and_unplaced_players_are_excluded(self):
        champion = self.participant(41, 0)
        participants = [self.participant(43, None), self.participant(42, 1), champion]
        self.assertIs(require_tournament_podium(participants, [{'id': 41}, {'id': 42}]), champion)

    def test_one_based_podium_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Unexpected podium'):
            require_tournament_podium([self.participant(41, 1), self.participant(42, 2)],
                                      [{'id': 41}, {'id': 42}])

    def test_missing_duplicate_or_extra_podium_positions_are_rejected(self):
        for positions in ([], [0], [1], [0, 0], [0, 1, 2]):
            participants = [self.participant(41 + index, position) for index, position in enumerate(positions)]
            with self.subTest(positions=positions), self.assertRaisesRegex(ValueError, 'Unexpected podium'):
                require_tournament_podium(participants, [{'id': 41}, {'id': 42}])

    def test_both_podium_members_and_their_order_must_match_the_browser(self):
        participants = [self.participant(41, 0), self.participant(42, 1)]
        for observed in ([{'id': 42}, {'id': 41}], [{'id': 41}, {'id': 99}], [], [{'id': 41}]):
            with self.subTest(observed=observed), self.assertRaisesRegex(ValueError, 'podium differs'):
                require_tournament_podium(participants, observed)


if __name__ == '__main__':
    unittest.main()
