import styles from "./Controls.module.css";
import { type GameState, type Color } from "@/lib/backgammon/engine";
import { useI18n } from "../../i18n/I18nProvider";
import DoublingCube from "../DoublingCube";

interface ControlsProps {
  playerColor: Color;
  state: GameState;
}

export default function Controls({ state }: ControlsProps) {
  const { t } = useI18n();

  return (
    <div className={styles.controlsContainer}>
      {state.doublingEnabled !== false && (
        <div className={styles.cubeBlock}>
          <span className={styles.label}>{t("common.doublingCube")}</span>
          <DoublingCube value={state.cube} owner={state.cubeOwner} />
        </div>
      )}
    </div>
  );
}
