import { test, expect } from "@playwright/experimental-ct-react";
import RollingDie from "./RollingDie";

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
];

for (const vp of VIEWPORTS) {
  test(`renders the requested number of cubes with six faces each (${vp.name})`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const rd = await mount(<RollingDie rolling={false} count={2} onRollComplete={() => {}} />);
    await expect(rd.getByTestId("rolling-die")).toHaveCount(2);
    await expect(rd.getByTestId("die-face")).toHaveCount(12);
  });

  test(`renders a single cube during the opening roll (${vp.name})`, async ({ mount, page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const rd = await mount(
      <RollingDie rolling={false} count={2} isOpening onRollComplete={() => {}} />,
    );
    await expect(rd.getByTestId("rolling-die")).toHaveCount(1);
    await expect(rd.getByTestId("die-face")).toHaveCount(6);
  });

  test(`applies the dark face styling when dark is set (${vp.name})`, async ({ mount, page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const rd = await mount(<RollingDie rolling={false} count={1} dark onRollComplete={() => {}} />);
    const faces = rd.getByTestId("die-face");
    await expect(faces.first()).toHaveClass(/faceDark/);
    await expect(faces.first()).not.toHaveClass(/faceLight/);
  });

  test(`fires onRollComplete when the roll animation finishes (${vp.name})`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    let done = 0;
    await mount(<RollingDie rolling={true} count={1} onRollComplete={() => done++} />);
    await expect.poll(() => done).toBeGreaterThanOrEqual(1);
  });

  test(`stays spinning without firing onRollComplete while idle (${vp.name})`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    let done = 0;
    await mount(<RollingDie rolling={false} count={1} onRollComplete={() => done++} />);
    await page.waitForTimeout(500);
    expect(done).toBe(0);
  });
}
