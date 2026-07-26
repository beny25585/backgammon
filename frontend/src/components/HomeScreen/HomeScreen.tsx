import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Color } from "../../types/game";
import { createRoom, joinRoom, cancelRoom } from "../../services/api";
import { clearTokens, getAccessToken } from "../../services/auth";
import { saveRoom, clearRoom, getRoom } from "../../services/roomStorage";
import styles from "./HomeScreen.module.css";
import MatchSettings from "../MatchSettings/MatchSettings";

interface RoomResponse {
  id: string;
  code: string;
  status: string;
  targetPoints: number;
  whitePlayer: { id: number; username: string } | null;
  blackPlayer: { id: number; username: string } | null;
}

export default function HomeScreen() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [mode, setMode] = useState<"create" | "join">("create");
  const [roomKey, setRoomKey] = useState(0);
  const [username] = useState(() => {
    try {
      const token = getAccessToken();
      if (!token) return "";
      const payload = JSON.parse(atob(token.split(".")[1]));
      return payload.username || payload.user_id || "";
    } catch {
      return "";
    }
  });

  const activeRoom = getRoom();

  function handleCodeInput(value: string) {
    const filtered = value
      .toUpperCase()
      .replace(/[^0-9A-Z]/g, "")
      .slice(0, 6);
    setCode(filtered);
  }

  async function handleCreate() {
    setError("");
    setLoading(true);
    try {
      const room: RoomResponse = await createRoom();
      saveRoom({ roomId: room.id, roomCode: room.code, playerColor: "white", status: "waiting" });
      navigate(`/waiting/${room.id}`, { state: { roomCode: room.code, playerColor: "white" } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create room");
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin() {
    if (code.length !== 6) return;
    setError("");
    setLoading(true);
    try {
      const room: RoomResponse = await joinRoom(code);
      saveRoom({ roomId: room.id, roomCode: code, playerColor: "black", status: "playing" });
      navigate(`/game/${room.id}?color=black`, { state: { playerColor: "black" } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join room");
    } finally {
      setLoading(false);
    }
  }

  function handleLogoutClick() {
    clearRoom();
    clearTokens();
    navigate("/", { replace: true });
  }

  function handleCancelRoom() {
    cancelRoom().catch(() => {});
    clearRoom();
    setRoomKey(k => k + 1);
    setError("");
  }

  function handleRejoin() {
    if (!activeRoom) return;
    if (activeRoom.status === "waiting") {
      navigate(`/waiting/${activeRoom.roomId}`, {
        state: { roomCode: activeRoom.roomCode, playerColor: activeRoom.playerColor },
      });
    } else {
      navigate(`/game/${activeRoom.roomId}?color=${activeRoom.playerColor}`, {
        state: { playerColor: activeRoom.playerColor },
      });
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.header}>
          <h1 className={styles.title}>Backgammon</h1>
          <div className={styles.userInfo}>
            <span className={styles.username}>{username}</span>
            <button onClick={handleLogoutClick} className={styles.logout}>
              Logout
            </button>
          </div>
        </div>

        <div className={styles.tabs}>
          <button
            onClick={() => setMode("create")}
            className={`${styles.tab} ${mode === "create" ? styles.tabActive : ""}`}
          >
            Create New Room
          </button>
          <button
            onClick={() => setMode("join")}
            className={`${styles.tab} ${mode === "join" ? styles.tabActive : ""}`}
          >
            Join Room
          </button>
        </div>

        {mode === "create" ? (
          <button onClick={handleCreate} disabled={loading} className={styles.primaryButton}>
            {loading ? "Creating room..." : "Create New Room"}
          </button>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); handleJoin(); }} className={styles.joinForm}>
            <input
              type="text"
              placeholder="Enter room code"
              value={code}
              onChange={(e) => handleCodeInput(e.target.value)}
              className={styles.codeInput}
              maxLength={6}
              required
            />
            <button type="submit" disabled={loading || code.length !== 6} className={styles.primaryButton}>
              {loading ? "Joining..." : "Join Room"}
            </button>
          </form>
        )}

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.divider} />
        <button onClick={() => setShowSettings(true)} className={styles.devButton}>
          🤖 Play vs AI
        </button>
        <button onClick={() => navigate("/local")} className={styles.devButton}>
          🎲 Local Game (dev)
        </button>

        {activeRoom && (
          <>
            <div className={styles.divider} />
            <div className={styles.activeRoom}>
              <div className={styles.activeRoomHeader}>Active Game</div>
              <div className={styles.activeRoomBody}>
                <div className={styles.activeRoomCode}>{activeRoom.roomCode || "—"}</div>
                <div className={styles.activeStatusRow}>
                  <span className={`${styles.statusDot} ${activeRoom.status === "waiting" ? styles.statusWaiting : styles.statusPlaying}`} />
                  <span className={styles.statusText}>
                    {activeRoom.status === "waiting" ? "Waiting for opponent..." : "Game in progress"}
                  </span>
                </div>
                <div className={styles.activeRoomActions}>
                  <button onClick={handleRejoin} className={styles.returnButton}>
                    {activeRoom.status === "waiting" ? "Waiting Room" : "Return to Game"}
                  </button>
                  <button onClick={handleCancelRoom} className={styles.cancelButton}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {showSettings && (
        <MatchSettings
          onStart={({ botColor, target }) => {
            setShowSettings(false);
            navigate(`/local?bot=${botColor}&target=${target}`);
          }}
          onCancel={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
