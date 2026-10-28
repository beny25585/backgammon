import {
  Color,
  Container,
  FillGradient,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
  type Application,
} from "pixi.js";
import { pipPositions } from "../../animations/RollingDie/pipPositions";
import { boardMaterialThemes, type BoardMaterialTheme } from "./boardMaterialThemes";
import { createMaterialColorFilter } from "./materialColorFilter";

export type DiceMaterialImages = Record<"light" | "dark", Record<number, string>>;

const SIZE = 256;
const BODY_PADDING = 4;
const BODY_RADIUS = 31.5;
const PIP_RADIUS = 21.5;

// Main rounded-square bodies, excluding the transparent atlas-cell gutters.
const BODY_FRAMES = {
  light: { x: 107, y: 89, width: 708, height: 708 },
  dark: { x: 959, y: 89, width: 709, height: 708 },
} as const;

/** Bake static faces with the caller's renderer; leave its atlas and animation owned by the caller. */
export function createDiceMaterialImages(app: Application, bodyAtlas: Texture,
  theme: BoardMaterialTheme = boardMaterialThemes.charcoalGold): DiceMaterialImages {
  const images: DiceMaterialImages = { light: {}, dark: {} };
  const mixColor = (from: string, to: string, amount: number) => {
    const start = new Color(from).toRgbArray();
    const end = new Color(to).toRgbArray();
    return new Color(start.map((channel, index) => channel + (end[index] - channel) * amount)).toHex();
  };
  const darkDiceRamp = theme.diceDark ?? { dark: "#101415", light: "#34393b", gain: 3 };
  const readableDarkDiceRamp = {
    ...darkDiceRamp,
    dark: mixColor(darkDiceRamp.dark, "#ffffff", 0.12),
    light: mixColor(darkDiceRamp.light, "#ffffff", 0.08),
  };
  const darkPipLight = mixColor(theme.pipLight, "#ffffff", 0.78);
  const darkPipWell = [[0, mixColor(darkPipLight, theme.pipDark, 0.09)],
    [0.5, darkPipLight], [1, "#ffffff"]] as const;
  const themedPips = theme.id === "charcoalGold" ? null : {
    lightLip: [[0, theme.pipDark], [0.45, mixColor(theme.pipDark, theme.pipLight, 0.35)], [1, theme.pipLight]] as const,
    darkLip: [[0, theme.pipDark], [0.5, mixColor(theme.pipDark, theme.pipLight, 0.12)], [1, mixColor(theme.pipDark, theme.pipLight, 0.4)]] as const,
    lightWell: [[0, theme.pipDark], [0.55, theme.pipDark], [1, mixColor(theme.pipDark, theme.pipLight, 0.18)]] as const,
  };

  for (const tone of ["light", "dark"] as const) {
    const frame = BODY_FRAMES[tone];
    const bodyTexture = new Texture({ source: bodyAtlas.source,
      frame: new Rectangle(frame.x, frame.y, frame.width, frame.height) });
    try {
      for (let value = 0; value <= 6; value += 1) {
        // Zero is the shared blank resin body for the doubling cube.
        const positions = value === 0 ? [] : pipPositions[value];
        if (!positions) throw new Error(`Missing dice pip layout for ${value}`);
        const group = new Container({ eventMode: "none" });
        group.interactiveChildren = false;
        const body = new Sprite({ texture: bodyTexture, anchor: 0.5,
          x: SIZE / 2, y: SIZE / 2, eventMode: "none" });
        const scale = (SIZE - BODY_PADDING * 2) / Math.max(frame.width, frame.height);
        body.setSize(frame.width * scale, frame.height * scale);
        const bodyMask = new Graphics();
        bodyMask.context.batchMode = "batch";
        bodyMask.eventMode = "none";
        bodyMask.roundRect(BODY_PADDING, BODY_PADDING, SIZE - BODY_PADDING * 2,
          SIZE - BODY_PADDING * 2, BODY_RADIUS).fill(0xffffff);
        body.mask = bodyMask;
        const shadow = new Graphics();
        shadow.context.batchMode = "batch";
        shadow.eventMode = "none";
        shadow.roundRect(6, 8, 247, 247, BODY_RADIUS).fill({ color: 0x020405, alpha: 0.16 });
        shadow.roundRect(5, 6, 247, 247, BODY_RADIUS).fill({ color: 0x020405, alpha: 0.18 });
        const pips = new Graphics();
        pips.context.batchMode = "batch";
        pips.eventMode = "none";
        const gradients: FillGradient[] = [];
        const baseRamp = value === 0 && tone === "light" ? theme.cube
          : tone === "light" ? theme.diceLight : theme.diceDark;
        const ramp = tone === "dark" && value > 0 ? readableDarkDiceRamp : baseRamp;
        let colorFilter: ReturnType<typeof createMaterialColorFilter> | null = null;
        group.addChild(shadow, body, bodyMask, pips);

        function pipGradient(x: number, y: number, colors: readonly (readonly [number, string])[]) {
          const gradient = new FillGradient({ textureSpace: "global",
            start: { x: x - PIP_RADIUS, y: y - PIP_RADIUS },
            end: { x: x + PIP_RADIUS, y: y + PIP_RADIUS },
            colorStops: colors.map(([offset, color]) => ({ offset, color })) });
          gradients.push(gradient);
          return gradient;
        }

        try {
          if (ramp) {
            colorFilter = createMaterialColorFilter(ramp);
            body.filters = [colorFilter];
          }
          if (tone === "dark" && value > 0) {
            pips.roundRect(BODY_PADDING + 2.5, BODY_PADDING + 2.5,
              SIZE - BODY_PADDING * 2 - 5, SIZE - BODY_PADDING * 2 - 5,
              BODY_RADIUS - 2.5).stroke({ width: 5, color: theme.pipLight, alpha: 0.48 });
          }
          for (const [percentX, percentY] of positions) {
            const x = SIZE * percentX / 100;
            const y = SIZE * percentY / 100;
            const light = tone === "light";
            const lip = pipGradient(x, y, themedPips ? light ? themedPips.lightLip : themedPips.darkLip : light
              ? [[0, "#63543a"], [0.45, "#a38d67"], [1, "#fff4d9"]]
              : [[0, "#020405"], [0.5, "#161c1d"], [1, "#767c76"]]);
            pips.circle(x, y, PIP_RADIUS + 1.8).fill(lip);
            const well = pipGradient(x, y, light
              ? themedPips?.lightWell ?? [[0, "#010303"], [0.55, "#111615"], [1, "#343a34"]]
              : darkPipWell);
            pips.circle(x, y, PIP_RADIUS).fill(well);
            // The upper-left wall is shaded; a restrained lower inner lip catches the light.
            pips.beginPath().arc(x, y, PIP_RADIUS - 0.8, Math.PI * 1.02, Math.PI * 1.78)
              .stroke({ width: 2.1, color: themedPips ? theme.pipDark : 0x010303, alpha: light ? 0.58 : 0.36 });
            pips.beginPath().arc(x, y, PIP_RADIUS - 0.8, Math.PI * 0.12, Math.PI * 0.88)
              .stroke({ width: 1.1, color: light
                ? themedPips ? mixColor(theme.pipDark, theme.pipLight, 0.3) : 0xa7b3a7
                : darkPipLight, alpha: light ? 0.2 : 0.48 });
          }
          app.renderer.render({ container: group });
          const extracted = app.renderer.extract.canvas({ target: group,
            frame: new Rectangle(0, 0, SIZE, SIZE), resolution: 1,
            clearColor: [0, 0, 0, 0], antialias: true }) as HTMLCanvasElement;
          images[tone][value] = extracted.toDataURL("image/png");
        } finally {
          body.filters = null;
          body.mask = null;
          group.removeChildren();
          shadow.destroy();
          body.destroy();
          bodyMask.destroy();
          pips.destroy();
          group.destroy();
          colorFilter?.destroy();
          gradients.forEach((gradient) => gradient.destroy());
        }
      }
    } finally {
      bodyTexture.destroy(false);
    }
  }

  return images;
}
