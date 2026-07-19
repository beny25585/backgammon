import styles from "./DoublingCube.module.css";
import type { Color } from "@/lib/backgammon/engine";

interface DoublingCubeProps {
  value: number;
  owner: Color | "center";
}

export default function DoublingCube({ value, owner }: DoublingCubeProps) {
  const ownerColor = owner === "center" ? "neutral" : owner;
  const cubeValues = [1, 2, 4, 8, 16, 32];

  return (
    <div className={styles.cubeContainer}>
      <span className={styles.label}>Cube:</span>
      <div
        className={`${styles.cube} ${styles[ownerColor]}`}
        title={`Cube value: ${value}, Owner: ${owner}`}
      >
        <span className={styles.value}>{value}</span>
      </div>
      <div className={styles.availableValues}>
        {cubeValues.map((v) => (
          <span key={v} className={v === value ? styles.current : ""}>
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}
