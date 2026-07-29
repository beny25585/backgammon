import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { listMatches } from "../../services/api";
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
}

export default function MatchHistory() {
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
    return <div className={styles.loading}>Loading...</div>;
  }

  return (
    <main className={styles.container}>
      <div className={styles.shell}>
        <div className={styles.brandRow}>
          <span className={styles.brandMark}>B</span>
          <div>
            <p>Backgammon</p>
            <span>Match archive</span>
          </div>
        </div>

        <div className={styles.hero}>
          <div>
            <p className={styles.kicker}>History</p>
            <h1 className={styles.title}>Match History</h1>
          </div>
          <span className={styles.countPill}>{matches.length} matches</span>
        </div>

      {matches.length === 0 ? (
        <div className={styles.emptyCard}>
          <p className={styles.empty}>No matches played yet.</p>
        </div>
      ) : (
        <div className={styles.table}>
          <div className={styles.header}>
            <span>Date</span>
            <span>Opponent</span>
            <span>Score</span>
            <span>Result</span>
          </div>
          {matches.map((m) => (
            <div
              key={m.id}
              className={styles.row}
              onClick={() => navigate(`/history/${m.id}`)}
            >
              <span>{new Date(m.created_at).toLocaleDateString()}</span>
              <span>{m.whitePlayer?.username ?? m.blackPlayer?.username ?? "Unknown"}</span>
              <span>{m.white_score} - {m.black_score}</span>
              <span className={m.winner ? styles.won : styles.lost}>
                {m.winner ? `Won` : `Lost`}
              </span>
            </div>
          ))}
        </div>
      )}
      </div>
    </main>
  );
}
