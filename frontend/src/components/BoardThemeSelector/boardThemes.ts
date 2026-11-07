export const BOARD_THEMES = ["brownGold", "charcoalGold", "redGreen", "blueIvory", "ivoryGold", "classicBrown", "classicLight"] as const;

export type BoardTheme = (typeof BOARD_THEMES)[number];

export const DEFAULT_BOARD_THEME: BoardTheme = "brownGold";

export function isBoardTheme(value: string | null): value is BoardTheme {
  return BOARD_THEMES.includes(value as BoardTheme);
}
