import type { CSSProperties, ReactNode } from "react";
import { boardThemeClasses } from "../BoardThemeSelector/boardThemeClasses";
import {
  DEFAULT_BOARD_THEME,
  type BoardTheme,
} from "../BoardThemeSelector/boardThemes";
import styles from "./GameScreen.module.css";
import "../../styles/game-font.css";
import charcoalLeather from "../../assets/6b-charcoal-leather.png";
import BoardMaterialProvider from "../Board/materials/BoardMaterialProvider";
import { boardMaterialThemes } from "../Board/materials/boardMaterialThemes";

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
    <BoardMaterialProvider enabled theme={theme}>
    <div className="@container/game-layout grid size-full min-h-0 min-w-0 place-items-center [container-type:size]">
      <div
        className={`${styles.gameFrame} ${boardThemeClasses[theme]} grid h-[min(100cqh,calc(100cqw/1.6))] w-full min-w-0 grid-rows-[0px_minmax(0,1fr)_clamp(16px,4.5cqh,44px)] gap-x-0 bg-[#090b0b] text-[#efe4ca] [font-family:'6B_Heebo',Arial,sans-serif] selection:bg-[#c8a66a] selection:text-[#17130c] [@container_game-layout_(height<500px)_and_(width>=620px)]:grid-rows-[0px_minmax(0,1fr)_0px] ${settings ? "grid-cols-[clamp(88px,14.25cqw,226px)_minmax(0,1fr)_clamp(128px,14.25cqw,226px)] @max-[620px]/game-layout:h-full @max-[620px]/game-layout:grid-cols-[88px_minmax(0,1fr)] @max-[620px]/game-layout:grid-rows-[0px_minmax(0,1fr)_48px]" : "grid-cols-[clamp(88px,14.25cqw,226px)_minmax(0,1fr)]"}`}
        data-testid="board-frame"
        data-board-theme={theme}
        style={{ "--board-leather-image": `url("${charcoalLeather}")`,
          "--board-number-color": boardMaterialThemes[theme].numberText,
          "--board-cube-material-text": boardMaterialThemes[theme].cubeText,
        } as CSSProperties}
      >
        {children}
        {settings}
      </div>
    </div>
    </BoardMaterialProvider>
  );
}
