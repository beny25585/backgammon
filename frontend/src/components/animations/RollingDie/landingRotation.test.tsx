import { test, expect } from "@playwright/experimental-ct-react";
import {
  DIE_FACES,
  CUBE_FACES,
  FACE_SIDES,
  landingRotation,
} from "./landingRotation";

test("brings every die face to the front", () => {
  // Front face (value 1) needs no rotation.
  expect(landingRotation(1, DIE_FACES)).toEqual({ rotateX: 0, rotateY: 0 });
  // Back face (value 6) needs a half turn about Y.
  expect(landingRotation(6, DIE_FACES)).toEqual({ rotateX: 0, rotateY: 180 });
  // Left (3) and right (4) faces turn about Y.
  expect(landingRotation(3, DIE_FACES)).toEqual({ rotateX: 0, rotateY: 90 });
  expect(landingRotation(4, DIE_FACES)).toEqual({ rotateX: 0, rotateY: -90 });
  // Top (2) and bottom (5) faces turn about X.
  expect(landingRotation(2, DIE_FACES)).toEqual({ rotateX: 90, rotateY: 0 });
  expect(landingRotation(5, DIE_FACES)).toEqual({ rotateX: -90, rotateY: 0 });
});

test("brings every doubling-cube face to the front", () => {
  expect(landingRotation(2, CUBE_FACES)).toEqual({ rotateX: 0, rotateY: 0 });
  expect(landingRotation(4, CUBE_FACES)).toEqual({ rotateX: 0, rotateY: 180 });
  expect(landingRotation(8, CUBE_FACES)).toEqual({ rotateX: 0, rotateY: 90 });
  expect(landingRotation(16, CUBE_FACES)).toEqual({ rotateX: 0, rotateY: -90 });
  expect(landingRotation(32, CUBE_FACES)).toEqual({ rotateX: 90, rotateY: 0 });
  expect(landingRotation(64, CUBE_FACES)).toEqual({ rotateX: -90, rotateY: 0 });
});

test("returns identity rotation for unknown values", () => {
  expect(landingRotation(7, DIE_FACES)).toEqual({ rotateX: 0, rotateY: 0 });
  expect(landingRotation(3, CUBE_FACES)).toEqual({ rotateX: 0, rotateY: 0 });
});

test("exposes one side transform per face", () => {
  expect(FACE_SIDES).toHaveLength(6);
});
