import { motion, useReducedMotion } from "motion/react";
import { useState, useRef, useCallback, useEffect } from "react";
import type { Color } from "@/lib/backgammon/engine";
import RollingDie from "@animations/RollingDie/RollingDie";
import { pipPositions } from "../animations/RollingDie/pipPositions";
import { useI18n } from "../../i18n/I18nProvider";
import styles from "./Dice.module.css";
import { useBoardMaterials } from "../Board/materials/boardMaterialContext";

export function Die({
  value,
  used,
  dark,
  usedOpacity = 0.65,
}: {
  value: number;
  used?: boolean;
  dark?: boolean;
  usedOpacity?: number;
}) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const { diceImages } = useBoardMaterials();
  const source = diceImages?.[dark ? "dark" : "light"][value];
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const materialReady = Boolean(source && loadedSource === source);
  const [landingValue, setLandingValue] = useState<number | null>(() => used ? null : value);
  const finishLanding = useCallback(() => setLandingValue(null), []);
  // A reorder or spent die stays immediately readable and never starts a new roll.
  const interrupted = Boolean(used || reduced || landingValue !== value);
  if (landingValue !== null && interrupted) setLandingValue(null);
  const showLanding = landingValue !== null && !interrupted;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ transform: "rotate(1deg)", opacity: used ? usedOpacity : 1 }}
      transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
      className={`relative size-[var(--die-size,clamp(2rem,10vw,3rem))] shrink-0 rounded-[var(--die-radius,5px)] ${materialReady ? "" :
        "border shadow-[0_6px_14px_#02051261,inset_0_1px_1px_#ffffff38,inset_0_-3px_5px_#00000047]"} ${materialReady ? "" : dark
        ? "border-[#e6edeb7a] text-[#ffffff] [background:linear-gradient(145deg,color-mix(in_srgb,var(--lux-die-dark-hi,#34393b),#ffffff_8%),color-mix(in_srgb,var(--lux-die-dark-low,#101415),#ffffff_12%))]"
        : "border-[#e5b44d8c] text-[var(--lux-die-pip-dark,#19130d)] [background:radial-gradient(circle_at_28%_22%,#ffffff94,transparent_28%),linear-gradient(145deg,var(--lux-checker-light-hi,#fff8e7),var(--lux-checker-light-low,#ddc391))]"}`}
      data-testid="die"
      data-die-value={value}
      data-die-dark={String(Boolean(dark))}
      data-die-used={String(Boolean(used))}
      data-die-material-ready={String(materialReady)}
      data-die-landing={String(showLanding)}
      role="img"
      aria-label={t(used ? "common.usedDieValue" : "common.dieValue", { value })}
    >
      {source && <img key={source} src={source} alt="" aria-hidden="true" draggable={false}
        data-die-material={dark ? "dark" : "light"}
        onLoad={(event) => { if (event.currentTarget.currentSrc === source) setLoadedSource(source); }}
        className={`pointer-events-none absolute inset-0 size-full select-none [filter:drop-shadow(1px_2px_2px_#0000008c)] ${materialReady && !showLanding ? "opacity-100" : "opacity-0"}`} />}
      {pipPositions[value]?.map(([x, y], i) => (
        <span
          key={i}
          aria-hidden="true"
          data-die-pip={i + 1}
          className={`absolute size-[var(--pip-size,16.8%)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-current ${materialReady || showLanding ? "invisible" : ""}`}
          style={{
            left: `${x}%`,
            top: `${y}%`,
          }}
        />
      ))}
      {showLanding && <div className="pointer-events-none absolute inset-0">
        <RollingDie rolling count={1} dark={dark} landOn={[value]} spins
          size="var(--die-size,clamp(2rem,10vw,3rem))" onRollComplete={finishLanding} />
      </div>}
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
  forceActive,
  onReorder,
  usedOpacity,
}: {
  dice: number[];
  remaining: number[];
  color: "white" | "black";
  showLabels?: boolean;
  myRoll?: number | null;
  opponentRoll?: number | null;
  winner?: Color | null;
  forceActive?: boolean;
  onReorder?: () => void;
  usedOpacity?: number;
}) {
  const { t } = useI18n();

  if (showLabels) {
    return (
      <div className={styles.diceRowLabeled}>
        {myRoll !== undefined && (
          <div className={styles.dieColumn}>
            <Die value={myRoll!} dark={color === "black"} />
            <span className={styles.label}>{t("common.you")}</span>
          </div>
        )}
        {opponentRoll !== undefined && (
          <div className={styles.dieColumn}>
            <Die value={opponentRoll!} dark={color !== "black"} />
            <span className={styles.label}>{t("common.opponent")}</span>
          </div>
        )}
      </div>
    );
  }

  if (dice.length === 0) return null;
  const displayed =
    dice[0] === dice[1]
      ? [dice[0], dice[0], dice[0], dice[0]]
      : [...remaining, ...dice.filter((d) => !remaining.includes(d))];
  const activeCount = forceActive ? displayed.length : remaining.length;
  const content = displayed.map((d, i) => {
    const used = !forceActive && i >= activeCount;
    return <Die key={i} value={d} used={used} usedOpacity={usedOpacity} dark={color === "black"} />;
  });
  if (onReorder) {
    return (
      <button
        type="button"
        className={`${styles.diceRow} ${styles.diceButton}`}
        onClick={onReorder}
        aria-label={t("game.reorderDice")}
      >
        {content}
      </button>
    );
  }
  return (
    <div className={styles.diceRow}>
      {content}
    </div>
  );
}

/** Finger-tap icon — signals the button is clickable */
function TapIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M9 11.24V7.5C9 6.12 10.12 5 11.5 5S14 6.12 14 7.5v3.74c1.21-.81 2-2.18 2-3.74C16 5.01 13.99 3 11.5 3S7 5.01 7 7.5c0 1.56.79 2.93 2 3.74z" />
      <path d="M21.84 16.63l-4.54-2.26c-.17-.07-.35-.11-.54-.11H16v-6c0-.83-.67-1.5-1.5-1.5S13 7.17 13 8v10.74l-3.43-.72c-.08-.01-.15-.03-.24-.03-.31 0-.59.13-.79.33l-.79.8 4.94 4.94c.27.27.65.44 1.06.44h6.79c.75 0 1.33-.55 1.44-1.28l.75-5.27c.01-.07.02-.14.02-.2 0-.62-.38-1.16-.91-1.38z" />
    </svg>
  );
}

/** Animated rolling dice — tap to roll. Spins until the real result (landOn) arrives, then lands. */
export function RollPrompt({
  onRoll,
  count = 2,
  isOpening,
  dark,
  landOn,
  onLand,
}: {
  onRoll: () => void;
  count?: number;
  isOpening?: boolean;
  dark?: boolean;
  landOn?: number[];
  onLand?: () => void;
}) {
  const { t } = useI18n();
  const [rolling, setRolling] = useState(false);
  const fired = useRef(false);
  const rollTimer = useRef<number>();
  const reduced = useReducedMotion();
  useEffect(() => () => window.clearTimeout(rollTimer.current), []);

  function handleClick() {
    if (fired.current) return;
    fired.current = true;
    setRolling(true);
    // Keep the dice spinning so the animation is visible, then request the roll
    rollTimer.current = window.setTimeout(() => onRoll(), 1000);
  }

  return (
    <motion.button
      onClick={handleClick}
      type="button"
      aria-busy={rolling}
      aria-label={t("common.tapToRoll")}
      className="relative flex cursor-pointer flex-col items-center gap-[clamp(10px,2vw,14px)] rounded-lg border border-[var(--ui-accent-border,#e5b44d80)] px-[clamp(28px,5vw,42px)] py-[clamp(18px,3vw,26px)] shadow-[0_16px_32px_#0205126b] [background:var(--ui-menu-bg,#08171beb)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e5b44d] [@media(hover:hover)_and_(pointer:fine)]:hover:[background:var(--ui-secondary-bg,#0d2226f2)]"
      data-testid="roll-prompt-btn"
      whileTap={reduced ? undefined : { transform: "scale(0.97)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transform: "scale(1)" }}
      transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
    >
      <TapIcon className="pointer-events-none size-[clamp(24px,4.5vw,34px)] text-[var(--ui-accent,#e5b44d)]" />
      <RollingDie
        rolling={rolling}
        count={count}
        isOpening={isOpening}
        dark={dark}
        landOn={landOn}
        onRollComplete={onLand}
      />
      <motion.span
        className={styles.rollLabel}
        animate={{ opacity: rolling ? 0.45 : 1 }}
        transition={{ duration: 0.16 }}
      >
        {t("common.tapToRoll")}
      </motion.span>
    </motion.button>
  );
}
