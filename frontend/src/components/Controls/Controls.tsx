import styles from "./Controls.module.css";
import { type GameState, type Color } from "@/lib/backgammon/engine";
import { useI18n } from "../../i18n/I18nProvider";
import DoublingCube from "../DoublingCube";

interface ControlsProps {
  playerColor: Color;
  state: GameState;
}

export default function Controls({ state }: ControlsProps) {
  const { t, locale } = useI18n();
  const he = locale === 'he';

  return (
    <div className={styles.controlsContainer}>
      {state.gameFormat && <div className={styles.label}>
        <strong>{state.gameFormat === 'money' ? (he ? 'מטבעות לנקודה' : 'Money game') : (he ? 'סדרה בסכום קבוע' : 'Fixed-stake match')}</strong>
        <div>{state.stake} 6B · {he ? 'הפסד מרבי' : 'Max loss'}: {state.lossLimit} 6B</div>
        {state.crawfordGame && <div>Crawford — {he ? 'ללא הכפלה במשחק הזה' : 'No doubling this game'}</div>}
      </div>}
      {state.doublingEnabled !== false && (
        <div className={styles.cubeBlock}>
          <span className={styles.label}>{t("common.doublingCube")}</span>
          <DoublingCube value={state.cube} owner={state.cubeOwner} />
        </div>
      )}
    </div>
  );
}
