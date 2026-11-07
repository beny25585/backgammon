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
  analysisReady?: boolean;
}

export function ResultMetricRow({
  left,
  label,
  right,
  leftClassName,
  rightClassName,
  loading = false,
  analysisReady = false,
}: MetricRowProps) {
  const placeholder = (
    <span
      aria-hidden="true"
      data-testid="result-metric-loading"
      className="inline-block h-[0.8em] w-[min(65%,56px)] rounded-full bg-linear-to-r from-[#c09b63]/30 via-[#e5c896]/55 to-[#c09b63]/30 ring-1 ring-[#ddc8a2]/30 ring-inset motion-safe:animate-pulse"
    />
  );
  const valueStyle = analysisReady
    ? " motion-safe:starting:opacity-0 motion-safe:transition-opacity motion-safe:duration-150 motion-safe:ease-[cubic-bezier(0.23,1,0.32,1)]"
    : "";
  return (
    <div className={styles.resultRow} aria-busy={loading}>
      <span key={analysisReady ? "left-ready" : "left"} className={`${styles.playerValue} ${leftClassName ?? ""}${valueStyle}`}>
        {loading ? placeholder : left}
      </span>
      <span className={styles.metricLabel} dir="auto">{label}</span>
      <span key={analysisReady ? "right-ready" : "right"} className={`${styles.opponentValue} ${rightClassName ?? ""}${valueStyle}`}>
        {loading ? placeholder : right}
      </span>
    </div>
  );
}

interface MatchDetailRowProps {
  label: string;
  value: React.ReactNode;
  separator?: string;
}

export function MatchDetailRow({ label, value, separator = ":" }: MatchDetailRowProps) {
  return (
    <div className={styles.resultRowCentered}>
      <span className={styles.resultCenteredValue} dir="ltr">
        <span dir="auto">{label}{separator}</span>{" "}
        <span dir="auto">{value}</span>
      </span>
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
