import styles from "./Controls.module.css";
import { canOfferDouble, type GameState, type Color } from "@/lib/backgammon/engine";
import { useGame } from "../../services/gameContext";
import { useI18n } from "../../i18n/I18nProvider";
import DoublingCube from "../DoublingCube";

interface ControlsProps {
  playerColor: Color;
  state: GameState;
}

export default function Controls({ playerColor, state }: ControlsProps) {
  const { offerDouble } = useGame();
  const { t } = useI18n();
  const canDouble = canOfferDouble(state, playerColor);

  return (
    <div className={styles.controlsContainer}>
      {state.doublingEnabled !== false && (
        <div className={styles.cubeBlock}>
          <span className={styles.label}>{t("common.doublingCube")}</span>
          <DoublingCube value={state.cube} owner={state.cubeOwner} />
        </div>
      )}

      {canDouble && (
        <button
          className={`${styles.btn} ${styles.secondary}`}
          onClick={offerDouble}
          title={t("common.offerDouble")}
        >
          ✕2 Double
        </button>
      )}
    </div>
  );
}
