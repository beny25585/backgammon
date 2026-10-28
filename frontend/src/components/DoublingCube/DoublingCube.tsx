import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Color } from "@/lib/backgammon/engine";
import { useI18n } from "../../i18n/I18nProvider";
import { useOptionalGame } from "../../services/gameContext";
import { useBoardMaterials } from "../Board/materials/boardMaterialContext";

const CUBE_COLOR_CLASSES: Record<number, string> = {
  1: "text-[var(--ui-cube-text,#a47b36)]",
  2: "text-[var(--ui-cube-text,#e74c3c)]",
  4: "text-[var(--ui-cube-text,#d4941a)]",
  8: "text-[var(--ui-cube-text,#e5b44d)]",
  16: "text-[var(--ui-cube-text,#f1dfb7)]",
  32: "text-[var(--ui-cube-text,#f7f1e7)]",
  64: "text-[var(--ui-cube-text,#fff4cf)]",
};

interface DoublingCubeProps {
  value: number;
  owner: Color | "center";
  showOwner?: boolean;
}

export default function DoublingCube({ value, owner, showOwner = true }: DoublingCubeProps) {
  const { t } = useI18n();
  const game = useOptionalGame();
  const { diceImages } = useBoardMaterials();
  const source = diceImages?.light[0];
  const [loadedURL, setLoadedURL] = useState<string | null>(null);
  const decoded = Boolean(source && loadedURL === source);
  const reduceMotion = useReducedMotion();

  const ownerLabel =
    owner === "center"
      ? t("common.center")
      : owner === "white"
        ? game
          ? game.whiteName || t("common.white")
          : t("common.you")
        : game
          ? game.blackName || t("common.black")
          : t("common.opponent");
  const displayValue = owner === "center" && value === 1 ? 64 : value;
  const colorClass = CUBE_COLOR_CLASSES[displayValue] ?? "text-[var(--ui-cube-text,#d4941a)]";

  return (
    <div className="pointer-events-none flex flex-col items-center gap-[3px]">
      <div
        className={`relative isolate flex size-[var(--board-cube-size,clamp(32px,13cqw,48px))] select-none items-center justify-center overflow-hidden rounded-md border-2 text-[length:var(--board-cube-font,18px)] leading-none font-extrabold tabular-nums ${decoded
          ? "border-transparent bg-transparent text-[var(--board-cube-material-text,#694c25)] shadow-[0_2px_3px_#00000059] [text-shadow:0_1px_0_#fff5dd80,0_-1px_1px_#5c402866]"
          : `border-[var(--ui-accent-border,#e5b44d94)] shadow-[0_4px_10px_#00000080,inset_0_1px_0_#ffffff66,inset_0_0_0_2px_#0000004d] [background:var(--ui-cube-bg,linear-gradient(145deg,#fff8e7,#e0c899_58%,#8b6a3f))] ${colorClass}`}`}
        data-testid="doubling-cube"
        data-cube-value={displayValue}
        data-cube-owner={owner}
        data-pixi-material="doubling-cube"
        data-pixi-ready={String(decoded)}
        role="img"
        aria-label={t("common.cubeTitle", { value: displayValue, owner: ownerLabel })}
        title={t("common.cubeTitle", { value: displayValue, owner: ownerLabel })}
      >
        {source && <img key={source} src={source} alt="" aria-hidden="true" draggable={false}
          data-pixi-cube-face="light"
          onLoad={(event) => { if (event.currentTarget.currentSrc === source) setLoadedURL(source); }}
          className={`pointer-events-none absolute inset-0 size-full select-none ${decoded ? "opacity-100" : "opacity-0"}`} />}
        <AnimatePresence initial={false}>
          <motion.span key={displayValue} className="pointer-events-none absolute inset-0 z-2 grid size-full place-items-center"
            initial={{ opacity: 0, transform: reduceMotion ? "none" : "translateY(8%)" }}
            animate={{ opacity: 1, transform: "none" }}
            exit={{ opacity: 0, transform: reduceMotion ? "none" : "translateY(-8%)" }}
            transition={{ duration: reduceMotion ? 0.12 : 0.18, ease: [0.23, 1, 0.32, 1] }}>
            {displayValue}
          </motion.span>
        </AnimatePresence>
      </div>
      {showOwner && <span className="text-[9px] leading-none font-bold text-[#f7f1e7]/70">{ownerLabel}</span>}
    </div>
  );
}
