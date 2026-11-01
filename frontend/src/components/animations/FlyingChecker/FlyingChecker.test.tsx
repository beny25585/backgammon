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

test("bar-to-point flights finish at the destination diameter and keep the checker round", async ({ mount }) => {
  let completed = false;
  const component = await mount(
    <FlyingChecker from={FROM} to={TO} color="white" size={24} toSize={56} onComplete={() => { completed = true; }} />,
  );
  await expect.poll(() => completed).toBe(true);
  const flyer = component;
  await expect(flyer).toHaveCSS("width", "56px");
  await expect(flyer).toHaveCSS("height", "56px");
  await expect(flyer.locator("[data-checker]")).toHaveCSS("width", "56px");
  await expect(flyer.locator("[data-checker]")).toHaveCSS("height", "56px");
});

test("committed point-to-bar flights use the smaller destination diameter", async ({ mount }) => {
  const component = await mount(
    <FlyingChecker from={FROM} to={TO} color="black" size={56} toSize={24} committed onComplete={() => {}} />,
  );
  const flyer = component;
  await expect(flyer).toHaveCSS("left", `${TO.x}px`);
  await expect(flyer).toHaveCSS("top", `${TO.y}px`);
  await expect(flyer.locator("[data-checker]")).toHaveCSS("width", "24px");
  await expect(flyer.locator("[data-checker]")).toHaveCSS("height", "24px");
});

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
    const flyer = fc.getByTestId("flying-checker");
    const checker = flyer.locator("[data-checker]");
    await expect(checker).toHaveAttribute("data-checker-color", "black");
    const size = await flyer.evaluate((el) => {
      const style = getComputedStyle(el);
      return { width: style.width, height: style.height };
    });
    expect(size.width).toBe("36px");
    expect(size.height).toBe("36px");
    await expect(checker).toHaveCSS("width", "36px");
    await expect(checker).toHaveCSS("height", "36px");
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
