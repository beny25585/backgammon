import { motion } from "motion/react";
import { useState } from "react";
import type { Color } from "@/lib/backgammon/engine";

const pipPositions: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [
    [25, 25],
    [75, 75],
  ],
  3: [
    [25, 25],
    [50, 50],
    [75, 75],
  ],
  4: [
    [25, 25],
    [75, 25],
    [25, 75],
    [75, 75],
  ],
  5: [
    [25, 25],
    [75, 25],
    [50, 50],
    [25, 75],
    [75, 75],
  ],
  6: [
    [25, 25],
    [75, 25],
    [25, 50],
    [75, 50],
    [25, 75],
    [75, 75],
  ],
};

export function Die({
  value,
  used,
  dark,
}: {
  value: number;
  used?: boolean;
  dark?: boolean;
}) {
  return (
    <motion.div
      initial={{ rotate: -360, scale: 0.4, opacity: 0 }}
      animate={{ rotate: 0, scale: 1, opacity: used ? 0.3 : 1 }}
      whileHover={!used ? { scale: 1.08, rotate: 8 } : undefined}
      transition={{ type: "spring", stiffness: 220, damping: 14 }}
      className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl relative ${
        dark
          ? "bg-checker-black text-checker-white"
          : "bg-checker-white text-checker-black"
      }`}
      style={{
        backgroundImage: dark
          ? "radial-gradient(circle at 30% 20%, #4a2f1a, #2a1810 70%)"
          : "radial-gradient(circle at 30% 20%, #fff9e8, #f4e4c1 70%)",
      }}
    >
      {pipPositions[value]?.map(([x, y], i) => (
        <span
          key={i}
          className="absolute w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-current"
          style={{
            left: `${x}%`,
            top: `${y}%`,
            transform: "translate(-50%, -50%)",
          }}
        />
      ))}
    </motion.div>
  );
}

export function DiceRow({
  dice,
  remaining,
  color,
  showLabels,
  myRoll,
  opponentRoll,
  winner,
}: {
  dice: number[];
  remaining: number[];
  color: "white" | "black";
  showLabels?: boolean;
  myRoll?: number | null;
  opponentRoll?: number | null;
  winner?: Color | null;
}) {
  if (showLabels) {
    return (
      <div className="flex gap-6 items-center justify-center">
        {myRoll !== undefined && (
          <div className="flex flex-col items-center gap-1">
            <Die value={myRoll!} dark={color === "black"} />
            <span className="text-xs text-white/60">You</span>
          </div>
        )}
        {opponentRoll !== undefined && (
          <div className="flex flex-col items-center gap-1">
            <Die value={opponentRoll!} dark={color !== "black"} />
            <span className="text-xs text-white/60">Opponent</span>
          </div>
        )}
      </div>
    );
  }

  if (dice.length === 0) return null;
  const displayed =
    dice[0] === dice[1] ? [dice[0], dice[0], dice[0], dice[0]] : dice;
  const remCopy = [...remaining];
  return (
    <div className="flex gap-2 items-center">
      {displayed.map((d, i) => {
        const idx = remCopy.indexOf(d);
        const used = idx < 0;
        if (idx >= 0) remCopy.splice(idx, 1);
        return <Die key={i} value={d} used={used} dark={color === "black"} />;
      })}
    </div>
  );
}

/** A single die face with pip pattern for the 3D cube */
function DieFace({
  value,
  side,
  dark,
}: {
  value: number;
  side?: string;
  dark?: boolean;
}) {
  return (
    <div
      className="absolute inset-0 rounded-2xl flex items-center justify-center"
      style={{
        backfaceVisibility: "hidden",
        backgroundImage: dark
          ? "radial-gradient(circle at 30% 20%, #4a2f1a, #2a1810 70%)"
          : "radial-gradient(circle at 30% 20%, #fff9e8, #f4e4c1 70%)",
        boxShadow:
          "inset 0 -3px 5px rgba(0,0,0,0.3), inset 0 2px 3px rgba(255,255,255,0.1), 0 6px 14px rgba(0,0,0,0.5)",
        transform: side || undefined,
      }}
    >
      {pipPositions[value]?.map(([x, y], i) => (
        <span
          key={i}
          className="absolute w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full"
          style={{
            left: `${x}%`,
            top: `${y}%`,
            transform: "translate(-50%, -50%)",
            backgroundColor: dark ? "#f4e4c1" : "#2a1810",
          }}
        />
      ))}
    </div>
  );
}

/** Animated rolling dice — click to trigger the actual roll */
export function RollPrompt({
  onRoll,
  count = 2,
  isOpening,
}: {
  onRoll: () => void;
  count?: number;
  isOpening?: boolean;
}) {
  const [rolling, setRolling] = useState(false);

  function handleClick() {
    setRolling(true);
    setTimeout(() => {
      setRolling(false);
      onRoll();
    }, 600);
  }

  return (
    <motion.button
      onClick={handleClick}
      className="flex flex-col items-center gap-3 cursor-pointer bg-transparent border-none focus:outline-none"
      whileTap={{ scale: 0.92 }}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="flex gap-8" style={{ perspective: 600 }}>
        {Array.from({ length: isOpening ? 1 : count }).map((_, i) => (
          <motion.div
            key={i}
            className="relative rounded-2xl"
            style={{
              width: "clamp(48px, 10vw, 64px)",
              height: "clamp(48px, 10vw, 64px)",
              transformStyle: "preserve-3d",
              backgroundColor: "#1a0e06",
            }}
            animate={
              rolling
                ? {
                    rotateX: [0, 720, 1440],
                    rotateY: [0, 360, 1080],
                    rotateZ: [-15, 20, -10, 15, 0],
                  }
                : {
                    rotateX: [0, 360, 720],
                    rotateY: [0, 180, 540],
                    rotateZ: [-5, 8, -4, 10, -6, 3, 0],
                  }
            }
            transition={
              rolling
                ? {
                    rotateX: { duration: 0.6, ease: "easeOut" },
                    rotateY: { duration: 0.6, ease: "easeOut" },
                    rotateZ: { duration: 0.6, ease: "easeOut" },
                  }
                : {
                    rotateX: {
                      duration: 3.0,
                      repeat: Infinity,
                      ease: "linear",
                      delay: i * 0.08,
                    },
                    rotateY: {
                      duration: 3.6,
                      repeat: Infinity,
                      ease: "linear",
                      delay: i * 0.12,
                    },
                    rotateZ: {
                      duration: 1.8,
                      repeat: Infinity,
                      ease: "easeInOut",
                      delay: i * 0.15,
                    },
                  }
            }
          >
            <DieFace value={1} side="translateZ(calc(clamp(24px,5vw,32px)))" />
            <DieFace
              value={6}
              side="rotateY(180deg) translateZ(calc(clamp(24px,5vw,32px)))"
            />
            <DieFace
              value={3}
              side="rotateY(-90deg) translateZ(calc(clamp(24px,5vw,32px)))"
            />
            <DieFace
              value={4}
              side="rotateY(90deg) translateZ(calc(clamp(24px,5vw,32px)))"
            />
            <DieFace
              value={2}
              side="rotateX(-90deg) translateZ(calc(clamp(24px,5vw,32px)))"
            />
            <DieFace
              value={5}
              side="rotateX(90deg) translateZ(calc(clamp(24px,5vw,32px)))"
            />
          </motion.div>
        ))}
      </div>
      <motion.span
        className="text-white/40 text-xs tracking-widest uppercase"
        animate={{ opacity: rolling ? 0 : [0.3, 0.7, 0.3] }}
        transition={
          rolling ? { duration: 0.2 } : { duration: 2, repeat: Infinity }
        }
      >
        Tap to roll
      </motion.span>
    </motion.button>
  );
}
