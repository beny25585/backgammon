import { expect, test } from "@playwright/experimental-ct-react";
import type { Page } from "@playwright/test";
import { GameBuildUpdateHarness } from "./useGameBuildUpdate.story";

const currentVersion = "90d8b152-b9b0-4673-80ba-a0c752328b0b";
const nextVersion = "418a4706-18b4-4fca-974f-f585a8cd198f";
const isVersionMarker = (url: URL) => url.pathname.endsWith("/version.json");

function holdMarker() {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  return { pending, release };
}

function waitForMarker(page: Page) {
  return page.waitForResponse((response) => isVersionMarker(new URL(response.url())));
}

async function returnToPage(page: Page) {
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));
    window.dispatchEvent(new Event("online"));
  });
}

test("a safe history page applies a new build once across overlapping checks and a remount", async ({ mount, page }) => {
  const marker = holdMarker();
  let requests = 0;
  await page.route(isVersionMarker, async (route) => {
    requests++;
    await marker.pending;
    await route.fulfill({ json: { version: nextVersion } });
  });

  const component = await mount(<GameBuildUpdateHarness pathname="/history" currentVersion={currentVersion} />);
  await expect.poll(() => requests).toBe(1);
  await returnToPage(page);
  marker.release();
  await expect(component.getByTestId("build-reloads")).toHaveText("1");
  expect(requests).toBe(1);
  await component.unmount();

  const received = waitForMarker(page);
  const remounted = await mount(<GameBuildUpdateHarness pathname="/history/42" currentVersion={currentVersion} />);
  await (await received).finished();
  await expect(remounted.getByTestId("build-reloads")).toHaveText("0");
  expect(requests).toBe(2);
});

test("game, waiting, ticket and spectator routes defer checks until the player reaches history", async ({ mount, page }) => {
  let requests = 0;
  await page.route(isVersionMarker, async (route) => {
    requests++;
    await route.fulfill({ json: { version: nextVersion } });
  });

  const component = await mount(<GameBuildUpdateHarness pathname="/game/room-a" currentVersion={currentVersion} />);
  await returnToPage(page);
  for (const pathname of ["/local", "/waiting/room-a", "/link", "/watch/room-a"]) {
    await component.update(<GameBuildUpdateHarness pathname={pathname} currentVersion={currentVersion} />);
    await returnToPage(page);
  }
  expect(requests).toBe(0);
  await expect(component.getByTestId("build-reloads")).toHaveText("0");

  await component.update(<GameBuildUpdateHarness pathname="/history/42" currentVersion={currentVersion} />);
  await expect(component.getByTestId("build-reloads")).toHaveText("1");
  expect(requests).toBe(1);
});

test("a delayed marker cannot reload after the browser has entered a game", async ({ mount, page }) => {
  const marker = holdMarker();
  let requests = 0;
  await page.route(isVersionMarker, async (route) => {
    requests++;
    await marker.pending;
    await route.fulfill({ json: { version: nextVersion } });
  });

  const component = await mount(<GameBuildUpdateHarness pathname="/history" currentVersion={currentVersion} />);
  await expect.poll(() => requests).toBe(1);
  // Model the URL changing before the router's next commit.
  await component.update(
    <GameBuildUpdateHarness pathname="/history" browserPathname="/game/room-a" currentVersion={currentVersion} />,
  );
  const received = waitForMarker(page);
  marker.release();
  await (await received).finished();
  await expect(component.getByTestId("build-reloads")).toHaveText("0");
  await returnToPage(page);
  expect(requests).toBe(1);

  await component.update(<GameBuildUpdateHarness pathname="/history/42" currentVersion={currentVersion} />);
  await expect(component.getByTestId("build-reloads")).toHaveText("1");
  expect(requests).toBe(2);
});

test("an open history page detects a release without a focus or navigation event", async ({ mount, page }) => {
  await page.clock.install();
  let version = currentVersion;
  await page.route(isVersionMarker, (route) => route.fulfill({ json: { version } }));

  const received = waitForMarker(page);
  const component = await mount(<GameBuildUpdateHarness pathname="/history" currentVersion={currentVersion} />);
  await (await received).finished();
  await expect(component.getByTestId("build-reloads")).toHaveText("0");

  version = nextVersion;
  await page.clock.fastForward(60_000);
  await expect(component.getByTestId("build-reloads")).toHaveText("1");
});

test("offline, HTML fallback, invalid and unchanged markers leave the page in place", async ({ mount, page }) => {
  let requests = 0;
  const validMarker = holdMarker();
  await page.route(isVersionMarker, async (route) => {
    requests++;
    switch (requests) {
      case 1:
        return route.abort("internetdisconnected");
      case 2:
        return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Maintenance</title>" });
      case 3:
        return route.fulfill({ json: { version: "<script>invalid</script>" } });
      case 4:
        return route.fulfill({ json: { version: currentVersion } });
      default:
        await validMarker.pending;
        return route.fulfill({ json: { version: nextVersion } });
    }
  });

  const component = await mount(<GameBuildUpdateHarness pathname="/history" currentVersion={currentVersion} />);
  await expect.poll(() => requests).toBe(1);
  for (const nextRequest of [2, 3, 4, 5]) {
    await expect.poll(async () => {
      if (requests < nextRequest) await returnToPage(page);
      return requests;
    }).toBe(nextRequest);
    await expect(component.getByTestId("build-reloads")).toHaveText("0");
  }

  validMarker.release();
  await expect(component.getByTestId("build-reloads")).toHaveText("1");
});
