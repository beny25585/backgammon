import { useEffect, useState } from "react";
import type { Color } from "../../lib/backgammon/engine";
import { useI18n } from "../../i18n/I18nProvider";
import { MatchDetailRow, ResultMetricRow } from "./ResultComparison";
import styles from "./GameResult.module.css";

interface PlayerAnalysis {
  color: Color;
  game_rating: number | string | null;
  pr: number | string | null;
  luck: number | string | null;
}
interface Analysis {
  id: string;
  room_id: string;
  created_at: string;
  status: "pending" | "processing" | "completed" | "failed";
  players: PlayerAnalysis[];
}
interface Props {
  roomId?: string;
  playerColor?: Color;
  ratingBefore?: number | null;
  ratingAfter?: number | null;
  ratingChange?: number | null;
  opponentRatingBefore?: number | null;
  opponentRatingAfter?: number | null;
  opponentRatingChange?: number | null;
  coinsDelta?: number | null;
  opponentCoinsDelta?: number | null;
  durationSeconds?: number | null;
}
const signed = (value: number) => `${value > 0 ? "+" : ""}${value}`;
const metric = (value: number | string | null | undefined, digits: number) => {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return "—";
  }

  const numeric = Number(value);

  return Number.isFinite(numeric) ? numeric.toFixed(digits) : "—";
};

function rating(
  before?: number | null,
  after?: number | null,
  change?: number | null,
) {
  const delta =
    change ?? (after != null && before != null ? after - before : null);
  return (
    <bdi dir="ltr">
      {after ?? before ?? "—"}
      {delta != null ? ` (${signed(delta)})` : ""}
    </bdi>
  );
}

export default function ResultSummary(props: Props) {
  const { t, direction } = useI18n();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const { roomId } = props;
  const base = new URL(
    import.meta.env.VITE_TOURNAMENTS_URL || "/tournaments/",
    window.location.origin,
  );
  const api = new URL("/tournaments-api/analyses", base);
  const apiOrigin = import.meta.env.DEV ? window.location.origin : api.origin;

  useEffect(() => {
    if (!roomId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    async function load() {
      attempts += 1;
      try {
        const response = await fetch(
          `${apiOrigin}/tournaments-api/analyses?room=${encodeURIComponent(roomId!)}`,
          {
            credentials: "include",
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error("Analysis unavailable");
        const data: { matches: Analysis[] } = await response.json();
        if (controller.signal.aborted) return;
        const match =
          data.matches
            .filter((item) => item.room_id === roomId)
            .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ??
          null;
        setAnalysis(match);
        setUnavailable(match?.status === "failed");
        if (match?.status === "completed" || match?.status === "failed") return;
      } catch {
        if (controller.signal.aborted) return;
        setUnavailable(true);
      }
      if (attempts < 60) timer = setTimeout(load, 5000);
      else setUnavailable(true);
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [roomId, apiOrigin]);

  const players = analysis?.status === "completed" ? analysis.players : [];
  const self = players.find((p) => p.color === (props.playerColor ?? "white"));
  const opponent = players.find(
    (p) => p.color !== (props.playerColor ?? "white"),
  );

  base.pathname = `${base.pathname.replace(/\/$/, "")}/analysis${analysis ? `/${encodeURIComponent(analysis.id)}` : ""}`;
  base.search = "";
  base.hash = "";
  if (roomId) base.searchParams.set("room", roomId);
  const duration = props.durationSeconds;
  const seconds = duration == null ? null : Math.max(0, Math.floor(duration));
  const time =
    seconds == null
      ? "—"
      : `${Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)}:` : ""}${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <>
      <ResultMetricRow
        label={t("game.gameRating")}
        left={metric(self?.game_rating, 0)}
        right={metric(opponent?.game_rating, 0)}
      />
      <ResultMetricRow
        label={t("game.pr")}
        left={metric(self?.pr, 2)}
        right={metric(opponent?.pr, 2)}
      />
      <ResultMetricRow
        label={t("game.rating")}
        left={rating(props.ratingBefore, props.ratingAfter, props.ratingChange)}
        right={rating(
          props.opponentRatingBefore,
          props.opponentRatingAfter,
          props.opponentRatingChange,
        )}
      />
      <ResultMetricRow
        label={t("game.coins")}
        left={
          <bdi>{props.coinsDelta == null ? "—" : signed(props.coinsDelta)}</bdi>
        }
        right={
          <bdi>
            {props.opponentCoinsDelta == null
              ? "—"
              : signed(props.opponentCoinsDelta)}
          </bdi>
        }
      />
      <ResultMetricRow
        label={t("game.luck")}
        left={<bdi>{metric(self?.luck, 3)}</bdi>}
        right={<bdi>{metric(opponent?.luck, 3)}</bdi>}
      />
      <div dir={direction}>
        <MatchDetailRow
          label={t("game.gameDuration")}
          value={<bdi dir="ltr">{time}</bdi>}
        />
      </div>

      <p className={styles.summaryNote} dir={direction} role="status">
        {analysis?.status === "completed"
          ? t("game.lowerPrExplanation")
          : !roomId || unavailable
            ? t("game.analysisUnavailable")
            : t("game.analysisInProgress")}
      </p>
      {roomId && (
        <a
          className={`${styles.secondaryAction} ${styles.analysisLink}`}
          href={base.href}
          dir={direction}
        >
          {t("game.fullAnalysis")}{" "}
        </a>
      )}
    </>
  );
}
