import { getAccessToken } from "./auth";

const API_URL =
  import.meta.env.VITE_SERVER_URL?.replace("ws", "http") ||
  "http://localhost:8080";

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
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || err.detail || "Request failed");
  }
  return res.json();
}

export async function createRoom() {
  return apiFetch("/api/rooms/", { method: "POST" });
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
