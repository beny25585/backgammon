import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getMatchDetail } from "../../services/api";
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
  games: GameEntry[];
}

export default function MatchDetail() {
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

  if (loading) return <div className={styles.loading}>Loading...</div>;
  if (!match) return <div className={styles.loading}>Match not found</div>;

  return (
    <div className={styles.container}>
      <button className={styles.backBtn} onClick={() => navigate("/history")}>
        &larr; Back
      </button>
      <h1 className={styles.title}>Match Detail</h1>
      <div className={styles.header}>
        <p>
          {match.whitePlayer?.username ?? "White"} vs {match.blackPlayer?.username ?? "Black"}
        </p>
        <p>Score: {match.white_score} - {match.black_score}</p>
        <p>Best of {match.target_points}</p>
        <p>Winner: {match.winner}</p>
        <p className={styles.date}>{new Date(match.created_at).toLocaleDateString()}</p>
      </div>

      <h2 className={styles.subtitle}>Games</h2>
      {match.games.map((game, idx) => (
        <div key={idx} className={styles.gameCard}>
          <div className={styles.gameInfo}>
            <span>Game {game.game_number}</span>
            <span>Winner: {game.winner}</span>
            <span>Points: {game.points_awarded}</span>
            <span>Type: {game.win_type}</span>
          </div>
          <button
            className={styles.replayBtn}
            onClick={() => setReplaying(replaying === idx ? null : idx)}
          >
            {replaying === idx ? "Hide Replay" : "Replay"}
          </button>
          {replaying === idx && game.transcript && (
            <ReplayPlayer transcript={game.transcript} />
          )}
        </div>
      ))}
    </div>
  );
}
