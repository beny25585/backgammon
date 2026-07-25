import { motion } from "motion/react";
import { CHECKER } from "../../layout";

interface CheckerProps {
  color: "white" | "black";
  label?: string;
  flyIn?: boolean;
}

export default function Checker({ color, label, flyIn }: CheckerProps) {
  const isWhite = color === "white";
  return (
    <motion.div
      layout
      initial={flyIn ? { scale: 0, opacity: 0, y: -60 } : { scale: 0.5, opacity: 0, y: -8 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      transition={flyIn
        ? { type: "spring", stiffness: 260, damping: 16, mass: 0.8 }
        : { type: "spring", stiffness: 320, damping: 22 }
      }
      className="rounded-full flex items-center justify-center text-xs font-bold shrink-0"
      style={{
        width: CHECKER,
        height: CHECKER,
        background: isWhite
          ? "radial-gradient(circle at 30% 25%, #ffffff, #f4e4c1 55%, #b89660 100%)"
          : "radial-gradient(circle at 30% 25%, #6a4830, #2a1810 55%, #0a0402 100%)",
        boxShadow:
          "0 3px 6px rgba(0,0,0,0.55), inset 0 -3px 4px rgba(0,0,0,0.35), inset 0 2px 2px rgba(255,255,255,0.15)",
        color: isWhite ? "#3d2817" : "#f4e4c1",
        border: isWhite ? "1px solid #c9a961" : "1px solid #000",
      }}
    >
      {label}
    </motion.div>
  );
}
