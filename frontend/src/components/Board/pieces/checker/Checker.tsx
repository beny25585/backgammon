import { motion } from "motion/react";
import styles from "./Checker.module.css";

interface CheckerProps {
  color: "white" | "black";
  label?: string;
  flyIn?: boolean;
}

export default function Checker({ color, label, flyIn }: CheckerProps) {
  return (
    <motion.div
      layout
      initial={
        flyIn
          ? {
              scale: 0,
              opacity: 0,
              y: -60,
            }
          : {
              scale: 0.5,
              opacity: 0,
              y: -8,
            }
      }
      animate={{
        scale: 1,
        opacity: 1,
        y: 0,
      }}
      transition={
        flyIn
          ? {
              type: "spring",
              stiffness: 260,
              damping: 16,
              mass: 0.8,
            }
          : {
              type: "spring",
              stiffness: 320,
              damping: 22,
            }
      }
      data-checker
      className={`${styles.checker} ${
        color === "white" ? styles.white : styles.black
      }`}
    >
      {label}
    </motion.div>
  );
}
