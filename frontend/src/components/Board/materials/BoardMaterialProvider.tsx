import { useMemo, useState, type ReactNode } from "react";
import { BoardMaterialContext, type BoardMaterialImages } from "./boardMaterialContext";
import { DEFAULT_BOARD_THEME, type BoardTheme } from "../../BoardThemeSelector/boardThemes";
import { DEFAULT_CHECKER_STYLE, type CheckerStyle } from "./checkerStyles";

export default function BoardMaterialProvider({ enabled, theme = DEFAULT_BOARD_THEME, checkerStyle = DEFAULT_CHECKER_STYLE, children }: {
  enabled: boolean; theme?: BoardTheme; checkerStyle?: CheckerStyle; children: ReactNode;
}) {
  const [materials, publish] = useState<BoardMaterialImages | null>(null);
  const value = useMemo(() => {
    const current = enabled && materials && (materials.theme ?? DEFAULT_BOARD_THEME) === theme
      && (materials.checkerStyle ?? DEFAULT_CHECKER_STYLE) === checkerStyle ? materials : null;
    return { enabled, theme, checkerStyle, ready: current !== null,
      checkerImages: current?.checkerImages ?? null, diceImages: current?.diceImages ?? null, publish };
  }, [enabled, theme, checkerStyle, materials]);

  return <BoardMaterialContext.Provider value={value}>{children}</BoardMaterialContext.Provider>;
}
