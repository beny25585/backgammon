import styles from "./DoublingCube.module.css";
import type { Color } from "@/lib/backgammon/engine";

interface DoublingCubeProps {
  value: number;
  owner: Color | "center";
}

export default function DoublingCube({ value, owner }: DoublingCubeProps) {
  const ownerColor = owner === "center" ? "neutral" : owner;
  const ownerLabel = owner === "center" ? "Center" : owner === "white" ? "You" : "Bot";

  return (
    <div className={styles.cubeContainer}>
      <div
        className={`${styles.cubeFace} ${styles[ownerColor]}`}
        title={`Cube value: ${value}, Owner: ${owner}`}
      >
        {value}
      </div>
      <span className={styles.ownerLabel}>{ownerLabel}</span>
    </div>
  );
}
