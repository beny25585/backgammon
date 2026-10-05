import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarioConfig } from './scenario-config.mjs';

test('32 players require 31 natural matches, 62 replays and five rounds', () => {
  assert.deepEqual(scenarioConfig({ player_count: 32, recovery_checks: false }), {
    players: 32, matches: 31, firstRoundGames: 16, rounds: 5,
    finalRound: 4, semifinalRound: 3, resultReplays: 62, recoveryChecks: false,
  });
});

test('16 players and historical recovery manifests keep their expected counts', () => {
  const scenario = scenarioConfig({});
  assert.equal(scenario.matches, 15);
  assert.equal(scenario.firstRoundGames, 8);
  assert.equal(scenario.resultReplays, 30);
  assert.equal(scenario.recoveryChecks, true);
});

test('invalid sizes and ambiguous recovery flags stop the run', () => {
  for (const player_count of [0, 17, 64, '32', true]) {
    assert.throws(() => scenarioConfig({ player_count }));
  }
  assert.throws(() => scenarioConfig({ player_count: 32, recovery_checks: '0' }));
});
