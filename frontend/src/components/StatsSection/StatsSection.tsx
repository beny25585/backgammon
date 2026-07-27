import { useState, useEffect } from "react";
import { getStats } from "../../services/api";
import styles from "./StatsSection.module.css";

interface Stats {
  total_matches: number; matches_won: number; match_win_rate: number;
  total_games: number; games_won: number; game_win_rate: number;
  single_wins: number; gammon_wins: number; backgammon_wins: number;
  current_streak: number; longest_streak: number;
}

export default function StatsSection() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    getStats().then(setStats).catch(() => {});
  }, []);

  if (!stats) return null;

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>Player Stats</h2>
      <div className={styles.grid}>
        <div className={styles.card}>
          <span className={styles.label}>Matches</span>
          <span className={styles.value}>{stats.matches_won}/{stats.total_matches}</span>
          <span className={styles.sub}>Win rate: {(stats.match_win_rate * 100).toFixed(1)}%</span>
        </div>
        <div className={styles.card}>
          <span className={styles.label}>Games</span>
          <span className={styles.value}>{stats.games_won}/{stats.total_games}</span>
          <span className={styles.sub}>Win rate: {(stats.game_win_rate * 100).toFixed(1)}%</span>
        </div>
        <div className={styles.card}>
          <span className={styles.label}>Win Types</span>
          <span className={styles.value}>{stats.single_wins}/{stats.gammon_wins}/{stats.backgammon_wins}</span>
          <span className={styles.sub}>Single / Gammon / Backgammon</span>
        </div>
        <div className={styles.card}>
          <span className={styles.label}>Streak</span>
          <span className={styles.value}>{stats.current_streak}</span>
          <span className={styles.sub}>Longest: {stats.longest_streak}</span>
        </div>
      </div>
    </div>
  );
}
