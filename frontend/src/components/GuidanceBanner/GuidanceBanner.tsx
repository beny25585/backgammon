import { useEffect, useState } from "react";
import BoardActionButton from "../Board/buttons/BoardActionButton";
import BoardHalfOverlay from "../Board/BoardHalfOverlay";
import type { Color, GameState } from "@/lib/backgammon/engine";
import { getGuidance } from "./guidance";
import type { GuidanceVariant } from "./guidance";
import { useI18n } from "../../i18n/I18nProvider";

export interface GuidanceMessage {
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
  const [responding, setResponding] = useState(false);

  const guidance = message
    ? { ...message, interactive: null }
    : state && playerColor
      ? getGuidance(state, playerColor)
      : null;
  const isDecision = guidance?.interactive === "double";

  useEffect(() => {
    setResponding(false);
  }, [guidance?.variant, guidance?.textKey]);

  if (!guidance) return null;

  if (!message && !isDecision) return null;

  const respond = (accept: boolean) => {
    if (responding) return;
    setResponding(true);
    respondToDouble?.(accept);
  };

  const text = t(guidance.textKey);

  if (isDecision) {
    return (
      <div
        className={`pointer-events-none z-45 grid ${boardAligned ? "col-span-full row-start-1 grid-cols-subgrid" : "absolute inset-0 grid-cols-[minmax(0,1fr)_0px_minmax(0,1fr)_0px]"}`}
        data-testid="guidance-banner"
        data-variant={guidance.variant}
        role="dialog"
        aria-label={text}
      >
        <span className="sr-only" data-testid="guidance-text" dir={direction} lang={locale}>{text}</span>
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

  return (
    <div
      className={inline ? "pointer-events-none relative w-full" : "pointer-events-none absolute top-3 left-1/2 z-45 w-[calc(100%_-_32px)] max-w-56 -translate-x-1/2"}
    >
      <div
        className={`pointer-events-none flex min-h-7 w-full items-center justify-center rounded-md border px-2 py-0.75 shadow-[0_5px_14px_#00000047] ${guidance.variant === "no-moves" ? "border-[#ec7485b3] bg-[#2d1014f5]" : "border-[#e5b44db8] bg-[#08171bf7]"}`}
        data-testid="guidance-banner"
        data-variant={guidance.variant}
        role="status"
      >
        <span
          className="pointer-events-none text-center text-[clamp(11px,1.55cqw,13px)] leading-[1.35] font-semibold text-[#fff8eb] [unicode-bidi:plaintext]"
          data-testid="guidance-text"
          dir={direction}
          lang={locale}
        >
          {text}
        </span>
      </div>
    </div>
  );
}
