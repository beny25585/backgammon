import { useState } from "react";
import { motion } from "motion/react";
import type { Color } from "@/lib/backgammon/engine";
import styles from "./MatchSettings.module.css";
import AnimatedTabs from "../animations/AnimatedTabs/AnimatedTabs";
import { TIME_CONTROL_PRESETS } from "../../lib/clock";

interface MatchSettingsProps {
  mode: "online" | "bot";
  onStart: (settings: {
    botColor?: Color;
    target: number;
    preferredColor?: string;
    time?: string;
  }) => void;
  onCancel: () => void;
}

const TARGETS = [1, 3, 5, 7, 9, 11, 13, 15, 21];

const colorTabs = [
  {
    id: "white",
    label: "White",
  },
  {
    id: "black",
    label: "Black",
  },
];

export default function MatchSettings({
  mode,
  onStart,
  onCancel,
}: MatchSettingsProps) {
  const [playerColor, setPlayerColor] = useState<"white" | "black">("white");

  const [target, setTarget] = useState(7);

  const [timeControl, setTimeControl] = useState("normal");

  const isOnline = mode === "online";

  const selectedColor = playerColor;

  const handleColorChange = (id: string) => {
    setPlayerColor(id as "white" | "black");
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
        <div className={styles.brandRow}>
          <span className={styles.brandMark}>B</span>
          <div>
            <p>Backgammon</p>
            <span>{isOnline ? "Online match" : "Bot match"}</span>
          </div>
        </div>

        <div className={styles.header}>
          <div>
            <p className={styles.kicker}>Match settings</p>
            <h2 className={styles.title}>
              {isOnline ? "Create a private room" : "Set up a solo match"}
            </h2>
          </div>
          <p className={styles.subtitle}>
            Choose your color and target score before starting.
          </p>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionLabel}>
            <p>Play as</p>
          </div>
          <AnimatedTabs
            tabs={colorTabs}
            activeTab={selectedColor}
            onChange={handleColorChange}
          />
        </div>

        <div className={styles.section}>
          <div className={styles.sectionLabel}>
            <p>{target === 1 ? "Single Game" : `First to ${target} points`}</p>
          </div>
          <AnimatedTabs
            tabs={targetTabs}
            activeTab={String(target)}
            onChange={(id) => setTarget(Number(id))}
          />
        </div>

        <div className={styles.section}>
          <div className={styles.sectionLabel}>
            <p>Time control</p>
          </div>
          <AnimatedTabs
            tabs={TIME_CONTROL_PRESETS.map((p) => ({
              id: p.id,
              label: p.label,
            }))}
            activeTab={timeControl}
            onChange={(id) => setTimeControl(id)}
          />
        </div>

        <div className={styles.actions}>
          <button onClick={onCancel} className={styles.cancelBtn}>
            Cancel
          </button>

          <button
            onClick={() => {
              if (isOnline) {
                onStart({
                  target,
                  preferredColor: playerColor,
                  time: timeControl,
                });
              } else {
                onStart({
                  target,
                  botColor: playerColor === "white" ? "black" : "white",
                  time: timeControl,
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
