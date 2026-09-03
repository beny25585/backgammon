import { useState, useEffect } from "react";
import { getStats } from "../../services/api";
import { useI18n } from "../../i18n/I18nProvider";
import styles from "./StatsSection.module.css";

interface Stats {
  total_matches: number; matches_won: number; match_win_rate: number;
  total_games: number; games_won: number; game_win_rate: number;
  single_wins: number; gammon_wins: number; backgammon_wins: number;
  current_streak: number; longest_streak: number;
}

export default function StatsSection() {
  const { t } = useI18n();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    getStats().then(setStats).catch(() => {});
  }, []);

  if (!stats) return null;

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>{t("stats.title")}</h2>
      <div className={styles.grid}>
        <div className={styles.card}>
          <span className={styles.label}>{t("stats.matches")}</span>
          <span className={styles.value}>{stats.matches_won}/{stats.total_matches}</span>
          <span className={styles.sub}>{t("stats.winRate", { value: (stats.match_win_rate * 100).toFixed(1) })}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.label}>{t("stats.games")}</span>
          <span className={styles.value}>{stats.games_won}/{stats.total_games}</span>
          <span className={styles.sub}>{t("stats.winRate", { value: (stats.game_win_rate * 100).toFixed(1) })}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.label}>{t("stats.winTypes")}</span>
          <span className={styles.value}>{stats.single_wins}/{stats.gammon_wins}/{stats.backgammon_wins}</span>
          <span className={styles.sub}>{t("stats.winTypesBreakdown")}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.label}>{t("stats.streak")}</span>
          <span className={styles.value}>{stats.current_streak}</span>
          <span className={styles.sub}>{t("stats.longest", { value: stats.longest_streak })}</span>
        </div>
      </div>
    </div>
  );
}
