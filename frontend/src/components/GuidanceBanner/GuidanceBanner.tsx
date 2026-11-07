import { useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import BoardActionButton from "../Board/buttons/BoardActionButton";
import BoardHalfOverlay from "../Board/BoardHalfOverlay";
import type { Color, GameState } from "@/lib/backgammon/engine";
import { getGuidance } from "./guidance";
import type { GuidanceVariant } from "./guidance";
import { useI18n } from "../../i18n/I18nProvider";

export interface GuidanceMessage {
  id?: string;
  /** Local visual deadline; never controls game or turn timing. */
  expiresAt?: number;
  variant: GuidanceVariant;
  textKey: string;
}

interface GuidanceBannerProps {
  state?: GameState;
  playerColor?: Color;
  respondToDouble?: (accept: boolean) => void;
  message?: GuidanceMessage | null;
  inline?: boolean;
  boardAligned?: boolean;
}
export default function GuidanceBanner({
  state,
  playerColor,
  respondToDouble,
  message,
  inline = false,
  boardAligned = false,
}: GuidanceBannerProps) {
  const { t, locale, direction } = useI18n();
  const reduceMotion = useReducedMotion() === true;
  const guidance = message
    ? { ...message, interactive: null }
    : state && playerColor
      ? getGuidance(state, playerColor)
      : null;
  if (!guidance || (!message && guidance.interactive !== "double")) return null;

  const text = t(guidance.textKey);

  if (guidance.interactive === "double" && state) {
    return <DoubleDecision
      key={`${state.doubleOfferedBy}:${state.cube}`}
      boardAligned={boardAligned}
      text={text}
      nextCubeValue={state.cube * 2}
      onRespond={respondToDouble}
    />;
  }

  return (
    <div
      className={inline ? "pointer-events-none relative w-full" : "pointer-events-none absolute top-3 left-1/2 z-45 w-[calc(100%_-_32px)] max-w-56 -translate-x-1/2"}
    >
      <motion.div
        key={message?.id ?? guidance.textKey}
        initial={{ opacity: 0.35, transform: reduceMotion ? "none" : "translateY(4px)" }}
        animate={{ opacity: 1, transform: "none" }}
        transition={{ duration: reduceMotion ? 0.1 : 0.16, ease: [0.23, 1, 0.32, 1] }}
        className={`pointer-events-none flex min-h-9 w-full items-center justify-center rounded-md border px-2 py-1 shadow-[0_5px_14px_#00000047] ${guidance.variant === "no-moves" ? "border-[#d98274]/70 bg-[#301c17]" : "border-[#d6ab65]/55 bg-[#261d16]"}`}
        data-testid="guidance-banner"
        data-variant={guidance.variant}
        role="status"
      >
        <span
          className="pointer-events-none block min-w-0 max-w-full whitespace-normal text-center text-[clamp(14px,1.8cqw,16px)] leading-[1.45] font-semibold text-[#fff8eb] [overflow-wrap:anywhere] [unicode-bidi:plaintext]"
          data-testid="guidance-text"
          dir={direction}
          lang={locale}
        >
          {text}
        </span>
      </motion.div>
    </div>
  );
}

function DoubleDecision({ boardAligned, text, nextCubeValue, onRespond }: {
  boardAligned: boolean;
  text: string;
  nextCubeValue: number;
  onRespond?: (accept: boolean) => void;
}) {
  const { t, locale, direction } = useI18n();
  const reduceMotion = useReducedMotion() === true;
  const [responding, setResponding] = useState(false);
  const sent = useRef(false);
  const valueText = t("guidance.doubleValue", { value: nextCubeValue });

  function respond(accept: boolean) {
    if (sent.current) return;
    sent.current = true;
    setResponding(true);
    onRespond?.(accept);
  }

  return (
    <div
      className={`pointer-events-none z-45 grid ${boardAligned ? "col-span-full row-start-1 grid-cols-subgrid" : "absolute inset-0 grid-cols-[minmax(0,1fr)_0px_minmax(0,1fr)_0px]"}`}
      data-testid="guidance-banner"
      data-variant="double"
      role="dialog"
      aria-label={`${text} ${valueText}`}
    >
      <div className="col-span-3 col-start-1 row-start-1 flex min-w-0 items-center justify-center">
        <motion.div
          data-testid="doubling-offer-summary"
          initial={{ opacity: 0.35 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reduceMotion ? 0.1 : 0.18, ease: [0.23, 1, 0.32, 1] }}
          className="relative bottom-[calc(var(--board-bar-cube-size,38px)/2+6px)] -translate-y-1/2 rounded-lg border border-[#d6ab65]/50 bg-[#261d16] px-3 py-1.5 text-center text-[clamp(11px,1.55cqw,14px)] leading-tight font-semibold text-[#ffe7bb] shadow-[0_4px_12px_#0007]"
          dir={direction}
          lang={locale}
        >
          <span className="block" data-testid="guidance-text">{text}</span>
          <span className="mt-0.5 block text-[#e1b978]">{valueText}</span>
        </motion.div>
      </div>
      <BoardHalfOverlay side="left">
        <BoardActionButton onClick={() => respond(false)} disabled={responding}
          data-testid="double-decline" title={t("common.passDouble")}>
          {t("common.pass")}
        </BoardActionButton>
      </BoardHalfOverlay>
      <BoardHalfOverlay side="right">
        <BoardActionButton variant="primary" onClick={() => respond(true)} disabled={responding}
          data-testid="double-accept" title={t("common.takeDouble")}>
          {responding ? t("common.sending") : t("common.take")}
        </BoardActionButton>
      </BoardHalfOverlay>
    </div>
  );
}
