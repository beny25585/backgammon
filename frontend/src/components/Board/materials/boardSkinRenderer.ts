import {
  Application,
  CanvasSource,
  Color,
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
import polishedCheckerAtlasUrl from "../../../assets/6b-checker-polished-atlas.png";
import matteCheckerAtlasUrl from "../../../assets/6b-checker-matte-atlas.png";
import marbleCheckerAtlasUrl from "../../../assets/6b-checker-marble-atlas.png";
import inlayAtlasUrl from "../../../assets/6b-board-inlay-materials.png";
import leatherUrl from "../../../assets/6b-charcoal-leather.png";
import woodUrl from "../../../assets/6b-material-mahogany.png";
import brownGoldMaterialsUrl from "../../../assets/6b-brown-gold-materials.jpg";
import diceBodyAtlasUrl from "../../../assets/6b-dice-body-atlas.png";
import { createDiceMaterialImages, type DiceMaterialImages } from "./diceMaterialRenderer";
import { boardMaterialThemes, type BoardMaterialTheme, type MaterialColorRamp } from "./boardMaterialThemes";
import { createMaterialColorFilter } from "./materialColorFilter";
import { DEFAULT_CHECKER_STYLE, type CheckerStyle } from "./checkerStyles";

const checkerAtlasUrls: Record<CheckerStyle, string> = {
  polished: polishedCheckerAtlasUrl,
  matte: matteCheckerAtlasUrl,
  marble: marbleCheckerAtlasUrl,
};

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

/** Bake the selected pigment without tinting away the atlas's shadows and reflections. */
function recolorCheckerMaterial(canvas: HTMLCanvasElement, ramp: MaterialColorRamp | undefined,
  color: keyof typeof CHECKER_FRAMES) {
  if (!ramp) return;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Checker material canvas unavailable");
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = image.data;
  const dark = new Color(ramp.dark).toRgbArray();
  const light = new Color(ramp.light).toRgbArray();
  const pigmentMix = color === "white" ? 0.78 : 0.55;
  const pigment = dark.map((channel, index) => channel + (light[index] - channel) * pigmentMix);
  // The ivory and charcoal source faces have different base luminance in this atlas.
  const sourceBody = color === "white" ? 0.88 : 0.18;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] === 0) continue;
    const luminance = (pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722) / 255;
    const reflection = Math.max(0, Math.min(1, (luminance - sourceBody) / (1 - sourceBody)));
    const diffuse = Math.min(1, luminance / sourceBody) * (1 - reflection);
    for (let channel = 0; channel < 3; channel += 1) {
      pixels[offset + channel] = Math.round(255 * (pigment[channel] * diffuse + 0.98 * reflection));
    }
    // ImageData is straight RGBA; leave every alpha byte unchanged.
  }
  context.putImageData(image, 0, 0);
}

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
export async function createBoardSkinRenderer(theme: BoardMaterialTheme = boardMaterialThemes.charcoalGold, signal?: AbortSignal,
  checkerStyle: CheckerStyle = DEFAULT_CHECKER_STYLE): Promise<BoardSkinRenderer> {
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

  async function loadImage(url: string): Promise<HTMLImageElement> {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    if (destroyed || signal?.aborted) throw new DOMException("Board material creation cancelled", "AbortError");
    return image;
  }

  async function loadOwnedTexture(url: string): Promise<Texture> {
    const image = await loadImage(url);
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

  function createAtlasTile(image: HTMLImageElement, column: number, leather?: { base: string; mean: number }): Texture {
    // Opaque CPU crops keep border pixels filled at every mip level.
    const size = 512;
    const sourceSize = image.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Club board material canvas unavailable");
    const bleed = 3;
    const span = sourceSize - 2 * bleed;
    context.drawImage(image, column * sourceSize + bleed, bleed, span, span, 0, 0, size, size);
    if (leather) {
      // Borrow the relief from the atlas, using each theme's own pigment.
      const pixels = context.getImageData(0, 0, size, size);
      const [red, green, blue] = new Color(leather.base).toRgbArray();
      const contrast = theme.lightSurface ? 1.45 : 2.15;
      for (let i = 0; i < pixels.data.length; i += 4) {
        const luminance = 0.2126 * pixels.data[i] + 0.7152 * pixels.data[i + 1] + 0.0722 * pixels.data[i + 2];
        const relief = (luminance - leather.mean) * contrast;
        pixels.data[i] = red * 255 + relief;
        pixels.data[i + 1] = green * 255 + relief;
        pixels.data[i + 2] = blue * 255 + relief;
      }
      context.putImageData(pixels, 0, 0);
    }
    const texture = new Texture({ source: new CanvasSource({
      resource: canvas, scaleMode: "linear", autoGenerateMipmaps: true,
    }) });
    ownedTextures.push(texture);
    return texture;
  }

  async function loadMaterialTiles(isBrownGold: boolean) {
    const atlas = await loadImage(brownGoldMaterialsUrl).then(image => {
      if (image.naturalWidth !== 3 * image.naturalHeight) throw new Error("Club board atlas must contain three square tiles");
      return image;
    }).catch((error: unknown) => {
      if (destroyed || signal?.aborted) throw error;
      console.warn("Club board materials unavailable; using shared board materials", error);
      return null;
    });
    const leather = atlas ?? await loadImage(leatherUrl);
    // The two source swatches have different measured luminance midpoints.
    const mean = atlas ? 25 : 92;
    const fieldTile = createAtlasTile(leather, 0, { base: theme.field, mean });
    const barTile = createAtlasTile(leather, 0, { base: theme.bar, mean });
    if (isBrownGold && atlas) return {
      dedicated: true, fieldTile, barTile, goldTile: createAtlasTile(atlas, 1), ivoryTile: createAtlasTile(atlas, 2),
    };

    const inlay = await loadOwnedTexture(inlayAtlasUrl);
    const ramp = theme.id === "charcoalGold" || isBrownGold ? undefined : { dark: "#777777", light: "#ffffff" };
    return {
      dedicated: false, fieldTile, barTile,
      goldTile: tileFromFrame(inlay, { x: 0, y: 0, width: 887, height: 887 }, ramp),
      ivoryTile: tileFromFrame(inlay, { x: 887, y: 0, width: 887, height: 887 }, ramp),
    };
  }

  function extractChecker(atlas: Texture, color: keyof typeof CHECKER_FRAMES): string {
    const frame = CHECKER_FRAMES[color];
    const texture = new Texture({ source: atlas.source,
      frame: new Rectangle(frame.x, frame.y, frame.width, frame.height) });
    const sprite = new Sprite({ texture, anchor: 0.5, x: 256, y: 256, eventMode: "none" });
    sprite.setSize(512, 512);
    const ramp = color === "white" ? theme.checkerLight : theme.checkerDark;
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
      recolorCheckerMaterial(extracted, ramp, color);
      proof.checkerMaterials += 1;
      return extracted.toDataURL("image/png");
    } finally {
      app.stage.removeChild(group);
      sprite.mask = null;
      group.removeChildren();
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
    const isBrownGold = theme.id === "brownGold";
    const [checker, surfaces, diceBody, wood] = await Promise.allSettled([
      loadOwnedTexture(checkerAtlasUrls[checkerStyle]),
      loadMaterialTiles(isBrownGold),
      loadOwnedTexture(diceBodyAtlasUrl),
      isBrownGold ? loadOwnedTexture(woodUrl) : Promise.resolve(null),
    ]);
    if (destroyed || signal?.aborted) throw new DOMException("Board material creation cancelled", "AbortError");
    if (checker.status === "rejected") throw checker.reason;
    if (surfaces.status === "rejected") throw surfaces.reason;
    const checkerAtlas = checker.value;
    const checkerImages = { white: extractChecker(checkerAtlas, "white"),
      black: extractChecker(checkerAtlas, "black") };
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
    const { dedicated, fieldTile, barTile, goldTile, ivoryTile } = surfaces.value;
    const woodTexture = wood?.status === "fulfilled" ? wood.value : null;

    function pattern(texture: Texture, tileSize: number, mirror = dedicated) {
      // Generated textures may have already been uploaded with clamp sampling.
      // Changing addressMode alone does not invalidate Pixi's cached GPU sampler.
      texture.source.style.addressMode = mirror ? "mirror-repeat" : "repeat";
      texture.source.style.update();
      return { texture, matrix: new Matrix().scale(tileSize / 512, tileSize / 512),
        textureSpace: "global" as const };
    }
    const leatherPattern = pattern(fieldTile, 432, true);
    const barPattern = pattern(barTile, 365, true);
    const goldPattern = pattern(goldTile, dedicated ? 260 : 280);
    const ivoryPattern = pattern(ivoryTile, dedicated ? 235 : 280);

    function brassEdge(g: Graphics, rect: SkinRect, radius: number, width: number) {
      if (rect.width <= 0 || rect.height <= 0) return;
      const corner = Math.min(radius, rect.width / 2, rect.height / 2);
      g.roundRect(rect.x, rect.y, rect.width, rect.height, corner)
        .stroke({ width: width + 1.4, alignment: 1, color: 0x5a3719 });
      g.roundRect(rect.x, rect.y, rect.width, rect.height, corner)
        .stroke({ width, alignment: 1, fill: linear(rect,
          [[0, "#ffe6ae"], [0.23, "#e2b36c"], [0.57, "#b78545"], [0.82, "#cd9b57"], [1, "#f3c479"]]) });
    }

    function drawWoodFrame(g: Graphics, rim: SkinRect, field: SkinRect, texture: Texture) {
      const x = rim.x + 2;
      const y = rim.y + 2;
      const right = rim.x + rim.width - 2;
      const bottom = rim.y + rim.height - 2;
      const innerX = Math.max(x, field.x);
      const innerY = Math.max(y, field.y);
      const innerRight = Math.min(right, field.x + field.width);
      const innerBottom = Math.min(bottom, field.y + field.height);
      const rails = [
        { vertices: [x, y, right, y, innerRight, innerY, innerX, innerY], span: innerY - y, vertical: false, slice: 0.11 },
        { vertices: [innerX, innerBottom, innerRight, innerBottom, right, bottom, x, bottom], span: bottom - innerBottom, vertical: false, slice: 0.68 },
        { vertices: [x, y, innerX, innerY, innerX, innerBottom, x, bottom], span: innerX - x, vertical: true, slice: 0.38 },
        { vertices: [innerRight, innerY, right, y, right, bottom, innerRight, innerBottom], span: right - innerRight, vertical: true, slice: 0.53 },
      ];
      // Sample each rail once along its length. The grain changes direction only at the mitres.
      for (const { vertices, span, vertical, slice } of rails) {
        if (span <= 0) continue;
        const sampling = vertical ? new Matrix(0, 0.19, 1, 0, 0, slice) : new Matrix(1, 0, 0, 0.19, 0, slice);
        g.poly(vertices, true).fill({ texture, textureSpace: "local", matrix: sampling.invert(),
          color: 0xe5cdb0, alpha: 0.59 });
      }
    }

    function satinSheen(top: boolean) {
      const center = { x: 0.28, y: top ? 0.23 : 0.65 };
      const gradient = new FillGradient({
        type: "radial", textureSpace: "local", center, outerCenter: center,
        outerRadius: 0.76, scale: 0.44, rotation: 0.67, textureSize: 128,
        colorStops: [
          { offset: 0, color: "#fff0bd54" },
          { offset: 0.38, color: "#fff0bd29" },
          { offset: 0.72, color: "#fff0bd0b" },
          { offset: 1, color: "#fff0bd00" },
        ],
      });
      gradients.push(gradient);
      return gradient;
    }

    function recessed(g: Graphics, rect: SkinRect, depth: number, dark = false) {
      const wall = Math.min(depth, rect.width / 7, rect.height / 7);
      const base = dark ? theme.tray : theme.field;
      const corner = isBrownGold && dark ? Math.max(5, Math.min(11, rect.width / 7)) : 6;
      rounded(g, rect, corner, linear(rect, isCharcoal
        ? [[0, "#b2a78480"], [0.4, "#262922"], [1, "#060807"]]
        : isBrownGold ? [[0, "#25180e"], [0.38, "#100c08"], [1, "#060504"]]
          : [[0, shade(theme.trim, 0.15)], [0.4, shade(base, -0.35)], [1, shade(base, -0.7)]]));
      rounded(g, inset(rect, 1), corner - 1, linear(rect, isCharcoal
        ? [[0, "#010303"], [0.48, "#050807"], [1, "#55594d"]]
        : [[0, shade(base, -0.65)], [0.48, shade(base, -0.4)], [1, shade(base, 0.1)]]));
      const floor = inset(rect, wall);
      const floorCorner = isBrownGold ? Math.max(3, corner - wall) : 3;
      rounded(g, floor, floorCorner, linear(floor,
        [[0, shade(base, 0.065)], [0.4, base], [1, shade(base, -0.16)]]));
      rounded(g, floor, floorCorner, { ...leatherPattern,
        alpha: dark ? 0.24 : 0.91 });
      rounded(g, floor, floorCorner, linear(floor, isBrownGold
        ? [[0, "#e9e1ce04"], [0.44, "#00000000"], [1, "#00000025"]]
        : [[0, "#ffffff0c"], [0.28, "#ffffff00"], [1, "#00000018"]]));
      const shadow = Math.min(10, rect.width / 6, rect.height / 6);
      g.rect(floor.x, floor.y, floor.width, shadow).fill(linear({ ...floor, height: shadow },
        [[0, "#000000b3"], [1, "#00000000"]], "vertical"));
      g.rect(floor.x, floor.y, shadow, floor.height).fill(linear({ ...floor, width: shadow },
        [[0, "#00000080"], [1, "#00000000"]], "horizontal"));
      if (isBrownGold && dark) brassEdge(g, inset(rect, 1), corner - 1, 1.1);
    }

    function render(layout: BoardSkinLayout) {
      if (destroyed) return;
      if (!Number.isFinite(layout.width) || !Number.isFinite(layout.height)
        || layout.width <= 0 || layout.height <= 0 || !validRect(layout.field)
        || !validRect(layout.bar) || layout.points.length !== 24
        || !layout.points.every(validRect) || !layout.trays.every(validRect)) return;
      try {
        clearDrawing();
        const resolution = Math.max(isBrownGold ? 1.5 : 1, Math.min(2, window.devicePixelRatio || 1));
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
        const corner = isBrownGold ? Math.max(10, Math.min(17, layout.width / 95)) : 10;

        rounded(g, inset(outer, 0.5), corner + 1, 0x040708);
        rounded(g, inset(outer, 1.2), corner, linear(outer,
          isCharcoal ? [[0, "#d4bd83"], [0.18, "#685d40"], [0.55, "#332e22"], [1, "#8d774b"]]
            : [[0, shade(theme.trim, 0.25)], [0.18, theme.trim], [0.55, shade(theme.trim, -0.65)], [1, shade(theme.trim, -0.2)]]));
        rounded(g, inset(outer, 2.2), corner - 1, linear(outer,
          isCharcoal ? [[0, "#4a4e48"], [0.12, "#1c2121"], [0.7, "#151a1b"], [1, "#050809"]]
            : [[0, shade(theme.rim, 0.24)], [0.12, theme.rim], [0.7, shade(theme.rim, -0.08)], [1, shade(theme.rim, -0.6)]]));
        const rim = inset(outer, bevel);
        rounded(g, rim, corner - 4, linear(rim,
          [[0, shade(theme.rim, 0.08)], [0.38, theme.rim], [1, shade(theme.rim, -0.22)]]));
        if (woodTexture) drawWoodFrame(g, rim, layout.field, woodTexture);
        rounded(g, rim, corner - 4, linear(outer, isBrownGold
          ? [[0, "#ffe0b51c"], [0.16, "#ffe0b509"], [0.48, "#ffe0b500"], [1, "#00000038"]]
          : [[0, "#ffffff24"], [0.16, "#ffffff08"], [0.48, "#ffffff00"], [1, "#00000035"]]));
        if (isBrownGold) brassEdge(g, inset(outer, 1.6), corner, 1.6);
        else {
          g.moveTo(rim.x + 6, rim.y + 0.6).lineTo(rim.x + rim.width - 6, rim.y + 0.6)
            .stroke({ width: 0.8, color: 0xfff4d9, alpha: 0.28 });
          g.moveTo(rim.x + 0.6, rim.y + 6).lineTo(rim.x + 0.6, rim.y + rim.height - 6)
            .stroke({ width: 0.7, color: 0xffffff, alpha: 0.14 });
        }

        recessed(g, layout.field, Math.min(5, bevel));
        const topPoint = layout.points.find(point => point.top);
        const bottomPoint = layout.points.find(point => !point.top);
        // Extend the painted tips only on wide boards, leaving a center lane and the DOM point boxes alone.
        const tipExtension = isBrownGold && topPoint && bottomPoint
          ? Math.max(0, Math.min(40, (bottomPoint.y - topPoint.y - topPoint.height - 36) / 2))
          : 0;
        const topSheen = isBrownGold ? satinSheen(true) : null;
        const bottomSheen = isBrownGold ? satinSheen(false) : null;
        for (const point of layout.points) {
          const baseY = point.top ? point.y : point.y + point.height;
          const tipX = point.x + point.width / 2;
          const tipY = point.top ? point.y + point.height + tipExtension : point.y - tipExtension;
          const vertices = [point.x, baseY, point.x + point.width, baseY, tipX, tipY];
          const endpoints = point.light ? theme.pointLight : theme.pointDark;
          const colors: readonly ColorStop[] = isCharcoal
            ? point.light ? [[0, "#f7ead0"], [0.55, "#edddbc"], [1, "#d8c09a"]]
              : [[0, "#cbb080"], [0.55, "#bc9a60"], [1, "#a07d43"]]
            : isBrownGold
              ? [[0, shade(endpoints[0], 0.16)], [0.26, endpoints[0]], [0.75, endpoints[1]], [1, shade(endpoints[1], -0.08)]]
              : [[0, endpoints[0]], [0.55, endpoints[0]], [1, endpoints[1]]];
          const material = point.light ? ivoryPattern : goldPattern;
          const satinLight = { ...point, y: Math.min(baseY, tipY), width: point.width * 1.75, height: Math.abs(baseY - tipY) };
          g.poly(vertices, true).fill(isBrownGold ? linear(satinLight, colors) : linear(point, colors, "horizontal"));
          g.poly(vertices, true).fill({ ...material,
            matrix: dedicated ? material.matrix : material.matrix.clone().scale(0.46, 0.46),
            color: isCharcoal || isBrownGold ? 0xffffff : endpoints[0],
            alpha: dedicated ? (point.light ? 0.54 : 0.62) : isBrownGold ? (point.light ? 0.14 : 0.19) : (point.light ? 0.065 : 0.08) });
          const sheen = point.top ? topSheen : bottomSheen;
          if (sheen) {
            g.poly(vertices, true).fill(sheen);
            const depth = Math.min(23, point.height * 0.095);
            const edge = { ...point, y: point.top ? baseY : baseY - depth, height: depth };
            g.poly(vertices, true).fill(linear(edge, point.top
              ? [[0, "#190d08b0"], [0.21, "#190d086e"], [0.56, "#190d0828"], [1, "#190d0800"]]
              : [[0, "#190d0800"], [0.48, "#190d0817"], [0.82, "#190d0838"], [1, "#190d0873"]], "vertical"));
          }
          g.poly(vertices, true).stroke({ width: isBrownGold ? 0.7 : 0.9, alignment: 1, color: 0x070a09,
            alpha: isBrownGold ? 0.5 : 0.8, join: "miter" });
          g.moveTo(point.x + 0.5, baseY).lineTo(tipX, tipY)
            .stroke({ width: isBrownGold ? 0.82 : 0.65, color: 0xfff3ce, alpha: isBrownGold ? 0.59 : 0.34 });
          g.moveTo(tipX, tipY).lineTo(point.x + point.width - 0.5, baseY)
            .stroke({ width: isBrownGold ? 0.7 : 0.9, color: 0x080a08, alpha: isBrownGold ? 0.54 : 0.8 });
          const baseEdgeY = baseY + (point.top ? 0.75 : -0.75);
          if (!isBrownGold) {
            g.moveTo(point.x + 1, baseEdgeY).lineTo(point.x + point.width - 1, baseEdgeY)
              .stroke({ width: 0.7, color: point.top ? 0xfff2ce : 0x080a08,
                alpha: point.top ? 0.14 : 0.55 });
          }
        }

        // One light direction across the field and inlays reads as a sealed, solid surface.
        const fieldFace = inset(layout.field, Math.min(5, bevel));
        rounded(g, fieldFace, 3, linear(fieldFace, isBrownGold
          ? [[0, "#eee9d505"], [0.36, "#eee9d500"], [0.62, "#00000000"], [1, "#00000012"]]
          : [[0, "#ffffff14"], [0.24, "#ffffff04"], [0.58, "#ffffff00"], [1, "#0000000d"]]));

        const bar = layout.bar;
        rounded(g, bar, 3, 0x020505);
        rounded(g, inset(bar, 1.5), 2, linear(bar,
          isCharcoal ? [[0, "#636c68"], [0.08, "#303a37"], [0.85, "#121a1a"], [1, "#020505"]]
            : [[0, shade(theme.bar, 0.3)], [0.08, shade(theme.bar, 0.08)], [0.85, theme.bar], [1, shade(theme.bar, -0.7)]], "horizontal"));
        const barFace = inset(bar, Math.min(4, bar.width / 10));
        rounded(g, barFace, 2, linear(barFace,
          isCharcoal ? [[0, "#232c2c"], [0.55, "#1b2424"], [1, "#121a1b"]]
            : [[0, shade(theme.bar, 0.07)], [0.55, theme.bar], [1, shade(theme.bar, -0.18)]], "horizontal"));
        rounded(g, barFace, 2, { ...barPattern, alpha: 0.93 });
        rounded(g, barFace, 2, linear(barFace, isBrownGold
          ? [[0, "#a394791c"], [0.27, "#a394790b"], [0.52, "#00000009"], [1, "#00000099"]]
          : [[0, "#ffffff1b"], [0.18, "#ffffff08"], [0.55, "#ffffff00"], [1, "#00000042"]], "horizontal"));
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
