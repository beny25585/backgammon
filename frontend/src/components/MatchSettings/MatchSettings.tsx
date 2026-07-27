import { useState } from "react";
import { motion } from "motion/react";
import type { Color } from "@/lib/backgammon/engine";
import styles from "./MatchSettings.module.css";
import AnimatedTabs from "../animations/AnimatedTabs/AnimatedTabs";

interface MatchSettingsProps {
  mode: "online" | "bot";
  onStart: (settings: {
    botColor?: Color;
    target: number;
    preferredColor?: string;
  }) => void;
  onCancel: () => void;
}

const TARGETS = [1, 3, 5, 7, 9, 11, 13, 15, 21];

const colorTabs = [
  {
    id: "white",
    label: "White (first)",
  },
  {
    id: "black",
    label: "Black (second)",
  },
];

export default function MatchSettings({
  mode,
  onStart,
  onCancel,
}: MatchSettingsProps) {
  const [botColor, setBotColor] = useState<Color>("black");
  const [preferredColor, setPreferredColor] = useState<"white" | "black">(
    "white",
  );

  const [target, setTarget] = useState(7);

  const isOnline = mode === "online";

  const selectedColor = isOnline ? preferredColor : botColor;

  const handleColorChange = (id: string) => {
    if (isOnline) {
      setPreferredColor(id as "white" | "black");
    } else {
      setBotColor(id as Color);
    }
  };

  const targetTabs = TARGETS.map((t) => ({
    id: String(t),
    label: String(t),
  }));

  return (
    <motion.div
      className={styles.overlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      <motion.div
        className={styles.card}
        initial={{ scale: 0.5, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        transition={{
          type: "spring",
          stiffness: 200,
          damping: 16,
        }}
      >
        <h2 className={styles.title}>Match Settings</h2>

        {/* Color Selection */}
        <div className={styles.sectionLabel}>
          <p>Play as</p>
        </div>

        <AnimatedTabs
          tabs={colorTabs}
          activeTab={selectedColor}
          onChange={handleColorChange}
        />

        {/* Target Score */}
        <div className={styles.sectionLabel}>
          <p>{target === 1 ? "Single Game" : `First to ${target} points`}</p>
        </div>

        <AnimatedTabs
          tabs={targetTabs}
          activeTab={String(target)}
          onChange={(id) => setTarget(Number(id))}
        />

        {/* Actions */}
        <div className={styles.actions}>
          <button onClick={onCancel} className={styles.cancelBtn}>
            Cancel
          </button>

          <button
            onClick={() => {
              if (isOnline) {
                onStart({
                  target,
                  preferredColor,
                });
              } else {
                onStart({
                  target,
                  botColor,
                });
              }
            }}
            className={styles.startBtn}
          >
            {isOnline ? "Create Room" : "Start Match"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
