import { useState, useEffect, useRef } from "react";
import styles from "./DoublingCube.module.css";
import RollingDie from "@animations/RollingDie/RollingDie";
import type { Color } from "@/lib/backgammon/engine";
import { useI18n } from "../../i18n/I18nProvider";
import { useOptionalGame } from "../../services/gameContext";

/*
 * HOW TO CHANGE THE CUBE STYLE
 * ----------------------------
 * - Number colors: edit the CUBE_COLORS map below. Values are powers of two.
 * - Flip & roll: when `value` changes, the cube rotates (no spin) to the new
 *   value via RollingDie with spins={false}. Change the transition for speed.
 * - Face: edit the CSS in DoublingCube.module.css (.cubeFace).
 */

const CUBE_COLORS: Record<number, string> = {
  1: "#a47b36",
  2: "#e74c3c",
  4: "#d4941a",
  8: "#e5b44d",
  16: "#f1dfb7",
  32: "#f7f1e7",
  64: "#fff4cf",
};

const SIZES = { width: "clamp(32px, 13cqw, 48px)", height: "clamp(32px, 13cqw, 48px)" };

interface DoublingCubeProps {
  value: number;
  owner: Color | "center";
  showOwner?: boolean;
}

export default function DoublingCube({ value, owner, showOwner = true }: DoublingCubeProps) {
  const { t } = useI18n();
  const game = useOptionalGame();
  const [rolling, setRolling] = useState(false);
  const prevValue = usePrevious(value);

  useEffect(() => {
    if (prevValue !== null && prevValue !== value) {
      setRolling(true);
    }
  }, [value, prevValue]);

  const ownerLabel =
    owner === "center"
      ? t("common.center")
      : owner === "white"
        ? game
          ? game.whiteName || t("common.white")
          : t("common.you")
        : game
          ? game.blackName || t("common.black")
          : t("common.opponent");
  const color = CUBE_COLORS[value] ?? "#d4941a";

  return (
    <div className={styles.cubeContainer}>
      {rolling ? (
        <RollingDie
          rolling
          count={1}
          variant="value"
          value={value}
          valueColor={color}
          landOn={[value]}
          spins={false}
          onRollComplete={() => setRolling(false)}
        />
      ) : (
        <div
          className={styles.cubeFace}
          data-testid="doubling-cube"
          title={t("common.cubeTitle", { value, owner: ownerLabel })}
          style={{ color, width: SIZES.width, height: SIZES.height }}
        >
          {value}
        </div>
      )}
      {showOwner && <span className={styles.ownerLabel}>{ownerLabel}</span>}
    </div>
  );
}

/** Track the previous render's value so we can rotate on change. */
function usePrevious<T>(value: T): T | null {
  const ref = useRef<T | null>(null);
  const [prev, setPrev] = useState<T | null>(null);
  useEffect(() => {
    ref.current = value;
    setPrev(ref.current);
  }, [value]);
  return prev;
}
