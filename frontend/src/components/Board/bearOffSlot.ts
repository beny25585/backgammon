import { boardRect } from "./boardCoordinates";

/** Center a flying circle on a tray's actual horizontal checker, including
 * the projected next slot before the authoritative move has rendered. */
export function bearOffSlot(tray: HTMLElement, count: number, index: number, size: number) {
  const stack = tray.querySelector<HTMLElement>("[data-borne-off-stack]");
  const rect = boardRect(stack ?? tray);
  const pieces = stack?.querySelectorAll<HTMLElement>("[data-borne-off-checker]");
  const visibleCount = Math.min(Math.max(count, 1), 15);
  const slot = Math.min(Math.max(index, 0), visibleCount - 1);
  if (pieces?.length === visibleCount && pieces[slot]) {
    const piece = boardRect(pieces[slot]);
    return { x: piece.left + piece.width / 2 - size / 2, y: piece.top + piece.height / 2 - size / 2 };
  }
  const style = getComputedStyle(stack ?? tray);
  const gap = parseFloat(style.rowGap) || 0;
  const maxHeight = parseFloat(style.getPropertyValue("--bearoff-piece-max")) || 12;
  const height = Math.max(0, Math.min(maxHeight, (rect.height - gap * (visibleCount - 1)) / visibleCount));
  const offset = slot * (height + gap) + height / 2;
  const centerY = tray.dataset.testid === "bear-off-bottom" ? rect.top + rect.height - offset : rect.top + offset;
  return { x: rect.left + rect.width / 2 - size / 2, y: centerY - size / 2 };
}
