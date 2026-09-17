export function buildRematchEntryUrl(
  serverUrl: string | undefined,
  origin: string,
  ticket: string,
): string {
  const encodedTicket = encodeURIComponent(ticket);

  if (!serverUrl) {
    const normalizedOrigin = origin.replace(/\/+$/, "");
    return `${normalizedOrigin}/backgammon/api/link/enter/?ticket=${encodedTicket}`;
  }

  const normalizedServerUrl = serverUrl
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");

  return `${normalizedServerUrl}/api/link/enter/?ticket=${encodedTicket}`;
}
