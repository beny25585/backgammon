import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getMatchDetail } from "../../services/api";
import { useI18n } from "../../i18n/I18nProvider";
import BrandLockup from "../BrandLockup";
import ReplayPlayer from "./ReplayPlayer";
import styles from "./MatchDetail.module.css";

interface GameEntry {
  game_number: number;
  winner: string;
  win_type: string;
  points_awarded: number;
  transcript: Array<{ turn: string; roll: number[]; moves: Array<{ from: number | "bar" | "off"; to: number | "bar" | "off" }> }>;
}

interface MatchData {
  id: string;
  created_at: string;
  whitePlayer: { username: string } | null;
  blackPlayer: { username: string } | null;
  target_points: number;
  white_score: number;
  black_score: number;
  winner: string | null;
  end_reason?: string | null;
  first_player?: string | null;
  hits?: number;
  duration_seconds?: number | null;
  games: GameEntry[];
}

export default function MatchDetail() {
  const { t, locale, direction } = useI18n();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [match, setMatch] = useState<MatchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [replaying, setReplaying] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;
    getMatchDetail(id).then((data) => {
      setMatch(data as MatchData);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  if (loading) return <div className={styles.loading}>{t("common.loading")}</div>;
  if (!match) return <div className={styles.loading}>{t("match.notFound")}</div>;

  const winnerLabel = match.winner ?? t("common.pending");
  const firstPlayerLabel =
    match.first_player === "white"
      ? match.whitePlayer?.username ?? t("common.white")
      : match.first_player === "black"
        ? match.blackPlayer?.username ?? t("common.black")
        : null;
  const whiteLabel = match.whitePlayer?.username ?? t("common.white");
  const blackLabel = match.blackPlayer?.username ?? t("common.black");
  const backArrow = direction === "rtl" ? "→" : "←";

  return (
    <main className={styles.container}>
      <div className={styles.shell}>
        <div className={styles.topRow}>
          <button className={styles.backBtn} onClick={() => navigate("/history")}>
            {backArrow} {t("common.back")}
          </button>
          <span className={styles.pill}>{t("match.detail")}</span>
        </div>

        <BrandLockup subtitle={t("match.replay")} size="md" />

        <div className={styles.header}>
          <div>
            <p className={styles.kicker}>{t("match.completed")}</p>
            <h1 className={styles.title}>
              {whiteLabel} {t("match.versus")} {blackLabel}
            </h1>
          </div>
          <div className={styles.summaryGrid}>
            <div className={styles.summaryCard}>
              <span>{t("match.score")}</span>
              <strong>{match.white_score} - {match.black_score}</strong>
            </div>
            <div className={styles.summaryCard}>
              <span>{t("match.bestOf")}</span>
              <strong>{match.target_points}</strong>
            </div>
            <div className={styles.summaryCard}>
              <span>{t("match.winner")}</span>
              <strong>{winnerLabel}</strong>
            </div>
            <div className={styles.summaryCard}>
              <span>{t("match.date")}</span>
              <strong className={styles.date}>
                {new Date(match.created_at).toLocaleDateString(locale === "he" ? "he-IL" : "en-US")}
              </strong>
            </div>
          </div>
        </div>

        {match.duration_seconds != null && (
          <div className={styles.summaryGrid}>
            {firstPlayerLabel && (
              <div className={styles.summaryCard}>
                <span>{t("match.firstPlayer")}</span>
                <strong>{firstPlayerLabel}</strong>
              </div>
            )}
            <div className={styles.summaryCard}>
              <span>{t("match.duration")}</span>
              <strong>
                {t("match.minutes", { minutes: Math.round(match.duration_seconds / 60) })}
              </strong>
            </div>
            <div className={styles.summaryCard}>
              <span>{t("match.hits")}</span>
              <strong>{match.hits ?? 0}</strong>
            </div>
            {match.end_reason && (
              <div className={styles.summaryCard}>
                <span>{t("match.endedBy")}</span>
                <strong>{match.end_reason}</strong>
              </div>
            )}
          </div>
        )}

        <h2 className={styles.subtitle}>{t("match.games")}</h2>
        {match.games.map((game, idx) => (
          <div key={idx} className={styles.gameCard}>
            <div className={styles.gameInfo}>
              <span>{t("match.game", { number: game.game_number })}</span>
              <span>{t("match.winnerLine", { winner: game.winner })}</span>
              <span>{t("match.pointsLine", { points: game.points_awarded })}</span>
              <span>{t("match.typeLine", { type: game.win_type })}</span>
            </div>
            <button
              className={styles.replayBtn}
              onClick={() => setReplaying(replaying === idx ? null : idx)}
            >
              {replaying === idx ? t("match.hideReplay") : t("match.replayAction")}
            </button>
            {replaying === idx && game.transcript && (
              <ReplayPlayer transcript={game.transcript} />
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
