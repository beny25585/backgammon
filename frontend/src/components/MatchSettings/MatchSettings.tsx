import { useState } from "react";
import { motion } from "motion/react";
import type { Color } from "@/lib/backgammon/engine";
import styles from "./MatchSettings.module.css";
import AnimatedTabs from "../animations/AnimatedTabs/AnimatedTabs";
import { TIME_CONTROL_PRESETS } from "../../lib/clock";
import { useI18n } from "../../i18n/I18nProvider";
import BrandLockup from "../BrandLockup";

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

export default function MatchSettings({
  mode,
  onStart,
  onCancel,
}: MatchSettingsProps) {
  const { t } = useI18n();
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
  const colorTabs = [
    {
      id: "white",
      label: t("common.playAsWhite"),
    },
    {
      id: "black",
      label: t("common.playAsBlack"),
    },
  ];
  const timeTabs = TIME_CONTROL_PRESETS.map((preset) => ({
    id: preset.id,
    label: t(`settings.${preset.id === "none" ? "noLimit" : preset.id}`),
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
        <BrandLockup
          subtitle={isOnline ? t("settings.online") : t("settings.bot")}
          size="md"
        />

        <div className={styles.header}>
          <div>
            <p className={styles.kicker}>{t("settings.title")}</p>
            <h2 className={styles.title}>
              {isOnline ? t("settings.createPrivate") : t("settings.setupSolo")}
            </h2>
          </div>
          <p className={styles.subtitle}>{t("settings.subtitle")}</p>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionLabel}>
            <p>{t("settings.playAs")}</p>
          </div>
          <AnimatedTabs
            tabs={colorTabs}
            activeTab={selectedColor}
            onChange={handleColorChange}
          />
        </div>

        <div className={styles.section}>
          <div className={styles.sectionLabel}>
            <p>
              {target === 1
                ? t("settings.singleGame")
                : t("settings.firstTo", { points: target })}
            </p>
          </div>
          <AnimatedTabs
            tabs={targetTabs}
            activeTab={String(target)}
            onChange={(id) => setTarget(Number(id))}
          />
        </div>

        <div className={styles.section}>
          <div className={styles.sectionLabel}>
            <p>{t("settings.timeControl")}</p>
          </div>
          <AnimatedTabs
            tabs={timeTabs}
            activeTab={timeControl}
            onChange={(id) => setTimeControl(id)}
          />
        </div>

        <div className={styles.actions}>
          <button onClick={onCancel} className={styles.cancelBtn}>
            {t("common.cancel")}
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
            {isOnline ? t("settings.createRoom") : t("settings.startMatch")}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
