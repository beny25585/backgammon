import { useEffect, useState } from "react";
import styles from "./AnimatedNumber.module.css";

interface AnimatedNumberProps {
  from: number;
  to: number;
  duration?: number;
  className?: string;
  "data-testid"?: string;
}

export default function AnimatedNumber({
  from,
  to,
  duration = 0.8,
  className,
  "data-testid": testId = "animated-number",
  ...rest
}: AnimatedNumberProps) {
  const [value, setValue] = useState(from);

  useEffect(() => {
    let intervalId: number | null = null;
    let startTimer: number | null = null;

    // Defer starting the animation so tests that install a fake clock
    // can control when the animation begins.
    startTimer = window.setTimeout(() => {
      const start = Date.now();
      const total = duration * 1000;
      const delta = to - from;

      function easeOut(t: number) {
        return 1 - Math.pow(1 - t, 3);
      }

      intervalId = window.setInterval(() => {
        const elapsed = Date.now() - start;
        const progress = Math.min(1, elapsed / total);
        if (progress >= 1) {
          setValue(to);
          if (intervalId != null) {
            clearInterval(intervalId);
            intervalId = null;
          }
        }
      }, 16);
    }, 0);

    return () => {
      if (startTimer != null) clearTimeout(startTimer);
      if (intervalId != null) clearInterval(intervalId);
    };
  }, [from, to, duration]);

  return (
    <span
      className={`${styles.number} ${className ?? ""}`}
      data-testid={testId}
      {...rest}
    >
      {value}
    </span>
  );
}
