import {
  Application,
  Container,
  FillGradient,
  Graphics,
  ImageSource,
  Matrix,
  Rectangle,
  Sprite,
  Texture,
  VERSION,
  type FillInput,
} from "pixi.js";
import checkerAtlasUrl from "../../../assets/6b-checker-sprite-atlas.png";
import inlayAtlasUrl from "../../../assets/6b-board-inlay-materials.png";
import leatherUrl from "../../../assets/6b-charcoal-leather.png";
import diceBodyAtlasUrl from "../../../assets/6b-dice-body-atlas.png";
import { createDiceMaterialImages, type DiceMaterialImages } from "./diceMaterialRenderer";
import { boardMaterialThemes, type BoardMaterialTheme, type MaterialColorRamp } from "./boardMaterialThemes";
import { createMaterialColorFilter } from "./materialColorFilter";

export interface SkinRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoardSkinLayout {
  width: number;
  height: number;
  field: SkinRect;
  points: Array<SkinRect & { top: boolean; light: boolean }>;
  bar: SkinRect;
  trays: SkinRect[];
}

export interface BoardSkinRenderer {
  canvas: HTMLCanvasElement;
  checkerImages: { white: string; black: string };
  diceImages: DiceMaterialImages | null;
  render: (layout: BoardSkinLayout) => void;
  destroy: () => void;
}

export interface BoardPixiProof {
  theme: BoardMaterialTheme["id"];
  instanceId: number;
  status: "loading" | "ready" | "error" | "destroyed";
  renderer: string;
  pixiVersion: string;
  applicationsCreated: number;
  checkerMaterials: number;
  diceMaterials: number;
  diceBlankMaterials: number;
  boardRenders: number;
  pointCount: number;
  logicalSize: { width: number; height: number; resolution: number };
  tickerStarted: false;
  error?: string;
}

declare global {
  interface Window {
    __boardPixiProof?: BoardPixiProof;
  }
}

type ColorStop = readonly [offset: number, color: number | string];
let rendererSequence = 0;

function shade(color: string, amount: number): string {
  const value = Number.parseInt(color.slice(1), 16);
  const target = amount > 0 ? 255 : 0;
  return `#${[16, 8, 0].map((shift) => {
    const channel = (value >> shift) & 255;
    return Math.round(channel + (target - channel) * Math.abs(amount)).toString(16).padStart(2, "0");
  }).join("")}`;
}

const CHECKER_FRAMES = {
  white: { x: 69.5, y: 66.5, width: 749, height: 749 },
  black: { x: 954, y: 67, width: 748, height: 748 },
} as const;

function inset(rect: SkinRect, amount: number): SkinRect {
  const depth = Math.min(amount, rect.width / 2, rect.height / 2);
  return { x: rect.x + depth, y: rect.y + depth,
    width: Math.max(0, rect.width - depth * 2), height: Math.max(0, rect.height - depth * 2) };
}

function validRect(rect: SkinRect): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    && rect.width > 0 && rect.height > 0;
}

/** One owned renderer draws both the reusable checker materials and the board skin. */
export async function createBoardSkinRenderer(theme: BoardMaterialTheme = boardMaterialThemes.charcoalGold, signal?: AbortSignal): Promise<BoardSkinRenderer> {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.classList.add("pointer-events-none");
  canvas.dataset.pixiBoardSkin = "true";
  const app = new Application();
  const ownedTextures: Texture[] = [];
  const gradients: FillGradient[] = [];
  let drawing: Graphics | null = null;
  let destroyed = false;
  const proof: BoardPixiProof = {
    theme: theme.id, instanceId: ++rendererSequence,
    status: "loading", renderer: "", pixiVersion: VERSION,
    applicationsCreated: 1, checkerMaterials: 0, diceMaterials: 0, diceBlankMaterials: 0, boardRenders: 0, pointCount: 0,
    logicalSize: { width: 0, height: 0, resolution: 1 }, tickerStarted: false,
  };

  function clearDrawing() {
    if (drawing) {
      app.stage.removeChild(drawing);
      drawing.destroy();
      drawing = null;
    }
    gradients.splice(0).forEach((gradient) => gradient.destroy());
  }

  function dispose() {
    if (destroyed) return;
    destroyed = true;
    signal?.removeEventListener("abort", abort);
    clearDrawing();
    if (app.renderer) app.destroy({ removeView: true }, { children: true });
    // Sources belong exclusively to this instance, never to the shared Assets cache.
    ownedTextures.splice(0).forEach((texture) => texture.destroy(true));
  }

  function abort() {
    // app.init owns its pending setup; if it finishes after cancellation, the check below disposes it.
    if (app.renderer) dispose();
  }
  signal?.addEventListener("abort", abort, { once: true });

  async function loadOwnedTexture(url: string): Promise<Texture> {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    if (destroyed || signal?.aborted) throw new DOMException("Board material creation cancelled", "AbortError");
    const texture = new Texture({ source: new ImageSource({ resource: image,
      scaleMode: "linear", autoGenerateMipmaps: true }) });
    ownedTextures.push(texture);
    return texture;
  }

  function tileFromFrame(atlas: Texture, frame: SkinRect, ramp?: MaterialColorRamp): Texture {
    const source = new Texture({ source: atlas.source,
      frame: new Rectangle(frame.x, frame.y, frame.width, frame.height) });
    const sprite = new Sprite({ texture: source, eventMode: "none" });
    const filter = ramp ? createMaterialColorFilter(ramp) : null;
    if (filter) sprite.filters = [filter];
    sprite.setSize(512, 512);
    try {
      // Isolate the atlas frame before repeating it; the GPU must not wrap into its neighbour.
      const texture = app.renderer.generateTexture({ target: sprite,
        frame: new Rectangle(0, 0, 512, 512), resolution: 1,
        textureSourceOptions: { scaleMode: "linear", autoGenerateMipmaps: true } });
      ownedTextures.push(texture);
      return texture;
    } finally {
      sprite.filters = [];
      filter?.destroy();
      sprite.destroy();
      source.destroy(false);
    }
  }

  function extractChecker(atlas: Texture, color: keyof typeof CHECKER_FRAMES): string {
    const frame = CHECKER_FRAMES[color];
    const texture = new Texture({ source: atlas.source,
      frame: new Rectangle(frame.x, frame.y, frame.width, frame.height) });
    const sprite = new Sprite({ texture, anchor: 0.5, x: 256, y: 256, eventMode: "none" });
    sprite.setSize(512, 512);
    const ramp = color === "white" ? theme.checkerLight : theme.checkerDark;
    const filter = ramp ? createMaterialColorFilter(ramp) : null;
    if (filter) sprite.filters = [filter];
    const mask = new Graphics().circle(256, 256, 256).fill(0xffffff);
    mask.context.batchMode = "batch";
    mask.eventMode = "none";
    const group = new Container({ eventMode: "none" });
    group.addChild(sprite, mask);
    sprite.mask = mask;
    app.stage.addChild(group);
    try {
      app.renderer.render({ container: app.stage });
      const extracted = app.renderer.extract.canvas({ target: group,
        frame: new Rectangle(0, 0, 512, 512), resolution: 1,
        clearColor: [0, 0, 0, 0], antialias: true }) as HTMLCanvasElement;
      proof.checkerMaterials += 1;
      return extracted.toDataURL("image/png");
    } finally {
      app.stage.removeChild(group);
      sprite.mask = null;
      group.removeChildren();
      sprite.filters = [];
      filter?.destroy();
      sprite.destroy();
      mask.destroy();
      group.destroy();
      texture.destroy(false);
    }
  }

  function linear(rect: SkinRect, stops: readonly ColorStop[], axis: "diagonal" | "vertical" | "horizontal" = "diagonal"): FillGradient {
    const gradient = new FillGradient({ textureSpace: "global",
      start: { x: rect.x, y: rect.y },
      end: { x: rect.x + (axis === "vertical" ? 0 : Math.max(1, rect.width)),
        y: rect.y + (axis === "horizontal" ? 0 : Math.max(1, rect.height)) },
      colorStops: stops.map(([offset, color]) => ({ offset, color })) });
    gradients.push(gradient);
    return gradient;
  }

  function rounded(g: Graphics, rect: SkinRect, radius: number, fill: FillInput) {
    if (rect.width <= 0 || rect.height <= 0) return;
    g.roundRect(rect.x, rect.y, rect.width, rect.height,
      Math.min(radius, rect.width / 2, rect.height / 2)).fill(fill);
  }

  try {
    await app.init({ canvas, width: 512, height: 512, backgroundAlpha: 0,
      antialias: true, autoDensity: true, resolution: 1,
      preference: "webgl", autoStart: false, sharedTicker: false });
    if (signal?.aborted) throw new DOMException("Board material creation cancelled", "AbortError");
    app.stage.eventMode = "none";
    app.stage.interactiveChildren = false;
    proof.renderer = app.renderer.name;
    const loads = await Promise.allSettled(
      [checkerAtlasUrl, inlayAtlasUrl, leatherUrl, diceBodyAtlasUrl].map(loadOwnedTexture),
    );
    const failure = loads.slice(0, 3).find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    const textures = loads.slice(0, 3).map((result) => {
      if (result.status !== "fulfilled") throw new Error("Board material could not be loaded");
      return result.value;
    });
    const [checkerAtlas, inlayAtlas, leather] = textures;
    const checkerImages = { white: extractChecker(checkerAtlas, "white"),
      black: extractChecker(checkerAtlas, "black") };
    const diceBody = loads[3];
    let diceImages: DiceMaterialImages | null = null;
    if (diceBody.status === "fulfilled") {
      try {
        diceImages = createDiceMaterialImages(app, diceBody.value, theme);
        proof.diceMaterials = Object.values(diceImages).reduce((count, faces) =>
          count + Object.keys(faces).filter((value) => Number(value) >= 1 && Number(value) <= 6).length, 0);
        proof.diceBlankMaterials = Number(Boolean(diceImages.light[0])) + Number(Boolean(diceImages.dark[0]));
      } catch (error) {
        console.warn("Dice materials unavailable; retaining native dice", error);
      }
    }
    const isCharcoal = theme.id === "charcoalGold";
    const neutralMaterial = isCharcoal ? undefined : { dark: "#777777", light: "#ffffff" };
    const goldTile = tileFromFrame(inlayAtlas, { x: 0, y: 0, width: 887, height: 887 }, neutralMaterial);
    const ivoryTile = tileFromFrame(inlayAtlas, { x: 887, y: 0, width: 887, height: 887 }, neutralMaterial);
    const leatherTile = tileFromFrame(leather, { x: 0, y: 0, width: leather.width, height: leather.height }, neutralMaterial);

    function pattern(texture: Texture, tileSize: number) {
      // These tiles were already uploaded by generateTexture with clamp sampling.
      // Changing addressMode alone does not invalidate Pixi's cached GPU sampler.
      texture.source.style.addressMode = "repeat";
      texture.source.style.update();
      return { texture, matrix: new Matrix().scale(tileSize / 512, tileSize / 512),
        textureSpace: "global" as const };
    }
    const leatherPattern = pattern(leatherTile, 360);
    const goldPattern = pattern(goldTile, 280);
    const ivoryPattern = pattern(ivoryTile, 280);

    function recessed(g: Graphics, rect: SkinRect, depth: number, dark = false) {
      const wall = Math.min(depth, rect.width / 7, rect.height / 7);
      const base = dark ? theme.tray : theme.field;
      rounded(g, rect, 6, linear(rect, isCharcoal
        ? [[0, "#b2a78480"], [0.4, "#262922"], [1, "#060807"]]
        : [[0, shade(theme.trim, 0.15)], [0.4, shade(base, -0.35)], [1, shade(base, -0.7)]]));
      rounded(g, inset(rect, 1), 5, linear(rect, isCharcoal
        ? [[0, "#010303"], [0.48, "#050807"], [1, "#55594d"]]
        : [[0, shade(base, -0.65)], [0.48, shade(base, -0.4)], [1, shade(base, 0.1)]]));
      const floor = inset(rect, wall);
      rounded(g, floor, 3, isCharcoal ? dark ? 0x070b0c : 0x111617 : base);
      rounded(g, floor, 3, { ...leatherPattern,
        color: isCharcoal ? dark ? 0x303638 : 0x444b4d : base, alpha: isCharcoal ? 0.85 : theme.lightSurface ? 0.24 : 0.4 });
      rounded(g, floor, 3, linear(floor, [[0, "#00000055"], [0.2, "#00000000"], [1, "#ffffff05"]]));
      const shadow = Math.min(10, rect.width / 6, rect.height / 6);
      g.rect(floor.x, floor.y, floor.width, shadow).fill(linear({ ...floor, height: shadow },
        [[0, "#000000b3"], [1, "#00000000"]], "vertical"));
      g.rect(floor.x, floor.y, shadow, floor.height).fill(linear({ ...floor, width: shadow },
        [[0, "#00000080"], [1, "#00000000"]], "horizontal"));
    }

    function render(layout: BoardSkinLayout) {
      if (destroyed) return;
      if (!Number.isFinite(layout.width) || !Number.isFinite(layout.height)
        || layout.width <= 0 || layout.height <= 0 || !validRect(layout.field)
        || !validRect(layout.bar) || layout.points.length !== 24
        || !layout.points.every(validRect) || !layout.trays.every(validRect)) return;
      try {
        clearDrawing();
        const resolution = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        app.renderer.resize(layout.width, layout.height, resolution);
        const g = new Graphics();
        // WebGL batching also keeps short-lived gradient sources out of Pixi's
        // global non-batched Graphics bind-group cache during resize/redraw.
        g.context.batchMode = "batch";
        g.eventMode = "none";
        drawing = g;
        app.stage.addChild(g);
        const outer = { x: 0, y: 0, width: layout.width, height: layout.height };
        const bevel = Math.max(1, Math.min(6, layout.width / 160));

        rounded(g, inset(outer, 0.5), 11, 0x040708);
        rounded(g, inset(outer, 1.2), 10, linear(outer,
          isCharcoal ? [[0, "#d4bd83"], [0.18, "#685d40"], [0.55, "#332e22"], [1, "#8d774b"]]
            : [[0, shade(theme.trim, 0.25)], [0.18, theme.trim], [0.55, shade(theme.trim, -0.65)], [1, shade(theme.trim, -0.2)]]));
        rounded(g, inset(outer, 2.2), 9, linear(outer,
          isCharcoal ? [[0, "#4a4e48"], [0.12, "#1c2121"], [0.7, "#151a1b"], [1, "#050809"]]
            : [[0, shade(theme.rim, 0.24)], [0.12, theme.rim], [0.7, shade(theme.rim, -0.08)], [1, shade(theme.rim, -0.6)]]));
        const rim = inset(outer, bevel);
        rounded(g, rim, 6, isCharcoal ? 0x171c1d : theme.rim);
        rounded(g, rim, 6, { ...leatherPattern, color: isCharcoal ? 0x555c5d : theme.rim, alpha: isCharcoal ? 0.9 : 0.4 });
        rounded(g, rim, 6, linear(outer, [[0, "#ffffff12"], [0.3, "#ffffff00"], [1, "#00000047"]]));

        recessed(g, layout.field, Math.min(5, bevel));
        for (const point of layout.points) {
          const baseY = point.top ? point.y : point.y + point.height;
          const tipX = point.x + point.width / 2;
          const tipY = point.top ? point.y + point.height : point.y;
          const vertices = [point.x, baseY, point.x + point.width, baseY, tipX, tipY];
          const endpoints = point.light ? theme.pointLight : theme.pointDark;
          const colors: readonly ColorStop[] = isCharcoal
            ? point.light ? [[0, "#f7ead0"], [0.55, "#edddbc"], [1, "#d8c09a"]]
              : [[0, "#cbb080"], [0.55, "#bc9a60"], [1, "#a07d43"]]
            : [[0, endpoints[0]], [0.55, endpoints[0]], [1, endpoints[1]]];
          const material = point.light ? ivoryPattern : goldPattern;
          // Both rows share a fine material grid and the same light direction.
          g.poly(vertices, true).fill(linear(point, colors, "horizontal"));
          g.poly(vertices, true).fill({ ...material,
            matrix: material.matrix.clone().scale(0.46, 0.46),
            color: isCharcoal ? 0xffffff : endpoints[0], alpha: isCharcoal ? point.light ? 0.38 : 0.44 : 0.22 });
          g.poly(vertices, true).stroke({ width: 0.8, alignment: 1, color: 0x070a09, alpha: 0.72, join: "miter" });
          g.moveTo(point.x + 0.5, baseY).lineTo(tipX, tipY)
            .stroke({ width: 0.55, color: 0xfff3ce, alpha: 0.17 });
          g.moveTo(tipX, tipY).lineTo(point.x + point.width - 0.5, baseY)
            .stroke({ width: 0.85, color: 0x080a08, alpha: 0.72 });
          const baseEdgeY = baseY + (point.top ? 0.75 : -0.75);
          g.moveTo(point.x + 1, baseEdgeY).lineTo(point.x + point.width - 1, baseEdgeY)
            .stroke({ width: 0.7, color: point.top ? 0xfff2ce : 0x080a08,
              alpha: point.top ? 0.14 : 0.55 });
        }

        const bar = layout.bar;
        rounded(g, bar, 3, 0x020505);
        rounded(g, inset(bar, 1.5), 2, linear(bar,
          isCharcoal ? [[0, "#636c68"], [0.08, "#303a37"], [0.85, "#121a1a"], [1, "#020505"]]
            : [[0, shade(theme.bar, 0.3)], [0.08, shade(theme.bar, 0.08)], [0.85, theme.bar], [1, shade(theme.bar, -0.7)]], "horizontal"));
        const barFace = inset(bar, Math.min(4, bar.width / 10));
        rounded(g, barFace, 2, linear(barFace,
          isCharcoal ? [[0, "#232c2c"], [0.55, "#1b2424"], [1, "#121a1b"]]
            : [[0, shade(theme.bar, 0.07)], [0.55, theme.bar], [1, shade(theme.bar, -0.18)]], "horizontal"));
        rounded(g, barFace, 2, { ...leatherPattern,
          matrix: leatherPattern.matrix.clone().scale(0.6, 0.6), color: isCharcoal ? 0x565f60 : theme.bar, alpha: isCharcoal ? 0.38 : 0.25 });
        rounded(g, barFace, 2, linear(barFace,
          [[0, "#ffffff08"], [0.45, "#ffffff00"], [1, "#00000024"]], "horizontal"));
        g.moveTo(bar.x + 2, bar.y + 1.5).lineTo(bar.x + bar.width - 2, bar.y + 1.5)
          .stroke({ width: 0.8, color: 0xdce0d2, alpha: 0.2 });
        g.rect(bar.x + bar.width - 2, bar.y + 2, 1.5, bar.height - 4)
          .fill({ color: 0x020505, alpha: 0.85 });
        g.rect(bar.x + 2, bar.y + bar.height - 2, bar.width - 4, 1.5)
          .fill({ color: 0x020505, alpha: 0.8 });
        for (const tray of layout.trays) recessed(g, inset(tray, 0.5), Math.min(7, tray.width / 8), true);

        // Only the geometry supplied by the DOM is rendered; labels, counters and input stay native.
        app.renderer.render({ container: app.stage });
        proof.boardRenders += 1;
        proof.pointCount = layout.points.length;
        proof.logicalSize = { width: layout.width, height: layout.height, resolution };
        proof.status = "ready";
        // A cancelled async mount must not replace the proof of the visible canvas.
        window.__boardPixiProof = proof;
      } catch (error) {
        proof.status = "error";
        proof.error = error instanceof Error ? error.message : String(error);
        throw error;
      }
    }

    return { canvas, checkerImages, diceImages, render, destroy() {
      dispose();
      proof.status = "destroyed";
    } };
  } catch (error) {
    proof.status = "error";
    proof.error = error instanceof Error ? error.message : String(error);
    dispose();
    throw error;
  }
}
