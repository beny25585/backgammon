// Express geometry in the board's axes when the game is rotated clockwise.
function isRotated(element: HTMLElement): boolean {
  return getComputedStyle(element).getPropertyValue("--game-rotated").trim() === "1";
}

export function boardRect(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return isRotated(element)
    ? { left: rect.top, top: -rect.right, width: rect.height, height: rect.width }
    : rect;
}

export function boardPoint(element: HTMLElement, point: { x: number; y: number }) {
  return isRotated(element) ? { x: point.y, y: -point.x } : point;
}
