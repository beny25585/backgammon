import { useEffect, useRef, type RefObject } from "react";
import { boardRect } from "../boardCoordinates";
import { useBoardMaterials, type BoardMaterialImages } from "./boardMaterialContext";
import type { BoardSkinLayout, BoardSkinRenderer, SkinRect } from "./boardSkinRenderer";
import { boardMaterialThemes } from "./boardMaterialThemes";

function measureBoard(root: HTMLDivElement): BoardSkinLayout | null {
  const origin = boardRect(root);
  const bounds = (element: HTMLElement): SkinRect => {
    const rect = boardRect(element);
    return { x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height };
  };
  const field = root.querySelector<HTMLElement>('[data-testid="board-inner"]');
  const bar = root.querySelector<HTMLElement>('[data-point-idx="bar"]');
  const points = [...root.querySelectorAll<HTMLElement>("[data-point-top]")];
  const trays = [...root.querySelectorAll<HTMLElement>('[data-bearoff-layer="rim"]')];
  if (!field || !bar || points.length !== 24 || trays.length !== 2 || origin.width <= 0 || origin.height <= 0) return null;
  return {
    width: origin.width,
    height: origin.height,
    field: bounds(field),
    points: points.map((point) => ({ ...bounds(point), top: point.dataset.pointTop === "true", light: point.dataset.pointLight === "true" })),
    bar: bounds(bar),
    trays: trays.map(bounds),
  };
}

export default function PixiBoardSkin({ rootRef }: { rootRef: RefObject<HTMLDivElement | null> }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { enabled, theme, ready, publish } = useBoardMaterials();

  useEffect(() => {
    const root = rootRef.current;
    const host = hostRef.current;
    if (!enabled || !root || !host) return;
    let active = true;
    const controller = new AbortController();
    let renderer: BoardSkinRenderer | null = null;
    let materialImages: BoardMaterialImages | null = null;
    let observer: ResizeObserver | null = null;
    let frame: number | null = null;

    const redraw = () => {
      frame = null;
      if (!active || !renderer) return;
      const layout = measureBoard(root);
      if (!layout) return;
      try {
        renderer.render(layout);
        host.dataset.ready = "true";
        publish(materialImages);
      } catch (error) {
        host.dataset.ready = "false";
        publish(null);
        console.warn("Board material rendering unavailable", error);
      }
    };
    const schedule = () => {
      if (active && frame === null) frame = requestAnimationFrame(redraw);
    };

    void import("./boardSkinRenderer").then((module) => {
      if (!active) return null;
      return module.createBoardSkinRenderer(boardMaterialThemes[theme], controller.signal);
    }).then((created) => {
      if (!created) return;
      if (!active) { created.destroy(); return; }
      renderer = created;
      materialImages = { theme, checkerImages: created.checkerImages, diceImages: created.diceImages };
      host.appendChild(created.canvas);
      observer = new ResizeObserver(schedule);
      observer.observe(root);
      for (const element of root.querySelectorAll<HTMLElement>('[data-testid="board-inner"], [data-testid="board-half-left"], [data-point-idx="bar"], [data-bearoff-layer="rim"]')) observer.observe(element);
      redraw();
      void document.fonts.ready.then(schedule);
    }).catch((error: unknown) => {
      if (!active) return;
      host.dataset.ready = "false";
      publish(null);
      console.warn("Board materials unavailable; retaining native surfaces", error);
    });

    return () => {
      active = false;
      controller.abort();
      if (frame !== null) cancelAnimationFrame(frame);
      observer?.disconnect();
      renderer?.destroy();
      publish(null);
    };
  }, [enabled, theme, publish, rootRef]);

  return enabled ? <div ref={hostRef} aria-hidden="true" data-testid="pixi-board-skin" data-theme={theme} data-ready={String(ready)}
    className={`pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[inherit] [&>canvas]:block [&>canvas]:size-full ${ready ? "opacity-100" : "opacity-0"}`} /> : null;
}
