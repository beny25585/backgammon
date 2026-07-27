import { useEffect, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import type { Color } from "../../types/game";
import { getSocketService } from "../../services/socket";
import { getAccessToken } from "../../services/auth";
import { updateRoomStatus } from "../../services/roomStorage";
import styles from "./WaitingRoom.module.css";

export default function WaitingRoom() {
  const { roomId } = useParams<{ roomId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as { roomCode?: string; playerColor?: Color; targetPoints?: number } | null;
  const roomCode = state?.roomCode || "";
  const playerColor = state?.playerColor || "white";
  const targetPoints = state?.targetPoints || 7;

  const [status, setStatus] = useState<"connecting" | "waiting" | "opponent_joined" | "error">("connecting");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [connectedCount, setConnectedCount] = useState(1);
  const socket = getSocketService(import.meta.env.VITE_SERVER_URL);

  useEffect(() => {
    if (!roomId) return;
    const token = getAccessToken();
    if (!token) return;

    const connectAndWait = async () => {
      try {
        await socket.connect(roomId, token);
        setStatus("waiting");

        socket.on("player_joined", (payload: unknown) => {
          const data = payload as { playerColor?: string };
          // Ignore our own player_joined event — only react when opponent joins
          if (data?.playerColor === playerColor) return;
          setStatus("opponent_joined");
          updateRoomStatus("playing");
          setTimeout(() => {
            navigate(`/game/${roomId}`, {
              state: { playerColor },
              replace: true,
            });
          }, 1000);
        });

        socket.on("room_status", (payload: unknown) => {
          const data = payload as { connected: number };
          setConnectedCount(data?.connected ?? 1);
        });

        socket.on("error", (payload) => {
          const msg = typeof payload === "string" ? payload : (payload as Record<string, unknown>)?.message as string;
          setStatus("error");
          setError(msg);
        });
      } catch (err) {
        setStatus("error");
        setError(err instanceof Error ? err.message : "Failed to connect");
      }
    };

    connectAndWait();
    return () => { socket.removeAllListeners(); };
  }, [roomId, socket, navigate, playerColor]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* fallback */ }
  }

  function handleLeave() {
    socket.disconnect();
    navigate("/home", { replace: true });
  }

  if (status === "error") {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <p className={styles.errorText}>{error}</p>
          <button onClick={handleLeave} className={styles.leaveButton}>Back to home</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Backgammon</h1>

        {status === "connecting" && (
          <div className={styles.center}>
            <div className={styles.spinner} />
            <p className={styles.statusText}>Connecting...</p>
          </div>
        )}

        {status === "waiting" && (
          <div className={styles.center}>
            <div className={styles.codeSection}>
              <div className={styles.codeLabel}>Room Code</div>
              <div className={styles.codeWrapper}>
                <span className={styles.code}>{roomCode}</span>
                <button onClick={handleCopy} className={styles.copyButton}>
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <p className={styles.shareHint}>Share this code with your opponent</p>
            </div>
            <div className={styles.waitingSection}>
              <div className={styles.dots}>
                <span className={styles.dot} />
                <span className={styles.dot} />
                <span className={styles.dot} />
              </div>
              <p className={styles.waitingText}>Waiting for opponent...</p>
            </div>
            <p className={styles.statusText}>{connectedCount}/2 connected</p>
            <div className={styles.playerInfo}>
              You: {playerColor === "white" ? "White" : "Black"}
            </div>
            <p className={styles.matchInfo}>
              {targetPoints === 1 ? "Single Game" : `First to ${targetPoints} points`}
            </p>
          </div>
        )}

        {status === "opponent_joined" && (
          <div className={styles.center}>
            <p className={styles.opponentJoined}>Opponent joined!</p>
            <p className={styles.startingText}>Starting game...</p>
          </div>
        )}

        <button onClick={handleLeave} className={styles.leaveButton}>Leave</button>
      </div>
    </div>
  );
}
