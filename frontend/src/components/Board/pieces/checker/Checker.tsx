import { motion } from "motion/react";
import styles from "./Checker.module.css";

interface CheckerProps {
  color: "white" | "black";
  label?: string;
  instant?: boolean;
}

export default function Checker({ color, label, instant }: CheckerProps) {
  return (
    <motion.div
      layout
      initial={instant ? false : { scale: 0.5, opacity: 0, y: -8 }}
      animate={{
        scale: 1,
        opacity: 1,
        y: 0,
      }}
      transition={
        instant
          ? { duration: 0 }
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
