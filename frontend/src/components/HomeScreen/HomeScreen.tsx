import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import type { Color } from "../../types/game";
import { createRoom, joinRoom, cancelRoom } from "../../services/api";
import { clearTokens, getAccessToken } from "../../services/auth";
import { saveRoom, clearRoom, getRoom } from "../../services/roomStorage";
import MatchSettings from "../MatchSettings/MatchSettings";
import AnimatedTabs from "@/components/animations/AnimatedTabs/AnimatedTabs";
import styles from "./HomeScreen.module.css";

interface RoomResponse {
  id: string;
  code: string;
  status: string;
  targetPoints: number;
  whitePlayer: { id: number; username: string } | null;
  blackPlayer: { id: number; username: string } | null;
}

const tabs = [
  { id: "create", label: "Create room" },
  { id: "join", label: "Join with code" },
];

export default function HomeScreen() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showSettings, setShowSettings] = useState<"create" | "bot" | null>(null);
  const [mode, setMode] = useState<"create" | "join">("create");
  const [roomKey, setRoomKey] = useState(0);
  const [username] = useState(() => {
    try {
      const token = getAccessToken();
      if (!token) return "Player";
      const payload = JSON.parse(atob(token.split(".")[1]));
      return payload.username || payload.user_id || "Player";
    } catch {
      return "Player";
    }
  });
  const [userId] = useState(() => {
    try {
      const token = getAccessToken();
      if (!token) return null;
      return JSON.parse(atob(token.split(".")[1])).user_id as number | string;
    } catch {
      return null;
    }
  });

  const activeRoom = getRoom();

  function handleCodeInput(value: string) {
    setCode(value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 6));
  }

  async function handleCreate(settings: { target: number; preferredColor?: string }) {
    setError("");
    setLoading(true);
    setShowSettings(null);
    try {
      const preferredColor = settings.preferredColor || "white";
      const room: RoomResponse = await createRoom({ targetPoints: settings.target, preferredColor });
      saveRoom({ roomId: room.id, roomCode: room.code, playerColor: preferredColor as Color, status: "waiting" });
      navigate(`/waiting/${room.id}`, { state: { roomCode: room.code, playerColor: preferredColor, targetPoints: settings.target } });
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
      const playerColor: Color = String(room.whitePlayer?.id) === String(userId) ? "white" : "black";
      saveRoom({ roomId: room.id, roomCode: code, playerColor, status: "playing" });
      navigate(`/game/${room.id}?color=${playerColor}`, { state: { playerColor } });
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
    setRoomKey((key) => key + 1);
    setError("");
  }

  function handleRejoin() {
    if (!activeRoom) return;
    if (activeRoom.status === "waiting") {
      navigate(`/waiting/${activeRoom.roomId}`, { state: { roomCode: activeRoom.roomCode, playerColor: activeRoom.playerColor } });
      return;
    }
    navigate(`/game/${activeRoom.roomId}?color=${activeRoom.playerColor}`, { state: { playerColor: activeRoom.playerColor } });
  }

  return (
    <main className={styles.container} key={roomKey}>
      <div className={styles.ambientGlow} />
      <nav className={styles.nav} aria-label="Main navigation">
        <div className={styles.brand}><span className={styles.brandMark}>B</span><span>Backgammon</span></div>
        <div className={styles.account}>
          <span className={styles.avatar}>{username.charAt(0).toUpperCase()}</span>
          <span className={styles.username}>{username}</span>
          <button onClick={handleLogoutClick} className={styles.logout}>Log out</button>
        </div>
      </nav>

      <section className={styles.hero}>
        <motion.div className={styles.heroCopy} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <p className={styles.eyebrow}><span /> The classic game, reimagined</p>
          <h1>Make your move.<br /><em>Own the board.</em></h1>
          <p className={styles.intro}>Challenge a friend online, sharpen your strategy against the AI, or share the board across the table.</p>
          <div className={styles.heroActions}>
            <button onClick={() => setShowSettings("create")} className={styles.playNow}>Play online <span>→</span></button>
            <button onClick={() => setShowSettings("bot")} className={styles.secondaryAction}>Play vs AI</button>
          </div>
          <div className={styles.stats}>
            <div><strong>24</strong><span>points on the board</span></div>
            <div><strong>2</strong><span>ways to play</span></div>
            <div><strong>∞</strong><span>moves to master</span></div>
          </div>
        </motion.div>

        <motion.div className={styles.boardScene} initial={{ opacity: 0, scale: 0.94, rotate: -2 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={{ duration: 0.65, delay: 0.12 }} aria-hidden="true">
          <div className={styles.die}><i /><i /><i /><i /><i /></div>
          <div className={styles.boardFrame}>
            <div className={styles.board}>
              <div className={styles.pointsTop}>{Array.from({ length: 12 }, (_, index) => <span key={index} className={index % 2 ? styles.lightPoint : styles.darkPoint} />)}</div>
              <div className={styles.boardBar} />
              <div className={styles.pointsBottom}>{Array.from({ length: 12 }, (_, index) => <span key={index} className={index % 2 ? styles.darkPoint : styles.lightPoint} />)}</div>
              <div className={`${styles.checker} ${styles.whiteChecker} ${styles.checkerOne}`} />
              <div className={`${styles.checker} ${styles.whiteChecker} ${styles.checkerTwo}`} />
              <div className={`${styles.checker} ${styles.blackChecker} ${styles.checkerThree}`} />
              <div className={`${styles.checker} ${styles.blackChecker} ${styles.checkerFour}`} />
            </div>
          </div>
          <p className={styles.boardCaption}>Every roll is a new beginning.</p>
        </motion.div>
      </section>

      <section className={styles.gamePanel} aria-label="Start a game">
        <div className={styles.panelHeading}><div><p className={styles.panelKicker}>Start a match</p><h2>Find your next game</h2></div><button onClick={() => navigate("/history")} className={styles.historyLink}>Match history <span>↗</span></button></div>
        <AnimatedTabs tabs={tabs} activeTab={mode} onChange={(id) => setMode(id as "create" | "join")} />
        {mode === "create" ? (
          <div className={styles.createContent}>
            <p>Set your match preferences, then share your private room code with a friend.</p>
            <button onClick={() => setShowSettings("create")} disabled={loading} className={styles.panelPrimary}>{loading ? "Creating room…" : "Create a private room"}<span>→</span></button>
          </div>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); handleJoin(); }} className={styles.joinForm}>
            <label htmlFor="room-code">Your friend’s room code</label>
            <div className={styles.joinRow}><input id="room-code" type="text" placeholder="ABC123" value={code} onChange={(event) => handleCodeInput(event.target.value)} maxLength={6} required /><button type="submit" disabled={loading || code.length !== 6}>{loading ? "Joining…" : "Join game"}</button></div>
          </form>
        )}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </section>

      <section className={styles.modeGrid} aria-label="Other game modes">
        <button onClick={() => setShowSettings("bot")} className={styles.modeCard}><span className={styles.modeIcon}>♞</span><span><strong>Solo challenge</strong><small>Test your tactics against the AI</small></span><b>→</b></button>
        <button onClick={() => navigate("/local")} className={styles.modeCard}><span className={styles.modeIcon}>◎</span><span><strong>Pass &amp; play</strong><small>One board, two players, no account needed</small></span><b>→</b></button>
      </section>

      {activeRoom && <section className={styles.activeRoom}>
        <div><p>ACTIVE MATCH</p><strong>{activeRoom.roomCode || "—"}</strong><span className={activeRoom.status === "waiting" ? styles.waiting : styles.playing}>{activeRoom.status === "waiting" ? "Waiting for an opponent" : "Game in progress"}</span></div>
        <div className={styles.activeActions}><button onClick={handleRejoin}> {activeRoom.status === "waiting" ? "Open room" : "Return to game"} </button><button onClick={handleCancelRoom} className={styles.cancel}>Cancel</button></div>
      </section>}

      <footer className={styles.footer}>ROLL WITH CONFIDENCE <span>•</span> PLAY WITH STYLE</footer>

      {showSettings === "bot" && <MatchSettings mode="bot" onStart={({ botColor, target }) => { setShowSettings(null); navigate(`/local?bot=${botColor}&target=${target}`); }} onCancel={() => setShowSettings(null)} />}
      {showSettings === "create" && <MatchSettings mode="online" onStart={handleCreate} onCancel={() => setShowSettings(null)} />}
    </main>
  );
}
