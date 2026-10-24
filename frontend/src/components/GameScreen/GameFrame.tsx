import type { ReactNode } from "react";
import { boardThemeClasses } from "../BoardThemeSelector/boardThemeClasses";
import {
  DEFAULT_BOARD_THEME,
  type BoardTheme,
} from "../BoardThemeSelector/boardThemes";
import styles from "./GameScreen.module.css";

export default function GameFrame({
  children,
  theme = DEFAULT_BOARD_THEME,
  settings,
}: {
  children: ReactNode;
  theme?: BoardTheme;
  settings?: ReactNode;
}) {
  return (
    <div className="@container/game-layout grid size-full min-h-0 min-w-0 place-items-center [container-type:size]">
      <div
        className={`${styles.gameFrame} ${boardThemeClasses[theme]} grid h-[min(100cqh,calc(100cqw/1.85))] w-full grid-rows-[minmax(0,1fr)] gap-1 [background:var(--lux-rail-bg)] ${settings ? "grid-cols-[clamp(80px,10cqw,160px)_clamp(44px,6cqw,84px)_minmax(0,1fr)_clamp(108px,14cqw,200px)] @max-[620px]/game-layout:h-full @max-[620px]/game-layout:grid-cols-[80px_44px_minmax(0,1fr)] @max-[620px]/game-layout:grid-rows-[minmax(0,1fr)_48px]" : "grid-cols-[clamp(80px,10cqw,160px)_clamp(44px,6cqw,84px)_minmax(0,1fr)]"}`}
        data-testid="board-frame"
      >
        {children}
        {settings}
      </div>
    </div>
  );
}
