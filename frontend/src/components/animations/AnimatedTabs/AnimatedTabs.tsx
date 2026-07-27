import { motion } from "motion/react";
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
  const activeIndex = tabs.findIndex((tab) => tab.id === activeTab);
  const reversedIndex = tabs.length - 1 - activeIndex;

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
          x: `${reversedIndex * 100}%`,
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
