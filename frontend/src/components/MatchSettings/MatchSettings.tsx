import { useState } from "react";
import { motion } from "motion/react";
import type { Color } from "@/lib/backgammon/engine";
import styles from "./MatchSettings.module.css";

interface MatchSettingsProps {
  onStart: (settings: { botColor: Color; target: number }) => void;
  onCancel: () => void;
}

const TARGETS = [1, 3, 5, 7, 9, 11, 13, 15, 21];

export default function MatchSettings({
  onStart,
  onCancel,
}: MatchSettingsProps) {
  const [botColor, setBotColor] = useState<Color>("black");
  const [target, setTarget] = useState(7);

  return (
    <motion.div
      className={styles.overlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <motion.div
        className={styles.card}
        initial={{ scale: 0.85, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 16 }}
      >
        <h2 className={styles.title}>
          Match Settings
        </h2>

        {/* ── Player color ─────────────────────────── */}
        <div className={styles.sectionLabel}>
          <p>Play as</p>
        </div>
        <div className={styles.buttonRow}>
          {(["white", "black"] as Color[]).map((c) => (
            <button
              key={c}
              onClick={() => setBotColor(c === "black" ? "white" : "black")}
              className={`${styles.colorBtn} ${botColor !== c ? styles.colorBtnInactive : styles.colorBtnActive}`}
            >
              {c === "white" ? "White (first)" : "Black (second)"}
            </button>
          ))}
        </div>

        {/* ── Match target ─────────────────────────── */}
        <div className={styles.sectionLabel}>
          <p>{target === 1 ? "Single Game" : `First to ${target} points`}</p>
        </div>
        <div className={styles.targetGrid}>
          {TARGETS.map((t) => (
            <button
              key={t}
              onClick={() => setTarget(t)}
              className={`${styles.targetBtn} ${target === t ? styles.targetBtnActive : styles.targetBtnInactive}`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* ── Actions ──────────────────────────────── */}
        <div className={styles.actions}>
          <button onClick={onCancel} className={styles.cancelBtn}>
            Cancel
          </button>
          <button
            onClick={() => onStart({ botColor, target })}
            className={styles.startBtn}
          >
            Start Match
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
