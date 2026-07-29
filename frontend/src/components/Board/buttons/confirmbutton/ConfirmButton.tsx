import { motion } from "motion/react";
import styles from "./ConfirmButton.module.css";

interface ConfirmButtonProps {
  onClick?: () => void;
}

export default function ConfirmButton({ onClick }: ConfirmButtonProps) {
  return (
    <motion.button
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      onClick={onClick}
      className={styles.button}
      whileHover={{
        scale: 1.1,
        boxShadow:
          "0 4px 24px rgba(0,0,0,0.8), 0 0 30px rgba(201,169,97,0.4)",
      }}
      whileTap={{ scale: 0.95 }}
      title="Confirm and end your turn"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#7cd69a"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </motion.button>
  );
}
