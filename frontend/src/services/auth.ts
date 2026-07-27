const API_URL = import.meta.env.VITE_SERVER_URL?.replace('ws', 'http') ?? '';

export interface AuthTokens {
  access: string;
  refresh: string;
}

async function parseError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const json = JSON.parse(text);
    return json.username?.[0] || json.error || json.detail || `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status}): ${text.slice(0, 200)}`;
  }
}

export async function register(username: string, password: string): Promise<AuthTokens> {
  const res = await fetch(`${API_URL}/api/register/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, password2: password }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function login(username: string, password: string): Promise<AuthTokens> {
  const res = await fetch(`${API_URL}/api/login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export function storeTokens(tokens: AuthTokens): void {
  localStorage.setItem('bg_access_token', tokens.access);
  localStorage.setItem('bg_refresh_token', tokens.refresh);
}

export function getAccessToken(): string | null {
  return localStorage.getItem('bg_access_token');
}

export function clearTokens(): void {
  localStorage.removeItem('bg_access_token');
  localStorage.removeItem('bg_refresh_token');
}
