import { useLayoutEffect, useState, type RefObject } from "react";
import { boardRect } from "../Board/boardCoordinates";

type Position = { left: number; top: number };
type Rectangle = Position & { width: number; height: number };

interface Options {
  containerRef: RefObject<HTMLDivElement>;
  bubbleRef: RefObject<HTMLDivElement>;
  side: "left" | "right";
  active: boolean;
}

const CLEARANCE = 8;
const MOVING_CHECKER = '[data-testid="dragging-checker"], [data-testid="flying-checker"]';
const REACTION = '[data-board-reaction], [data-testid="player-reaction-white"], [data-testid="player-reaction-black"]';
const OBSTACLES = [
  "[data-checker]",
  "[data-checker-slot]",
  '[data-testid="dice-overlay"]',
  '[data-testid="bar-doubling-cube"]',
  '[data-testid="point-number"]',
  '[data-testid="auto-roll-countdown"]',
  '[data-testid="turn-notice-details"]',
  '[data-testid="guidance-banner"]:not([role="dialog"])',
  "button:not([data-point-idx])",
  REACTION,
].join(", ");

function overlaps(a: Rectangle, b: Rectangle, clearance = 0): boolean {
  return a.left < b.left + b.width + clearance && a.left + a.width > b.left - clearance
    && a.top < b.top + b.height + clearance && a.top + a.height > b.top - clearance;
}

function isDisplayed(element: HTMLElement): boolean {
  if (!element.getClientRects().length) return false;
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility === "visible";
}

/** Reactions use only vacant space; gameplay always takes priority. */
export function useBoardReactionPosition({ containerRef, bubbleRef, side, active }: Options): Position | null {
  const [position, setPosition] = useState<Position | null>(null);

  useLayoutEffect(() => {
    if (!active) return;
    const bubble = bubbleRef.current;
    // The child layout effect can run before the ancestor's ref is attached.
    const container = containerRef.current ?? bubble?.parentElement;
    const board = container?.closest<HTMLElement>('[data-testid="board-wrapper"]');
    if (!container || !bubble || !board) return;

    const layer = container;
    const card = bubble;
    const root = board;
    let frame = 0;
    let previous: Position | null = null;
    const observed = new Set<Element>();
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(layer);
    resizeObserver.observe(card);
    observed.add(layer);
    observed.add(card);

    function update(next: Position | null) {
      previous = next;
      setPosition(current => current?.left === next?.left && current?.top === next?.top ? current : next);
    }

    function measure() {
      frame = 0;
      const half = root.querySelector<HTMLElement>(`[data-testid="board-half-${side}"]`);
      const origin = boardRect(layer);
      const scaleX = origin.width / layer.offsetWidth;
      const scaleY = origin.height / layer.offsetHeight;
      const width = card.offsetWidth;
      const height = card.offsetHeight;
      if (!half || !scaleX || !scaleY || !width || !height) {
        update(null);
        return;
      }

      function localRect(element: HTMLElement): Rectangle {
        const rect = boardRect(element);
        const local = {
          left: (rect.left - origin.left) / scaleX,
          top: (rect.top - origin.top) / scaleY,
          width: rect.width / scaleX,
          height: rect.height / scaleY,
        };
        if (!element.hasAttribute("data-notice-animation")) return local;
        // Reserve the notice's full size and its 10px entrance travel, including
        // animation frames driven by the browser rather than DOM mutations.
        const extraX = Math.max(0, element.offsetWidth - local.width) / 2 + 12;
        const extraY = Math.max(0, element.offsetHeight - local.height) / 2 + 12;
        return {
          left: local.left - extraX,
          top: local.top - extraY,
          width: local.width + extraX * 2,
          height: local.height + extraY * 2,
        };
      }

      const halfRect = localRect(half);
      const left = Math.max(0, halfRect.left) + CLEARANCE;
      const top = Math.max(0, halfRect.top) + CLEARANCE;
      const right = Math.min(layer.offsetWidth, halfRect.left + halfRect.width) - CLEARANCE;
      const bottom = Math.min(layer.offsetHeight, halfRect.top + halfRect.height) - CLEARANCE;
      if (width > right - left || height > bottom - top
        || Array.from(root.querySelectorAll<HTMLElement>(MOVING_CHECKER)).some(isDisplayed)) {
        update(null);
        return;
      }

      const elements = Array.from(root.querySelectorAll<HTMLElement>(OBSTACLES));
      const targets = new Set<Element>([layer, card, half, ...elements]);
      for (const element of observed) {
        if (!targets.has(element)) {
          resizeObserver.unobserve(element);
          observed.delete(element);
        }
      }
      for (const element of targets) {
        if (!observed.has(element)) {
          resizeObserver.observe(element);
          observed.add(element);
        }
      }

      const bounds = { left, top, width: right - left, height: bottom - top };
      const obstacles = elements
        .filter(element => !card.contains(element) && !element.contains(card) && isDisplayed(element))
        .map(localRect)
        .filter(rect => overlaps(rect, bounds, CLEARANCE));
      const fits = (candidate: Position) => candidate.left >= left && candidate.top >= top
        && candidate.left + width <= right && candidate.top + height <= bottom
        && !obstacles.some(rect => overlaps({ ...candidate, width, height }, rect, CLEARANCE));

      if (previous && fits(previous)) {
        update(previous);
        return;
      }

      const centerX = (left + right - width) / 2;
      const centerY = (top + bottom - height) / 2;
      // Obstacle edges include even narrow pockets that a regular search grid could miss.
      const xs = new Set([centerX, left, right - width]);
      const ys = new Set([centerY, top, bottom - height]);
      for (const rect of obstacles) {
        xs.add(rect.left - width - CLEARANCE);
        xs.add(rect.left + rect.width + CLEARANCE);
        ys.add(rect.top - height - CLEARANCE);
        ys.add(rect.top + rect.height + CLEARANCE);
      }
      let best: Position | null = null;
      let bestDistance = Infinity;
      for (const x of xs) {
        for (const y of ys) {
          const distance = (x - centerX) ** 2 + (y - centerY) ** 2;
          if (distance < bestDistance && fits({ left: x, top: y })) {
            best = { left: x, top: y };
            bestDistance = distance;
          }
        }
      }
      update(best);
    }

    function schedule() {
      if (!frame) frame = requestAnimationFrame(measure);
    }

    const mutationObserver = new MutationObserver(records => {
      if (records.some(record => {
        const element = record.target instanceof HTMLElement ? record.target : record.target.parentElement;
        if (!element || bubble.contains(element)) return false;
        // Their transforms cannot create a safe location while a checker is moving.
        return record.type !== "attributes" || !element.closest(MOVING_CHECKER);
      })) schedule();
    });
    mutationObserver.observe(board, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "data-testid"],
    });
    window.addEventListener("resize", schedule);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [active, bubbleRef, containerRef, side]);

  return active ? position : null;
}
