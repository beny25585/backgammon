import { test, expect } from "@playwright/experimental-ct-react";
import DoublingCube from "./DoublingCube";

test("shows the cube value with the owner label", async ({ mount }) => {
  const cube = await mount(<DoublingCube value={4} owner="white" />);
  await expect(cube.getByTestId("doubling-cube")).toHaveText("4");
  await expect(cube.getByText("You")).toBeVisible();
});

test("shows Center for a cube in the center", async ({ mount }) => {
  const cube = await mount(<DoublingCube value={1} owner="center" />);
  await expect(cube.getByTestId("doubling-cube")).toHaveText("1");
  await expect(cube.getByText("Center")).toBeVisible();
});

test("applies a per-value number color", async ({ mount }) => {
  const cube = await mount(<DoublingCube value={2} owner="white" />);
  const face = cube.getByTestId("doubling-cube");
  const color = await face.evaluate((el) => getComputedStyle(el).color);
  expect(color).toBe("rgb(231, 76, 60)"); // #e74c3c red
});

test("rotates to the new value when it changes", async ({ mount }) => {
  const cube = await mount(<DoublingCube value={2} owner="white" />);
  await expect(cube.getByTestId("doubling-cube")).toHaveText("2");
  await cube.update(<DoublingCube value={16} owner="white" />);
  await expect(cube.getByTestId("doubling-cube")).toHaveText("16");
});
