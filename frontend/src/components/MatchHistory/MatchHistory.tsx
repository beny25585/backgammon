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
    <div className={styles.container}>
      <h1 className={styles.title}>Match History</h1>
      {matches.length === 0 ? (
        <p className={styles.empty}>No matches played yet.</p>
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
  );
}
