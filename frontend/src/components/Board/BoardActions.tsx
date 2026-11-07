import { useI18n } from "../../i18n/I18nProvider";
import type { ReactNode } from "react";
import UndoButton from "./buttons/undobutton/UndoButton";
import ConfirmButton from "./buttons/confirmbutton/ConfirmButton";
import BoardActionButton from "./buttons/BoardActionButton";
import BoardHalfOverlay, { type BoardSide } from "./BoardHalfOverlay";
import GuidanceBanner from "../GuidanceBanner";
import type { GuidanceMessage } from "../GuidanceBanner/GuidanceBanner";
import IllustratedTurnNotice, { type IllustratedNoticeAsset } from "../TurnNotice/IllustratedTurnNotice";
import { useBoardMaterials } from "./materials/boardMaterialContext";

const barBlockedAsset: IllustratedNoticeAsset = {
  id: "bar-blocked",
  url: `${import.meta.env.BASE_URL}assets/notices/bar-blocked.png`,
  width: 1586,
  height: 992,
};
const noMovesAsset: IllustratedNoticeAsset = {
  id: "no-legal-moves",
  url: `${import.meta.env.BASE_URL}assets/notices/no-legal-moves.png`,
  width: 1586,
  height: 992,
};
const barClosedAsset: IllustratedNoticeAsset = {
  id: "all-entries-blocked",
  url: `${import.meta.env.BASE_URL}assets/notices/all-entries-blocked.png`,
  width: 1586,
  height: 992,
};
const forcedMoveAsset: IllustratedNoticeAsset = {
  id: "only-one-move",
  url: `${import.meta.env.BASE_URL}assets/notices/only-one-move.png`,
  width: 1586,
  height: 992,
};
const illustratedNoticeAssets: Partial<Record<string, IllustratedNoticeAsset>> = {
  "guidance.barBlocked": barBlockedAsset,
  "guidance.barBlockedOpponent": barBlockedAsset,
  "guidance.barClosed": barClosedAsset,
  "guidance.barClosedOpponent": barClosedAsset,
  "guidance.noMoves": noMovesAsset,
  "guidance.noMovesOpponent": noMovesAsset,
  "guidance.forced": forcedMoveAsset,
};

interface Props {
  canUndo: boolean;
  canConfirm: boolean;
  canRoll: boolean;
  canDouble: boolean;
  doublingEnabled?: boolean;
  onUndo: () => void;
  onConfirm?: () => void;
  onRoll?: () => void;
  autoRollCountdown?: number | null;
  onDouble?: () => void;
  turnNotice?: GuidanceMessage | null;
  noticeSide?: BoardSide;
  noticeDetails?: ReactNode;
  rollDetails?: Partial<Record<BoardSide, ReactNode>>;
}

export default function BoardActions({ noticeSide = "left", doublingEnabled = true, ...props }: Props) {
  const { t, locale, direction } = useI18n();
  const { theme } = useBoardMaterials();
  const noticeAsset = props.turnNotice ? illustratedNoticeAssets[props.turnNotice.textKey] ?? null : null;
  const illustratedNotice = noticeAsset !== null;
  const isForcedNotice = props.turnNotice?.variant === "forced";
  const leftAction = props.canUndo ? {
    id: "board-undo-action",
    content: <UndoButton onClick={props.onUndo} />,
  } : props.canRoll && doublingEnabled ? {
    id: "board-double-action",
    content: <BoardActionButton onClick={props.onDouble} disabled={!props.canDouble}
      title={t("common.offerDouble")} aria-label={t("common.offerDouble")}>
      {t("common.offerDoubleShort")}
    </BoardActionButton>,
  } : null;
  const rightAction = props.canConfirm ? {
    id: "board-confirm-action",
    content: <ConfirmButton onClick={props.onConfirm} />,
  } : props.canRoll ? {
    id: "board-roll-action",
    content: <div className="relative flex w-full min-w-0 flex-col items-center" dir={direction}>
      <BoardActionButton variant="primary" onClick={props.onRoll}
        title={t("common.tapToRoll")} aria-label={t("common.tapToRoll")}
        className={theme === "brownGold" ? "" : "[--board-primary-surface:linear-gradient(180deg,#f4d58d,#d3a64d)] [--ui-on-accent:#241b0b] [--ui-accent-border:#efce84cc] [--ui-accent-hover:#ffe6ad] [&_[data-button-surface]]:rounded-lg"}>
        {t("game.rollNow")}
      </BoardActionButton>
      {props.autoRollCountdown != null && (
        <span className="pointer-events-none absolute top-[calc(100%_+_4px)] left-1/2 -translate-x-1/2 rounded-md border border-[var(--ui-secondary-border,#d3b16d4d)] bg-[var(--ui-secondary-bg,#101515)] px-2 py-1 text-[clamp(10px,1.4cqw,11px)] leading-none text-[#ead6b7] shadow-[0_2px_5px_#00000040] motion-safe:transition-opacity motion-safe:duration-150 motion-safe:starting:opacity-50"
          data-testid="auto-roll-countdown">
          <span className="sr-only">{t("game.autoRollCountdown", { seconds: props.autoRollCountdown })}</span>
          <span aria-hidden="true" className="inline-flex items-center gap-1 whitespace-nowrap">
            <svg className="size-3 shrink-0 text-[#c8a66a]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.5V12l3 1.75" />
            </svg>
            <span className="font-medium">{t("game.autoRollShort")}</span>
            <bdi className="min-w-[3ch] text-start font-bold tabular-nums text-[#f0ce85]" dir="ltr">{t("game.autoRollSeconds", { seconds: props.autoRollCountdown })}</bdi>
          </span>
        </span>
      )}
    </div>,
  } : null;
  const noticeAction = isForcedNotice ? null : noticeSide === "left" ? leftAction : rightAction;
  return (
    <>
        <BoardHalfOverlay side={noticeSide} className={props.turnNotice ? "" : "invisible"}>
          <div
            className={`pointer-events-none relative w-[calc(100%_-_16px)] max-w-56 ${illustratedNotice ? "min-h-9" : ""}`}
            data-testid={props.turnNotice ? props.turnNotice.variant === "no-moves" ? "no-moves-overlay" : "forced-move-notice" : undefined}
          >
            <div className={`pointer-events-none absolute inset-x-0 ${isForcedNotice ? "bottom-[calc(50%+var(--board-live-die-size,52px)/2+8px)]" : "bottom-0"} ${illustratedNotice ? "" : "invisible"}`}>
              <IllustratedTurnNotice
                active={illustratedNotice}
                asset={noticeAsset}
                eventKey={`${noticeAsset?.id ?? ""}:${props.turnNotice?.id ?? props.turnNotice?.textKey ?? ""}`}
                expiresAt={props.turnNotice?.expiresAt}
                variant={props.turnNotice?.variant ?? "no-moves"}
                text={props.turnNotice ? t(props.turnNotice.textKey) : ""}
                locale={locale}
                direction={direction}
              />
            </div>
            {props.turnNotice && !illustratedNotice && <GuidanceBanner message={props.turnNotice} inline />}
            {props.turnNotice && (props.noticeDetails || noticeAction || props.rollDetails?.[noticeSide]) && (
              <div className="absolute top-[calc(100%_+_8px)] left-1/2 flex w-full -translate-x-1/2 flex-col items-center gap-2" data-testid="turn-notice-details">
                {props.noticeDetails}
                {props.rollDetails?.[noticeSide]}
                {noticeAction && (
                  <div className="flex w-full justify-center" data-testid={noticeAction.id}>
                    {noticeAction.content}
                  </div>
                )}
              </div>
            )}
          </div>
        </BoardHalfOverlay>
      {(["left", "right"] as const).map(side => {
        const action = side === "left" ? leftAction : rightAction;
        const dice = props.rollDetails?.[side];
        if ((!action && !dice) || (props.turnNotice && !isForcedNotice && noticeSide === side)) return null;
        return (
          <BoardHalfOverlay key={side} side={side}>
            {dice ? (
              <div className="relative flex min-w-0 flex-col items-center gap-2">
                {dice}
                {action && (
                  <div className="absolute top-[calc(100%_+_8px)] left-1/2 flex -translate-x-1/2 justify-center" data-testid={action.id}>
                    {action.content}
                  </div>
                )}
              </div>
            ) : action && (
              <div data-testid={action.id}>{action.content}</div>
            )}
          </BoardHalfOverlay>
        );
      })}
    </>
  );
}
