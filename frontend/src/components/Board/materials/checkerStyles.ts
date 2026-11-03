export const CHECKER_STYLES = ["polished", "matte", "marble"] as const;

export type CheckerStyle = (typeof CHECKER_STYLES)[number];

export const DEFAULT_CHECKER_STYLE: CheckerStyle = "polished";

export function isCheckerStyle(value: string | null): value is CheckerStyle {
  return CHECKER_STYLES.includes(value as CheckerStyle);
}
