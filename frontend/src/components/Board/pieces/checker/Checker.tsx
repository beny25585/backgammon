import { memo } from "react";
import styles from "./Checker.module.css";

interface CheckerProps {
  color: "white" | "black";
  label?: string;
}

function Checker({ color, label }: CheckerProps) {
  return (
    <div
      data-checker
      className={`${styles.checker} ${
        color === "white" ? styles.white : styles.black
      }`}
    >
      {label && <span className={styles.label}>{label}</span>}
    </div>
  );
}

export default memo(Checker);
