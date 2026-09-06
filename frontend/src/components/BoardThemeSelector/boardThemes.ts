export const BOARD_THEMES = ["redGreen", "blueIvory", "ivoryGold"] as const;

export type BoardTheme = (typeof BOARD_THEMES)[number];

export const DEFAULT_BOARD_THEME: BoardTheme = "blueIvory";

export function isBoardTheme(value: string | null): value is BoardTheme {
  return BOARD_THEMES.includes(value as BoardTheme);
}
