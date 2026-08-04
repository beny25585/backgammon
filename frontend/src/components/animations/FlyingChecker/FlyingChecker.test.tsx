import { test, expect } from "@playwright/experimental-ct-react";
import FlyingChecker from "./FlyingChecker";

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
];

const FROM = { x: 20, y: 20 };
const TO = { x: 220, y: 180 };
const SIZE = 30;

for (const vp of VIEWPORTS) {
  test(`renders the checker with the requested color and size (${vp.name})`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const fc = await mount(
      <div>
        <FlyingChecker from={FROM} to={TO} color="black" size={36} onComplete={() => {}} />
      </div>,
    );
    const checker = fc.getByTestId("flying-checker");
    await expect(checker).toHaveClass(/black/);
    await expect(checker).not.toHaveClass(/white/);
    const size = await checker.evaluate((el) => {
      const style = getComputedStyle(el);
      return { width: style.width, height: style.height };
    });
    expect(size.width).toBe("36px");
    expect(size.height).toBe("36px");
  });

  test(`travels from the source point to the target point (${vp.name})`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    let completed = 0;
    const fc = await mount(
      <div>
        <div data-testid="arena" style={{ position: "relative", width: 300, height: 300 }}>
          <FlyingChecker
            from={FROM}
            to={TO}
            color="white"
            size={SIZE}
            onComplete={() => completed++}
          />
        </div>
      </div>,
    );
    const checker = fc.getByTestId("flying-checker");
    const arena = fc.getByTestId("arena");

    const arenaBox = (await arena.boundingBox())!;
    const start = await checker.boundingBox();
    const startRel = { x: start!.x - arenaBox.x, y: start!.y - arenaBox.y };
    const distFrom = Math.hypot(startRel.x - FROM.x, startRel.y - FROM.y);
    const distTo = Math.hypot(startRel.x - TO.x, startRel.y - TO.y);
    expect(distFrom, "checker should begin near the source point").toBeLessThan(distTo);

    await expect.poll(() => completed).toBeGreaterThanOrEqual(1);

    const end = await checker.boundingBox();
    const endCenter = {
      x: end!.x - arenaBox.x + end!.width / 2,
      y: end!.y - arenaBox.y + end!.height / 2,
    };
    expect(endCenter.x, "checker should land centered on the target x").toBeCloseTo(
      TO.x + SIZE / 2,
      0,
    );
    expect(endCenter.y, "checker should land centered on the target y").toBeCloseTo(
      TO.y + SIZE / 2,
      0,
    );
  });
}
