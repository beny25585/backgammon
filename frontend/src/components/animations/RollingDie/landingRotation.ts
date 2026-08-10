/**
 * HOW TO CHANGE THE ROLLING/LANDING ANIMATION
 * --------------------------------------------
 * - Face order: edit FACE_SIDES to change which face sits where on the cube.
 *   Index order is front, back, left, right, top, bottom.
 * - Landing: FACE_TO_FRONT maps each face index to the cube rotation (in degrees)
 *   that brings that face to the front. landingRotation(value, layout) finds the
 *   face showing `value` and returns its landing rotation. Change a face's side
 *   transform and update FACE_TO_FRONT to match.
 */

export interface Rotation {
  rotateX: number;
  rotateY: number;
}

/** Six faces of a die: value, then its side transform. */
export const DIE_FACES = [1, 6, 3, 4, 2, 5];

/** Six faces of the doubling cube: 2, 4, 8, 16, 32, 64. */
export const CUBE_FACES = [2, 4, 8, 16, 32, 64];

export const FACE_SIDES = [
  "translateZ(calc(clamp(32px,7vw,44px)))",
  "rotateY(180deg) translateZ(calc(clamp(32px,7vw,44px)))",
  "rotateY(-90deg) translateZ(calc(clamp(32px,7vw,44px)))",
  "rotateY(90deg) translateZ(calc(clamp(32px,7vw,44px)))",
  "rotateX(-90deg) translateZ(calc(clamp(32px,7vw,44px)))",
  "rotateX(90deg) translateZ(calc(clamp(32px,7vw,44px)))",
];

const FACE_TO_FRONT: Rotation[] = [
  { rotateX: 0, rotateY: 0 }, // front
  { rotateX: 0, rotateY: 180 }, // back
  { rotateX: 0, rotateY: 90 }, // left
  { rotateX: 0, rotateY: -90 }, // right
  { rotateX: 90, rotateY: 0 }, // top
  { rotateX: -90, rotateY: 0 }, // bottom
];

export function landingRotation(value: number, layout: number[]): Rotation {
  const idx = layout.indexOf(value);
  if (idx < 0) return { rotateX: 0, rotateY: 0 };
  return FACE_TO_FRONT[idx];
}
