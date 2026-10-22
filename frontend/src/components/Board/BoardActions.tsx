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
}

export default function BoardActions({ noticeSide = "left", ...props }: Props) {
  const { t } = useI18n();
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
  const noticeAction = noticeSide === "left" ? leftAction : rightAction;
  return (
    <>
      {props.turnNotice && (
        <BoardHalfOverlay side={noticeSide}>
          <div
            className="pointer-events-none relative w-[calc(100%_-_16px)] max-w-56"
            data-testid={props.turnNotice.variant === "no-moves" ? "no-moves-overlay" : "forced-move-notice"}
          >
            <GuidanceBanner message={props.turnNotice} inline />
            {(props.noticeDetails || noticeAction) && (
              <div className="absolute top-[calc(100%_+_8px)] left-1/2 flex w-full -translate-x-1/2 flex-col items-center gap-2" data-testid="turn-notice-details">
                {props.noticeDetails}
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
      {leftAction && (!props.turnNotice || noticeSide !== "left") && (
        <BoardHalfOverlay side="left" data-testid={leftAction.id}>
          {leftAction.content}
        </BoardHalfOverlay>
      )}
      {rightAction && (!props.turnNotice || noticeSide !== "right") && (
        <BoardHalfOverlay side="right" data-testid={rightAction.id}>
          {rightAction.content}
        </BoardHalfOverlay>
      )}
    </>
  );
}
