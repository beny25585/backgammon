import { motion } from "motion/react";
import { useI18n } from "@/i18n/I18nProvider";
import styles from "./AnimatedTabs.module.css";

export type TabItem = {
  id: string;
  label: string;
};

type AnimatedTabsProps = {
  tabs: TabItem[];
  activeTab: string;
  onChange: (id: string) => void;
};

export default function AnimatedTabs({
  tabs,
  activeTab,
  onChange,
}: AnimatedTabsProps) {
  const { direction } = useI18n();
  const activeIndex = tabs.findIndex((tab) => tab.id === activeTab);
  const x = direction === "rtl" ? activeIndex * -100 : activeIndex * 100;

  return (
    <div
      className={styles.tabs}
      style={
        {
          "--tabs-count": tabs.length,
        } as React.CSSProperties
      }
    >
      <motion.div
        className={styles.activeTab}
        animate={{
          x: `${x}%`,
        }}
        transition={{
          type: "spring",
          stiffness: 500,
          damping: 35,
        }}
      />

      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={styles.tab}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
