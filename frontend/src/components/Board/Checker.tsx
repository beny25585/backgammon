import { motion } from "motion/react";
import styles from "./Checker.module.css";

export function Checker({ color, label }: { color: "white" | "black"; label?: string }) {
  return (
    <motion.div
      layout
      initial={{ scale: 0.5, opacity: 0, y: -8 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 22 }}
      className={`${styles.checker} ${color === "white" ? styles.white : styles.black}`}
    >
      {label}
    </motion.div>
  );
}
