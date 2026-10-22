import { useI18n } from "../../i18n/I18nProvider";
import UndoButton from "./buttons/undobutton/UndoButton";
import ConfirmButton from "./buttons/confirmbutton/ConfirmButton";
import GuidanceBanner from "../GuidanceBanner";
import type { GuidanceMessage } from "../GuidanceBanner/GuidanceBanner";
import styles from "../GameScreen/GameScreen.module.css";

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
}

export default function BoardActions(props: Props) {
  const { t } = useI18n();
  return (
    <>
      {(props.turnNotice || props.canUndo || props.canRoll) && (
        <div
          className={
            props.turnNotice ? styles.boardTurnNotice : styles.boardUndoAction
          }
          data-testid={
            !props.turnNotice
              ? undefined
              : props.turnNotice.variant === "no-moves"
                ? "no-moves-overlay"
                : "forced-move-notice"
          }
        >
          {props.turnNotice && <GuidanceBanner message={props.turnNotice} inline />}
          <div className={props.turnNotice ? styles.boardNoticeActions : undefined}>
            {props.canUndo && <UndoButton onClick={props.onUndo} />}
            {props.canRoll && (
              <button
                type="button"
                className={`${styles.boardTurnButton} ${styles.boardTurnButtonSecondary}`}
                onClick={props.onDouble}
                disabled={!props.canDouble}
                title={t("common.offerDouble")}
                aria-label={t("common.offerDouble")}
              >
                {t("common.offerDoubleShort")}
              </button>
            )}
          </div>
        </div>
      )}
      {props.canConfirm && (
        <div className={styles.boardConfirmAction}>
          <ConfirmButton onClick={props.onConfirm} />
        </div>
      )}
      {props.canRoll && (
        <div className={styles.boardRollAction}>
          <button
            type="button"
            className={`${styles.boardTurnButton} ${styles.boardTurnButtonPrimary}`}
            onClick={props.onRoll}
            title={t("common.tapToRoll")}
            aria-label={t("common.tapToRoll")}
          >
            {t("game.rollNow")}
          </button>
        </div>
      )}
    </>
  );
}
