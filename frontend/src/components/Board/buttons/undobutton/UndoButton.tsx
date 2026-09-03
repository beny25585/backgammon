import { motion } from "motion/react";
import { useI18n } from "../../../../i18n/I18nProvider";
import styles from "./UndoButton.module.css";

interface UndoButtonProps {
  onClick?: () => void;
}

export default function UndoButton({ onClick }: UndoButtonProps) {
  const { t } = useI18n();

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
      title={t("common.undoMove")}
    >
      <p>{t("common.undo")}</p>
    </motion.button>
  );
}
