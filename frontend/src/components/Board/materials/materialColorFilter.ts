import { Color, ColorMatrixFilter } from "pixi.js";
import type { MaterialColorRamp } from "./boardMaterialThemes";

/** Recolor material luminance while retaining its relief, texture and original alpha. */
export function createMaterialColorFilter(ramp: MaterialColorRamp): ColorMatrixFilter {
  const dark = new Color(ramp.dark).toRgbArray();
  const light = new Color(ramp.light).toRgbArray();
  const gain = ramp.gain ?? 1;
  const red = (light[0] - dark[0]) * gain;
  const green = (light[1] - dark[1]) * gain;
  const blue = (light[2] - dark[2]) * gain;
  const filter = new ColorMatrixFilter({ padding: 0, resolution: 1 });
  filter.matrix = [
    red * 0.2126, red * 0.7152, red * 0.0722, 0, dark[0],
    green * 0.2126, green * 0.7152, green * 0.0722, 0, dark[1],
    blue * 0.2126, blue * 0.7152, blue * 0.0722, 0, dark[2],
    0, 0, 0, 1, 0,
  ];
  return filter;
}
