import { test, expect } from "@playwright/experimental-ct-react";
import { barStackMetrics, barStackOffset, pointStackMetrics, pointStackOffset } from "./checkerStackGeometry";

test("dense stacks fit four full checkers and overlap the fifth inside the point", () => {
  const layout = pointStackMetrics(60, 150, 3, 3, 2);
  expect(layout.diameter).toBe(32);
  const fullSlots = Array.from({ length: 4 }, (_, index) => pointStackOffset(layout, 4, index, true));
  for (let index = 1; index < fullSlots.length; index++) {
    expect(fullSlots[index] - fullSlots[index - 1]).toBeGreaterThanOrEqual(layout.diameter + layout.gap);
  }
  expect(fullSlots[0]).toBeGreaterThanOrEqual(3);
  expect(fullSlots[3] + layout.diameter).toBeLessThanOrEqual(150 - 3 - 8);
  const slots = Array.from({ length: 5 }, (_, index) => pointStackOffset(layout, 5, index, true));
  expect(slots[1] - slots[0]).toBeLessThan(layout.diameter);
  expect(slots[0]).toBeGreaterThanOrEqual(3);
  expect(slots[4] + layout.diameter).toBeLessThanOrEqual(150 - 3 - 8);
});

test("sparse stacks keep their normal separation when full circles fit", () => {
  const layout = pointStackMetrics(40, 200, 8, 8, 2);
  expect(layout.diameter).toBe(38);
  const first = pointStackOffset(layout, 2, 0, true);
  const second = pointStackOffset(layout, 2, 1, true);
  expect(second - first - layout.diameter).toBe(2);
});

test("top and bottom stacks mirror each other with center clearance", () => {
  const layout = pointStackMetrics(72, 170, 3, 3, 2);
  for (let index = 0; index < 5; index++) {
    const top = pointStackOffset(layout, 5, index, true);
    const bottom = pointStackOffset(layout, 5, index, false);
    expect(top + bottom + layout.diameter).toBeCloseTo(layout.height, 8);
  }
  expect(pointStackOffset(layout, 5, 4, false)).toBeGreaterThanOrEqual(layout.paddingTop + 8);
});

test("large counts use five visible slots without overflowing the point", () => {
  const layout = pointStackMetrics(80, 190, 8, 8, 2);
  for (let index = 0; index < 5; index++) {
    expect(pointStackOffset(layout, 15, index, true)).toBe(pointStackOffset(layout, 5, index, true));
  }
  expect(pointStackOffset(layout, 15, 14, true)).toBe(pointStackOffset(layout, 5, 4, true));
});

test("extremely short points cap the diameter so four circles fit", () => {
  const layout = pointStackMetrics(100, 40, 3, 3, 2);
  expect(layout.diameter).toBe(5);
  for (let index = 0; index < 5; index++) {
    expect(pointStackOffset(layout, 5, index, true) + layout.diameter).toBeLessThanOrEqual(40 - 3 - 8);
  }
});

test("bar pieces use local width and cap larger counts to three fitting slots", () => {
  const point = pointStackMetrics(80, 190, 3, 3, 2);
  const bar = barStackMetrics(42, 56);
  expect(bar.diameter).toBeLessThan(point.diameter);
  expect(bar.diameter).toBeLessThanOrEqual(42);
  expect(barStackOffset(bar, 1, 0) + bar.diameter / 2).toBe(28);
  for (let index = 0; index < 3; index++) {
    const slot = barStackOffset(bar, 15, index);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(slot + bar.diameter).toBeLessThanOrEqual(56);
    expect(slot).toBe(barStackOffset(bar, 3, index));
  }
});
