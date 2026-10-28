import { useCallback, useEffect, useRef, useState } from "react";
import { readSpectatorSnapshot, type SpectatorError, type SpectatorSnapshot, type SpectatorStatus } from "../types/spectator";

const HEARTBEAT_MS = 15_000;
const RESPONSE_TIMEOUT_MS = 25_000;
const MAX_RETRIES = 3;
const errors = new Set<SpectatorError>(["full", "expired", "unavailable", "ended", "forbidden"]);
const storageKey = (roomId: string) => `6b-spectator-v1:${roomId}`;

function readTicket(roomId: string): string | null {
  const fragment = new URLSearchParams(window.location.hash.slice(1)).get("ticket");
  try {
    return fragment || window.sessionStorage.getItem(storageKey(roomId));
  } catch {
    return fragment;
  }
}

function saveTicket(roomId: string, ticket: string | null) {
  try {
    if (ticket) window.sessionStorage.setItem(storageKey(roomId), ticket);
    else window.sessionStorage.removeItem(storageKey(roomId));
  } catch { /* Watching remains usable when browser storage is unavailable. */ }
}

export function spectatorSocketUrl(roomId: string, serverUrl?: string): string {
  const url = new URL(serverUrl || "/backgammon", window.location.origin);
  url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/ws/watch/${encodeURIComponent(roomId)}/`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

interface ConnectionState {
  roomId: string;
  snapshot: SpectatorSnapshot | null;
  status: SpectatorStatus;
  error: SpectatorError | null;
}

/** A spectator owns no player session and can send only authentication and liveness. */
export function useSpectatorConnection(roomId: string, serverUrl?: string) {
  const [attempt, setAttempt] = useState(0);
  const credential = useRef<{ roomId: string; ticket: string } | null>(null);
  const savedSnapshot = useRef<{ roomId: string; snapshot: SpectatorSnapshot } | null>(null);
  const [connection, setConnection] = useState<ConnectionState>({ roomId, snapshot: null, status: "connecting", error: null });

  useEffect(() => {
    let disposed = false;
    let terminal = false;
    let socket: WebSocket | null = null;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;
    let ticket = readTicket(roomId) || (credential.current?.roomId === roomId ? credential.current.ticket : null);
    let latest = savedSnapshot.current?.roomId === roomId ? savedSnapshot.current.snapshot : null;
    let lastReplyAt = Date.now();

    if (window.location.hash) window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
    if (ticket) {
      credential.current = { roomId, ticket };
      saveTicket(roomId, ticket);
    }

    const update = (status: SpectatorStatus, error: SpectatorError | null = null) => {
      if (!disposed) setConnection({ roomId, snapshot: latest, status, error });
    };
    const clearTimers = () => {
      clearInterval(heartbeat);
      clearTimeout(watchdog);
    };
    const fail = (error: SpectatorError) => {
      terminal = true;
      clearTimers();
      if (error === "expired" || error === "forbidden" || error === "ended") {
        credential.current = null;
        saveTicket(roomId, null);
      }
      update(error === "ended" ? "ended" : "error", error);
      socket?.close(1000);
    };
    const connect = () => {
      if (disposed || terminal) return;
      if (!ticket || !/^[0-9a-f-]{36}$/i.test(roomId)) { fail("expired"); return; }
      update(retries > 0 ? "reconnecting" : "connecting");
      try {
        socket = new WebSocket(spectatorSocketUrl(roomId, serverUrl));
      } catch { fail("unavailable"); return; }
      const current = socket;
      watchdog = setTimeout(() => current.close(), RESPONSE_TIMEOUT_MS);
      current.onopen = () => {
        if (disposed || current !== socket) { current.close(); return; }
        lastReplyAt = Date.now();
        current.send(JSON.stringify({ type: "spectator_auth", ticket }));
        heartbeat = setInterval(() => {
          if (Date.now() - lastReplyAt > RESPONSE_TIMEOUT_MS) { current.close(); return; }
          if (current.readyState === WebSocket.OPEN) current.send(JSON.stringify({ type: "spectator_ping" }));
        }, HEARTBEAT_MS);
      };
      current.onmessage = (event) => {
        if (disposed || terminal || current !== socket) return;
        let message: Record<string, unknown>;
        try { message = JSON.parse(event.data); } catch { fail("unavailable"); return; }
        if (!message || typeof message !== "object") { fail("unavailable"); return; }
        lastReplyAt = Date.now();
        if (typeof message.ticket === "string" && message.ticket.length < 8192) {
          ticket = message.ticket;
          credential.current = { roomId, ticket };
          saveTicket(roomId, ticket);
        }
        if (message.type === "spectator_error") {
          fail(errors.has(message.code as SpectatorError) ? message.code as SpectatorError : "unavailable");
        } else if (message.type === "spectator_state" || message.type === "spectator_end") {
          const snapshot = readSpectatorSnapshot(message.payload, message.meta);
          if (!snapshot) { fail("unavailable"); return; }
          // Versions are monotonic within a room, including transitions to the next game.
          if (latest && (snapshot.state.version ?? 0) < (latest.state.version ?? 0)) return;
          latest = snapshot;
          savedSnapshot.current = { roomId, snapshot };
          clearTimeout(watchdog);
          retries = 0;
          if (message.type === "spectator_end") fail("ended");
          else update("live");
        }
      };
      current.onclose = () => {
        if (disposed || terminal || current !== socket) return;
        clearTimers();
        if (retries >= MAX_RETRIES) { fail("unavailable"); return; }
        retries += 1;
        update("reconnecting");
        reconnect = setTimeout(connect, 1000 * retries);
      };
      // The close event owns reconnects; no raw URLs or credentials enter client logs.
      current.onerror = () => current.close();
    };

    connect();
    const leave = () => {
      disposed = true;
      clearTimers();
      clearTimeout(reconnect);
      socket?.close(1000);
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) setAttempt(value => value + 1);
    };
    window.addEventListener("pagehide", leave);
    window.addEventListener("pageshow", restore);
    return () => {
      leave();
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("pageshow", restore);
    };
  }, [roomId, serverUrl, attempt]);

  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const current = connection.roomId === roomId ? connection : { roomId, snapshot: null, status: "connecting" as const, error: null };
  return { ...current, retry };
}
