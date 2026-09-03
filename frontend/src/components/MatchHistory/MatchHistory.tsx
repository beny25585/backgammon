import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { listMatches } from "../../services/api";
import { useI18n } from "../../i18n/I18nProvider";
import styles from "./MatchHistory.module.css";

interface MatchSummary {
  id: string;
  created_at: string;
  whitePlayer: { id: number; username: string } | null;
  blackPlayer: { id: number; username: string } | null;
  match_type: string;
  target_points: number;
  white_score: number;
  black_score: number;
  winner: string | null;
  end_reason?: string | null;
  first_player?: string | null;
  hits?: number;
  duration_seconds?: number | null;
}

export default function MatchHistory() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listMatches().then((data) => {
      setMatches(data.matches || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className={styles.loading}>{t("common.loading")}</div>;
  }

  return (
    <main className={styles.container}>
      <div className={styles.shell}>
        <div className={styles.brandRow}>
          <span className={styles.brandMark}>B</span>
          <div>
            <p>{t("common.backgammon")}</p>
            <span>{t("match.archive")}</span>
          </div>
        </div>

        <div className={styles.hero}>
          <div>
            <p className={styles.kicker}>{t("match.history")}</p>
            <h1 className={styles.title}>{t("match.matchHistory")}</h1>
          </div>
          <span className={styles.countPill}>{t("match.matches", { count: matches.length })}</span>
        </div>

      {matches.length === 0 ? (
        <div className={styles.emptyCard}>
          <p className={styles.empty}>{t("match.empty")}</p>
        </div>
      ) : (
        <div className={styles.table}>
          <div className={styles.header}>
            <span>{t("match.date")}</span>
            <span>{t("match.opponent")}</span>
            <span>{t("match.score")}</span>
            <span>{t("match.result")}</span>
          </div>
          {matches.map((m) => (
            <div
              key={m.id}
              className={styles.row}
              onClick={() => navigate(`/history/${m.id}`)}
            >
              <span>{new Date(m.created_at).toLocaleDateString()}</span>
              <span>{m.whitePlayer?.username ?? m.blackPlayer?.username ?? t("match.unknown")}</span>
              <span>{m.white_score} - {m.black_score}</span>
              <span className={m.winner ? styles.won : styles.lost}>
                {m.winner ? t("match.won") : t("match.lost")}
              </span>
            </div>
          ))}
        </div>
      )}
      </div>
    </main>
  );
}
