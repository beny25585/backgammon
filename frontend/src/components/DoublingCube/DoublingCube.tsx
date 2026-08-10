import { useState, useEffect, useRef } from "react";
import styles from "./DoublingCube.module.css";
import RollingDie from "@animations/RollingDie/RollingDie";
import type { Color } from "@/lib/backgammon/engine";
import { useGame } from "../../services/gameContext";

/*
 * HOW TO CHANGE THE CUBE STYLE
 * ----------------------------
 * - Number colors: edit the CUBE_COLORS map below. Values are powers of two.
 * - Flip & roll: when `value` changes, the cube rotates (no spin) to the new
 *   value via RollingDie with spins={false}. Change the transition for speed.
 * - Face: edit the CSS in DoublingCube.module.css (.cubeFace).
 */

const CUBE_COLORS: Record<number, string> = {
  1: "#9ca3af", // center / unused
  2: "#e74c3c", // red
  4: "#2e86de", // blue
  8: "#27ae60", // green
  16: "#d35400", // orange
  32: "#8e44ad", // purple
  64: "#e7bd72", // gold
};

const SIZES = { width: "clamp(32px, 5vw, 48px)", height: "clamp(32px, 5vw, 48px)" };

interface DoublingCubeProps {
  value: number;
  owner: Color | "center";
}

export default function DoublingCube({ value, owner }: DoublingCubeProps) {
  const [rolling, setRolling] = useState(false);
  const prevValue = usePrevious(value);
  const { whiteName, blackName } = useGame();

  useEffect(() => {
    if (prevValue !== null && prevValue !== value) {
      setRolling(true);
    }
  }, [value, prevValue]);

  const ownerLabel =
    owner === "center"
      ? "Center"
      : owner === "white"
        ? whiteName || "White"
        : blackName || "Black";
  const color = CUBE_COLORS[value] ?? "#9ca3af";

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
          title={`Cube value: ${value}, Owner: ${owner}`}
          style={{ color, width: SIZES.width, height: SIZES.height }}
        >
          {value}
        </div>
      )}
      <span className={styles.ownerLabel}>{ownerLabel}</span>
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
