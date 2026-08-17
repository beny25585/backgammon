import { motion } from "motion/react";
import styles from "./UndoButton.module.css";

interface UndoButtonProps {
  onClick?: () => void;
}

export default function UndoButton({ onClick }: UndoButtonProps) {
  return (
    <motion.button
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      onClick={onClick}
      className={styles.button}
      whileHover={{
        scale: 1.1,
        boxShadow: "0 4px 24px rgba(0,0,0,0.8), 0 0 30px rgba(201,169,97,0.4)",
      }}
      whileTap={{ scale: 0.95 }}
      title="Undo last move"
    >
      <p>UNDO</p>
    </motion.button>
  );
}
