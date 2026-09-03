import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import type { Color } from "../../types/game";
import { createRoom, joinRoom, cancelRoom, getActiveRoom } from "../../services/api";
import { clearTokens, getAccessToken } from "../../services/auth";
import { saveRoom, clearRoom, getRoom } from "../../services/roomStorage";
import MatchSettings from "../MatchSettings/MatchSettings";
import AnimatedTabs from "@/components/animations/AnimatedTabs/AnimatedTabs";
import { useI18n } from "../../i18n/I18nProvider";
import styles from "./HomeScreen.module.css";

interface RoomResponse {
  id: string;
  code: string;
  status: string;
  targetPoints: number;
  whitePlayer: { id: number; user_id?: number; username: string } | null;
  blackPlayer: { id: number; user_id?: number; username: string } | null;
}

export default function HomeScreen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const tabs = [
    { id: "create", label: t("home.createRoom") },
    { id: "join", label: t("home.joinWithCode") },
  ];
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showSettings, setShowSettings] = useState<"create" | "bot" | null>(
    null,
  );
  const [mode, setMode] = useState<"create" | "join">("create");
  const [roomKey, setRoomKey] = useState(0);
  const [activeRoom, setActiveRoom] = useState(() => getRoom());
  const [username] = useState(() => {
    try {
      const token = getAccessToken();
      if (!token) return t("home.player");
      const payload = JSON.parse(atob(token.split(".")[1]));
      return typeof payload.username === "string" ? payload.username : t("home.player");
    } catch {
      return t("home.player");
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = (await getActiveRoom()) as {
          active: {
            id: string;
            code: string;
            status: "waiting" | "playing";
            playerColor: Color | null;
          } | null;
        };
        if (cancelled) return;
        if (data.active) {
          saveRoom({
            roomId: data.active.id,
            roomCode: data.active.code,
            playerColor: data.active.playerColor ?? "white",
            status: data.active.status,
          });
        } else {
          clearRoom();
        }
        setActiveRoom(getRoom());
      } catch {
        // Server unreachable — keep whatever is in localStorage.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleCodeInput(value: string) {
    setCode(
      value
        .toUpperCase()
        .replace(/[^0-9A-Z]/g, "")
        .slice(0, 6),
    );
  }

  async function handleCreate(settings: {
    target: number;
    preferredColor?: string;
    time?: string;
  }) {
    setError("");
    setLoading(true);
    setShowSettings(null);
    try {
      const preferredColor = settings.preferredColor || "white";
      const room: RoomResponse = await createRoom({
        targetPoints: settings.target,
        preferredColor,
        time: settings.time,
      });
      saveRoom({
        roomId: room.id,
        roomCode: room.code,
        playerColor: preferredColor as Color,
        status: "waiting",
      });
      navigate(`/waiting/${room.id}`, {
        state: {
          roomCode: room.code,
          playerColor: preferredColor,
          targetPoints: settings.target,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("home.failedCreateRoom"));
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
      const playerColor: Color =
        String(room.whitePlayer?.user_id) === String(userId) ? "white" : "black";
      saveRoom({
        roomId: room.id,
        roomCode: code,
        playerColor,
        status: "playing",
      });
      navigate(`/game/${room.id}?color=${playerColor}`, {
        state: { playerColor },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("home.failedJoinRoom"));
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
    setActiveRoom(null);
    setRoomKey((key) => key + 1);
    setError("");
  }

  function handleRejoin() {
    if (!activeRoom) return;
    if (activeRoom.status === "waiting") {
      navigate(`/waiting/${activeRoom.roomId}`, {
        state: {
          roomCode: activeRoom.roomCode,
          playerColor: activeRoom.playerColor,
        },
      });
      return;
    }
    navigate(`/game/${activeRoom.roomId}?color=${activeRoom.playerColor}`, {
      state: { playerColor: activeRoom.playerColor },
    });
  }

  return (
    <main className={styles.container} key={roomKey}>
      <div className={styles.ambientGlow} />
      <nav className={styles.nav} aria-label={t("home.nav")}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>B</span>
          <span>{t("common.backgammon")}</span>
        </div>
        <div className={styles.account}>
          <span className={styles.avatar}>
            {username.charAt(0).toUpperCase()}
          </span>
          <span className={styles.username}>{username}</span>
          <button onClick={handleLogoutClick} className={styles.logout}>
            {t("home.logout")}
          </button>
        </div>
      </nav>

      <section className={styles.hero}>
        <motion.div
          className={styles.heroCopy}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <p className={styles.eyebrow}>
            <span /> {t("home.classic")}
          </p>
          <h1>
            {t("home.makeMove")}
            <br />
            <em>{t("home.hero")}</em>
          </h1>
          <p className={styles.intro}>{t("home.intro")}</p>
          <div className={styles.heroActions}>
            <button
              onClick={() => setShowSettings("create")}
              className={styles.playNow}
            >
              {t("home.playOnline")} <span>→</span>
            </button>
            <button
              onClick={() => setShowSettings("bot")}
              className={styles.secondaryAction}
            >
              {t("home.playAi")}
            </button>
          </div>
          <div className={styles.stats}>
            <div>
              <strong>24</strong>
              <span>{t("home.points")}</span>
            </div>
            <div>
              <strong>2</strong>
              <span>{t("home.modes")}</span>
            </div>
            <div>
              <strong>∞</strong>
              <span>{t("home.moves")}</span>
            </div>
          </div>
        </motion.div>

        <motion.div
          className={styles.boardScene}
          initial={{ opacity: 0, scale: 0.94, rotate: -2 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ duration: 0.65, delay: 0.12 }}
          aria-hidden="true"
        >
          <div className={styles.die}>
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className={styles.boardFrame}>
            <div className={styles.board}>
              <div className={styles.pointsTop}>
                {Array.from({ length: 12 }, (_, index) => (
                  <span
                    key={index}
                    className={index % 2 ? styles.lightPoint : styles.darkPoint}
                  />
                ))}
              </div>
              <div className={styles.boardBar} />
              <div className={styles.pointsBottom}>
                {Array.from({ length: 12 }, (_, index) => (
                  <span
                    key={index}
                    className={index % 2 ? styles.darkPoint : styles.lightPoint}
                  />
                ))}
              </div>
              <div
                className={`${styles.checker} ${styles.whiteChecker} ${styles.checkerOne}`}
              />
              <div
                className={`${styles.checker} ${styles.whiteChecker} ${styles.checkerTwo}`}
              />
              <div
                className={`${styles.checker} ${styles.blackChecker} ${styles.checkerThree}`}
              />
              <div
                className={`${styles.checker} ${styles.blackChecker} ${styles.checkerFour}`}
              />
            </div>
          </div>
          <p className={styles.boardCaption}>{t("home.caption")}</p>
        </motion.div>
      </section>

      <section className={styles.gamePanel} aria-label={t("home.startAria")}>
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.panelKicker}>{t("home.startKicker")}</p>
            <h2>{t("home.startTitle")}</h2>
          </div>
          <button
            onClick={() => navigate("/history")}
            className={styles.historyLink}
          >
            {t("home.history")} <span>↗</span>
          </button>
        </div>
        <AnimatedTabs
          tabs={tabs}
          activeTab={mode}
          onChange={(id) => setMode(id as "create" | "join")}
        />
        {mode === "create" ? (
          <div className={styles.createContent}>
            <p>{t("home.createPitch")}</p>
            <button
              onClick={() => setShowSettings("create")}
              disabled={loading}
              className={styles.panelPrimary}
            >
              {loading ? t("home.creatingRoom") : t("home.createPrivate")}
              <span>→</span>
            </button>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              handleJoin();
            }}
            className={styles.joinForm}
          >
            <label htmlFor="room-code">{t("home.roomCode")}</label>
            <div className={styles.joinRow}>
              <input
                id="room-code"
                type="text"
                placeholder="ABC123"
                value={code}
                onChange={(event) => handleCodeInput(event.target.value)}
                maxLength={6}
                required
              />
              <button type="submit" disabled={loading || code.length !== 6}>
                {loading ? t("home.joining") : t("home.joinGame")}
              </button>
            </div>
          </form>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </section>

      <section className={styles.modeGrid} aria-label={t("home.otherModes")}>
        <button
          onClick={() => setShowSettings("bot")}
          className={styles.modeCard}
        >
          <span className={styles.modeIcon}>♞</span>
          <span>
            <strong>{t("home.solo")}</strong>
            <small>{t("home.soloText")}</small>
          </span>
          <b>→</b>
        </button>
        <button onClick={() => navigate("/local")} className={styles.modeCard}>
          <span className={styles.modeIcon}>◎</span>
          <span>
            <strong>{t("home.passPlay")}</strong>
            <small>{t("home.passPlayText")}</small>
          </span>
          <b>→</b>
        </button>
      </section>

      {activeRoom && (
        <section className={styles.activeRoom}>
          <div>
            <p>{t("home.activeMatch")}</p>
            <strong>{activeRoom.roomCode || "—"}</strong>
            <span
              className={
                activeRoom.status === "waiting"
                  ? styles.waiting
                  : styles.playing
              }
            >
              {activeRoom.status === "waiting"
                ? t("home.waitingOpponent")
                : t("home.gameInProgress")}
            </span>
          </div>
          <div className={styles.activeActions}>
            <button onClick={handleRejoin}>
              {" "}
              {activeRoom.status === "waiting"
                ? t("home.openRoom")
                : t("home.returnGame")}{" "}
            </button>
            <button onClick={handleCancelRoom} className={styles.cancel}>
              {t("common.cancel")}
            </button>
          </div>
        </section>
      )}

      <footer className={styles.footer}>
        {t("home.footer")}
      </footer>

      {showSettings === "bot" && (
        <MatchSettings
          mode="bot"
          onStart={({ botColor, target, time }) => {
            setShowSettings(null);
            navigate(`/local?bot=${botColor}&target=${target}&time=${encodeURIComponent(time ?? "")}`);
          }}
          onCancel={() => setShowSettings(null)}
        />
      )}
      {showSettings === "create" && (
        <MatchSettings
          mode="online"
          onStart={handleCreate}
          onCancel={() => setShowSettings(null)}
        />
      )}
    </main>
  );
}
