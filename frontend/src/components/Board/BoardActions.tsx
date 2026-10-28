import { useI18n } from "../../i18n/I18nProvider";
import type { ReactNode } from "react";
import UndoButton from "./buttons/undobutton/UndoButton";
import ConfirmButton from "./buttons/confirmbutton/ConfirmButton";
import BoardActionButton from "./buttons/BoardActionButton";
import BoardHalfOverlay, { type BoardSide } from "./BoardHalfOverlay";
import GuidanceBanner from "../GuidanceBanner";
import type { GuidanceMessage } from "../GuidanceBanner/GuidanceBanner";

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
  groupTurnActions?: boolean;
}

export default function BoardActions({ noticeSide = "left", ...props }: Props) {
  const { t } = useI18n();
  const groupedTurnActions = props.groupTurnActions && props.canConfirm && props.canUndo && !props.turnNotice;
  const leftAction = groupedTurnActions ? null : props.canUndo ? {
    id: "board-undo-action",
    content: <UndoButton onClick={props.onUndo} />,
  } : props.canRoll ? {
    id: "board-double-action",
    content: <BoardActionButton onClick={props.onDouble} disabled={!props.canDouble}
      title={t("common.offerDouble")} aria-label={t("common.offerDouble")}>
      {t("common.offerDoubleShort")}
    </BoardActionButton>,
  } : null;
  const rightAction = groupedTurnActions ? null : props.canConfirm ? {
    id: "board-confirm-action",
    content: <ConfirmButton onClick={props.onConfirm} />,
  } : props.canRoll ? {
    id: "board-roll-action",
    content: <BoardActionButton variant="primary" onClick={props.onRoll}
      title={t("common.tapToRoll")} aria-label={t("common.tapToRoll")}>
      {t("game.rollNow")}
    </BoardActionButton>,
  } : null;
  const noticeAction = noticeSide === "left" ? leftAction : rightAction;
  return (
    <>
      {groupedTurnActions && (
        <BoardHalfOverlay side="left">
          <div
            className="flex w-[276px] max-w-[calc(100%_-_8px)] items-center gap-4 [--group-action-height:54px] [--board-action-width:100%] [--board-action-face-height:var(--group-action-height)] [--board-action-font:20px] @max-[620px]/game-layout:w-[156px] @max-[620px]/game-layout:gap-1 @max-[620px]/game-layout:[--group-action-height:44px] @max-[620px]/game-layout:[--board-action-face-height:27px] @max-[620px]/game-layout:[--board-action-font:clamp(10px,1.8cqw,12px)] [@container_game-layout_(height<500px)]:w-[156px] [@container_game-layout_(height<500px)]:gap-1 [@container_game-layout_(height<500px)]:[--group-action-height:44px] [@container_game-layout_(height<500px)]:[--board-action-face-height:27px] [@container_game-layout_(height<500px)]:[--board-action-font:clamp(10px,1.8cqw,12px)]"
            data-testid="board-grouped-turn-actions"
          >
            <div className="min-w-0 flex-1 [&>button]:max-w-full" data-testid="board-confirm-action">
              <ConfirmButton onClick={props.onConfirm} labelKey="common.confirmMove" className="h-[var(--group-action-height)]" />
            </div>
            <div className="w-[60px] shrink-0 @max-[620px]/game-layout:w-11 [@container_game-layout_(height<500px)]:w-11 [&>button]:max-w-full" data-testid="board-undo-action">
              <UndoButton onClick={props.onUndo} iconOnly className="h-[var(--group-action-height)]" />
            </div>
          </div>
        </BoardHalfOverlay>
      )}
      {props.turnNotice && (
        <BoardHalfOverlay side={noticeSide}>
          <div
            className="pointer-events-none relative w-[calc(100%_-_16px)] max-w-56"
            data-testid={props.turnNotice.variant === "no-moves" ? "no-moves-overlay" : "forced-move-notice"}
          >
            <GuidanceBanner message={props.turnNotice} inline />
            {(props.noticeDetails || noticeAction || props.rollDetails?.[noticeSide]) && (
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
      )}
      {(["left", "right"] as const).map(side => {
        const action = side === "left" ? leftAction : rightAction;
        const dice = props.rollDetails?.[side];
        if ((!action && !dice) || (props.turnNotice && noticeSide === side)) return null;
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
