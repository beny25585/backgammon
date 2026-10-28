import { useEffect, useRef, type CSSProperties } from "react";
import { motion, useAnimationControls, useReducedMotion } from "motion/react";
import { useBoardMaterials } from "../../Board/materials/boardMaterialContext";
import { pipPositions } from "./pipPositions";
import { DIE_FACES, CUBE_FACES, FACE_SIDES, landingRotation } from "./landingRotation";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const DEPTH_OFFSET = "translateZ(calc(var(--rolling-die-size) / -2 + 1px))";
// Keep the canonical face orientation, replacing only its old fixed-size depth.
const FACE_ROTATIONS = FACE_SIDES.map((side) => side.slice(0, side.indexOf("translateZ")).trim());

function DieFace({ faceValue, side, dark, variant, faceColor }: {
  faceValue: number; side: string; dark?: boolean;
  variant: "pips" | "value"; faceColor?: string;
}) {
  const { diceImages } = useBoardMaterials();
  const source = variant === "pips" ? diceImages?.[dark ? "dark" : "light"][faceValue] : undefined;
  return (
    <div data-testid="die-face" data-face-value={faceValue}
      className={`absolute inset-0 flex items-center justify-center rounded-[12%] [backface-visibility:hidden] ${dark && variant === "pips" ? "faceDark" : "faceLight"} ${
        source ? dark ? "bg-[#171a19]" : "bg-[#d7c7a5]" : dark && variant === "pips"
          ? "[background:linear-gradient(145deg,var(--lux-die-dark-hi,#403f3c),var(--lux-die-dark-low,#080c0d))] shadow-[inset_0_1px_1px_#ffffff52,inset_0_-2px_3px_#00000099]"
          : "[background:linear-gradient(145deg,var(--lux-checker-light-hi,#fff8e7),var(--lux-checker-light-low,#ddc391))] shadow-[inset_0_1px_1px_#ffffffb3,inset_0_-2px_3px_#00000066]"
      }`}
      style={{ transform: `${side} translateZ(calc(var(--rolling-die-size) / 2 - 1px))`, color: faceColor }}>
      {source ? <img src={source} alt="" aria-hidden="true" draggable={false}
        className="pointer-events-none absolute inset-0 size-full select-none" />
        : variant === "value" ? <span className="text-[length:calc(var(--rolling-die-size)*0.42)] leading-none font-extrabold">{faceValue}</span>
          : pipPositions[faceValue]?.map(([x, y], index) => (
            <span key={index} className={`absolute size-[13%] -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[inset_0_1px_1px_#00000080,0_1px_0_#ffffff38] ${dark ? "bg-[var(--lux-die-pip-light,#edf2ff)]" : "bg-[var(--lux-die-pip-dark,#20245a)]"}`}
              style={{ left: `${x}%`, top: `${y}%` }} />
          ))}
    </div>
  );
}

interface RollingDieProps {
  rolling: boolean; count: number; isOpening?: boolean; dark?: boolean;
  variant?: "pips" | "value"; value?: number; valueColor?: string;
  size?: string; landOn?: number[]; spins?: boolean; onRollComplete?: () => void;
}

function RollingCube({ index, target, rolling, dark, variant, valueColor, spins, resultKey, onComplete }: {
  index: number; target?: number; rolling: boolean; dark?: boolean;
  variant: "pips" | "value"; valueColor?: string; spins: boolean; onComplete?: () => void;
  resultKey: string;
}) {
  const controls = useAnimationControls();
  const reduced = useReducedMotion();
  const complete = useRef(onComplete);
  const completedResult = useRef<string | null>(null);
  useEffect(() => { complete.current = onComplete; }, [onComplete]);
  const layout = variant === "value" ? CUBE_FACES : DIE_FACES;
  const hasTarget = target != null && layout.includes(target);
  const final = landingRotation(target ?? layout[0], layout);
  const finalTransform = `${DEPTH_OFFSET} rotateX(${final.rotateX}deg) rotateY(${final.rotateY}deg) rotateZ(0deg)`;

  useEffect(() => {
    let cancelled = false;
    if (hasTarget) {
      // Only the supplied result chooses the landing; this never requests or invents a roll.
      if (reduced) controls.set({ transform: finalTransform });
      else if (spins) controls.set({ transform: `${DEPTH_OFFSET} rotateX(${final.rotateX - 180}deg) rotateY(${final.rotateY + 90}deg) rotateZ(${index % 2 ? 12 : -12}deg)` });
      void controls.start({ transform: finalTransform, opacity: 1,
        transition: { duration: reduced ? 0.16 : 0.28, ease: EASE_OUT } })
        .then(() => {
          if (!cancelled && completedResult.current !== resultKey) {
            completedResult.current = resultKey;
            complete.current?.();
          }
        });
    } else if (rolling && !reduced) {
      completedResult.current = null;
      const direction = index % 2 ? -1 : 1;
      void controls.start({ transform: [
        `${DEPTH_OFFSET} rotateX(-12deg) rotateY(16deg) rotateZ(-5deg)`,
        `${DEPTH_OFFSET} rotateX(${direction * 360 - 12}deg) rotateY(${direction * 360 + 16}deg) rotateZ(-5deg)`,
      ], transition: { duration: 0.7, ease: "linear", repeat: Infinity } });
    } else {
      completedResult.current = null;
      controls.set({ transform: `${DEPTH_OFFSET} ${reduced ? "rotateX(0deg) rotateY(0deg) rotateZ(0deg)"
        : "rotateX(-12deg) rotateY(16deg) rotateZ(-5deg)"}`, opacity: 1 });
    }
    return () => { cancelled = true; controls.stop(); };
  }, [controls, final.rotateX, final.rotateY, finalTransform, hasTarget, index, reduced, rolling, spins, resultKey]);

  return (
    <motion.div className="relative size-[var(--rolling-die-size)] shrink-0 [transform-style:preserve-3d]"
      data-testid="rolling-die" data-land-on={target} data-roll-state={hasTarget ? "landing" : rolling ? "rolling" : "idle"}
      initial={false} animate={controls}>
      {layout.map((faceValue, faceIndex) => <DieFace key={faceIndex} faceValue={faceValue}
        side={FACE_ROTATIONS[faceIndex]} dark={dark} variant={variant} faceColor={valueColor} />)}
    </motion.div>
  );
}

/** Stationary before a roll, tumbling while waiting, then a brief exact landing. */
export default function RollingDie({ rolling, count, isOpening, dark, variant = "pips", valueColor,
  size = "clamp(48px,10vw,64px)", landOn, spins = false, onRollComplete }: RollingDieProps) {
  const visibleCount = isOpening ? 1 : count;
  const resultKey = `${variant}:${landOn?.slice(0, visibleCount).join(",") ?? ""}`;
  const hasAllTargets = Array.from({ length: visibleCount }, (_, index) => landOn?.[index])
    .every((target) => target != null && (variant === "value" ? CUBE_FACES : DIE_FACES).includes(target));
  return (
    <div aria-hidden="true" className="flex items-center justify-center gap-[calc(var(--rolling-die-size)*0.4)] [perspective:600px]"
      style={{ "--rolling-die-size": size } as CSSProperties}>
      {Array.from({ length: visibleCount }, (_, index) => <RollingCube key={index} index={index}
        target={landOn?.[index]} rolling={rolling} dark={dark} variant={variant}
        valueColor={valueColor} spins={spins} resultKey={resultKey}
        onComplete={hasAllTargets && index === visibleCount - 1 ? onRollComplete : undefined} />)}
    </div>
  );
}
