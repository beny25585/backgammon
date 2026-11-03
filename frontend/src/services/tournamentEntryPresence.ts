import type { GameSocketService } from "./socket";

type EntrySocket = Pick<GameSocketService,
  "on" | "off" | "send" | "connect" | "disconnect" | "isConnected"
>;

/** Own startup presence only; an already started game keeps its normal lifecycle. */
export function bindTournamentEntryPresence(
  socket: EntrySocket,
  roomId: string,
  token: string,
  onConnectionError: (error: unknown) => void,
  onStarted?: () => void,
) {
  let disposed = false;
  let started = false;
  let pageHidden = false;
  let suspended = document.visibilityState === "hidden" || navigator.onLine === false;
  let lastChallenge: string | null = null;
  const visible = () => !disposed && !pageHidden
    && document.visibilityState !== "hidden" && navigator.onLine !== false;

  const suspend = () => {
    if (disposed || started) return;
    suspended = true;
    lastChallenge = null;
    socket.send("entry_not_ready", {});
    socket.disconnect();
  };
  const restore = () => {
    if (disposed || started || !visible()) return;
    if (!suspended) return;
    suspended = false;
    void socket.connect(roomId, token).catch((error: unknown) => {
      if (!disposed && !suspended) onConnectionError(error);
    });
  };
  const availabilityChanged = () => {
    if (visible()) restore();
    else suspend();
  };
  const pageHide = () => { pageHidden = true; suspend(); };
  const pageShow = () => { pageHidden = false; restore(); };
  const roomStarted = () => {
    if (disposed || started) return;
    started = true;
    lastChallenge = null;
    onStarted?.();
  };
  const roomStatus = (message: unknown) => {
    const status = (message as { payload?: { status?: unknown } })?.payload?.status;
    if (status === "playing") roomStarted();
  };
  const challenge = (message: unknown) => {
    if (started || !visible() || suspended || !socket.isConnected()) return;
    const payload = (message as {
      payload?: { challenge?: unknown; expiresAt?: unknown };
    })?.payload;
    if (typeof payload?.challenge !== "string" || !payload.challenge
      || payload.challenge.length > 128 || payload.challenge === lastChallenge
      || typeof payload.expiresAt !== "number" || !Number.isFinite(payload.expiresAt)) return;
    // Freshness is checked against the server's clock. Phone clock skew must
    // not prevent a visible client from answering every valid server round.
    if (socket.send("entry_ready", { challenge: payload.challenge })) {
      lastChallenge = payload.challenge;
    }
  };

  socket.on("entry_challenge", challenge);
  socket.on("room_started", roomStarted);
  socket.on("room_status", roomStatus);
  document.addEventListener("visibilitychange", availabilityChanged);
  window.addEventListener("offline", availabilityChanged);
  window.addEventListener("online", availabilityChanged);
  window.addEventListener("pagehide", pageHide);
  window.addEventListener("pageshow", pageShow);

  return {
    canConnect: visible,
    dispose() {
      suspend();
      disposed = true;
      socket.off("entry_challenge", challenge);
      socket.off("room_started", roomStarted);
      socket.off("room_status", roomStatus);
      document.removeEventListener("visibilitychange", availabilityChanged);
      window.removeEventListener("offline", availabilityChanged);
      window.removeEventListener("online", availabilityChanged);
      window.removeEventListener("pagehide", pageHide);
      window.removeEventListener("pageshow", pageShow);
    },
  };
}
