import { useEffect, useState } from "react";
import "./AutoRoll.css";

const STORAGE_KEY = "bg_auto_roll";
export function useAutoRoll() {
  const [autoRoll, setAutoRoll] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === null ? true : saved === "true";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, autoRoll.toString());
  }, [autoRoll]);

  return [autoRoll, setAutoRoll] as const;
}

export function AutoRoll({
  autoRoll,
  onChange,
}: {
  autoRoll: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="autoRollToggle" data-testid="auto-roll-toggle">
      <input
        type="checkbox"
        checked={autoRoll}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="autoRollTrack">
        <span className="autoRollThumb" />
      </span>
      <span className="autoRollLabel">Auto roll</span>
    </label>
  );
}
