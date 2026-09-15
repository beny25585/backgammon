import styles from "./GameResult.module.css";

interface ResultComparisonProps {
  children: React.ReactNode;
}

export function ResultComparison({ children }: ResultComparisonProps) {
  return <div className={styles.resultTable} dir="ltr">{children}</div>;
}

interface MetricRowProps {
  left: React.ReactNode;
  label: string;
  right: React.ReactNode;
  leftClassName?: string;
  rightClassName?: string;
}

export function ResultMetricRow({ left, label, right, leftClassName, rightClassName }: MetricRowProps) {
  return (
    <div className={styles.resultRow}>
      <span className={`${styles.playerValue} ${leftClassName ?? ""}`}>{left}</span>
      <span className={styles.metricLabel}>{label}</span>
      <span className={`${styles.opponentValue} ${rightClassName ?? ""}`}>{right}</span>
    </div>
  );
}

interface MatchDetailRowProps {
  label: string;
  value: React.ReactNode;
}

export function MatchDetailRow({ label, value }: MatchDetailRowProps) {
  return (
    <div className={styles.resultRowCentered}>
      <span className={styles.resultCenteredValue}>{label}: {value}</span>
    </div>
  );
}

interface RatingChangeProps {
  before: number;
  change: number;
  after: number;
}

export function RatingChange({ before, change, after }: RatingChangeProps) {
  const deltaText = change > 0 ? `+${change}` : String(change);
  const deltaClass = change > 0 ? styles.adv : change < 0 ? styles.elim : "";
  return (
    <span className={styles.ratingChange}>
      <span className={`${styles.ratingDelta} ${deltaClass}`}>{deltaText}</span>
      <span className={styles.ratingTransition}>{before} → {after}</span>
    </span>
  );
}
