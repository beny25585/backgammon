import { useI18n } from "../../i18n/I18nProvider";
import type { ReactNode } from "react";
import UndoButton from "./buttons/undobutton/UndoButton";
import ConfirmButton from "./buttons/confirmbutton/ConfirmButton";
import BoardActionButton from "./buttons/BoardActionButton";
import BoardHalfOverlay, { type BoardSide } from "./BoardHalfOverlay";
import GuidanceBanner from "../GuidanceBanner";
import type { GuidanceMessage } from "../GuidanceBanner/GuidanceBanner";
import IllustratedTurnNotice, { type IllustratedNoticeAsset } from "../TurnNotice/IllustratedTurnNotice";

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
  onUndo: () => void;
  onConfirm?: () => void;
  onRoll?: () => void;
  onDouble?: () => void;
  turnNotice?: GuidanceMessage | null;
  noticeSide?: BoardSide;
  noticeDetails?: ReactNode;
  rollDetails?: Partial<Record<BoardSide, ReactNode>>;
}

export default function BoardActions({ noticeSide = "left", ...props }: Props) {
  const { t, locale, direction } = useI18n();
  const noticeAsset = props.turnNotice ? illustratedNoticeAssets[props.turnNotice.textKey] ?? null : null;
  const illustratedNotice = noticeAsset !== null;
  const isForcedNotice = props.turnNotice?.variant === "forced";
  const leftAction = props.canUndo ? {
    id: "board-undo-action",
    content: <UndoButton onClick={props.onUndo} />,
  } : props.canRoll ? {
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
    content: <BoardActionButton variant="primary" onClick={props.onRoll}
      title={t("common.tapToRoll")} aria-label={t("common.tapToRoll")}>
      {t("game.rollNow")}
    </BoardActionButton>,
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
