import { getAccessToken, handleSessionExpired } from "./auth";

const API_URL =
  import.meta.env.VITE_SERVER_URL?.replace("ws", "http") ?? '';

async function apiFetch(path: string, options: RequestInit = {}) {
  const token = getAccessToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    if (res.status === 401) {
      handleSessionExpired();
    }
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || err.detail || "Request failed");
  }
  return res.json();
}

export async function createRoom(settings?: { targetPoints?: number; preferredColor?: string }) {
  return apiFetch("/api/rooms/", {
    method: "POST",
    body: settings ? JSON.stringify(settings) : undefined,
  });
}

export async function joinRoom(code: string) {
  return apiFetch("/api/rooms/join/", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function getRoomDetail(code: string) {
  return apiFetch(`/api/rooms/${code}/`);
}

export async function cancelRoom() {
  return apiFetch("/api/rooms/cancel/", { method: "POST" });
}

export async function saveMatch(matchData: Record<string, unknown>) {
  return apiFetch("/api/matches/", {
    method: "POST",
    body: JSON.stringify(matchData),
  });
}

export async function listMatches(page = 1) {
  return apiFetch(`/api/matches/list/?page=${page}`);
}

export async function getMatchDetail(id: string) {
  return apiFetch(`/api/matches/${id}/`);
}

export async function getStats() {
  return apiFetch("/api/stats/");
}
