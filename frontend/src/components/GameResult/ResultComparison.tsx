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
  loading?: boolean;
}

export function ResultMetricRow({ left, label, right, leftClassName, rightClassName, loading = false }: MetricRowProps) {
  const placeholder = (
    <span
      aria-hidden="true"
      data-testid="result-metric-loading"
      className="inline-block h-[0.85em] w-[clamp(42px,8cqw,72px)] rounded-full bg-gradient-to-r from-white/5 via-amber-300/20 to-white/5 motion-safe:animate-pulse"
    />
  );
  return (
    <div className={styles.resultRow} aria-busy={loading}>
      <span className={`${styles.playerValue} ${leftClassName ?? ""}`}>{loading ? placeholder : left}</span>
      <span className={styles.metricLabel}>{label}</span>
      <span className={`${styles.opponentValue} ${rightClassName ?? ""}`}>{loading ? placeholder : right}</span>
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

export function RatingChange({ change, after }: RatingChangeProps) {
  const deltaText = change > 0 ? `+${change}` : String(change);
  const deltaClass = change > 0 ? styles.adv : change < 0 ? styles.elim : "";
  return (
    <span className={styles.ratingChange}>
      <bdi dir="ltr">{after}</bdi> <span className={`${styles.ratingDelta} ${deltaClass}`}><bdi dir="ltr">({deltaText})</bdi></span>
    </span>
  );
}
