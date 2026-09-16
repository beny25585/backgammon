export function isValidTournamentId(value: string | null): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "0" || trimmed === "null" || trimmed === "undefined") return false;
  const num = Number(trimmed);
  if (Number.isFinite(num)) return num > 0;
  return true;
}

export function resolveGameType(
  params: URLSearchParams,
  backendFormat?: string | null,
): import("./types/context").GameType {
  const tournamentId = params.get("tournament");
  if (isValidTournamentId(tournamentId)) return "tournament";

  const format = backendFormat ?? params.get("format");
  if (format === "money") return "quick";
  if (format === "match") return "1v1";

  const mode = params.get("mode");
  if (mode === "quick") return "quick";
  if (mode === "1v1" || mode === "match" || mode === "friend") return "1v1";
  if (params.get("quick") === "1") return "quick";

  return "1v1";
}
