/** Derived expectations shared by the browser scenario and its report checks. */
export function scenarioConfig(runtime) {
  const players = runtime.player_count ?? 16;
  // Manifests from earlier runs exercised the recovery scenario by default.
  const recoveryChecks = runtime.recovery_checks ?? true;
  if (![16, 32].includes(players) || typeof recoveryChecks !== 'boolean') {
    throw new Error('E2E requires 16 or 32 players and a boolean recovery_checks flag.');
  }
  const rounds = Math.log2(players);
  return { players, matches: players - 1, firstRoundGames: players / 2,
    rounds, finalRound: rounds - 1, semifinalRound: rounds - 2,
    resultReplays: (players - 1) * 2, recoveryChecks };
}
