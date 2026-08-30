import { test, expect } from "@playwright/experimental-ct-react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { LocationProbe } from "../../test-utils/probes";
import LinkEntry from ".";

const ACCESS = "header.access-payload.signature";
const REFRESH = "header.refresh-payload.signature";
const ROOM = "0f2a1b3c-4d5e-6f70-8192-a3b4c5d6e7f8";

function fragment(parts: Record<string, string>) {
  return `#${new URLSearchParams(parts).toString()}`;
}

const VALID = fragment({
  access: ACCESS,
  refresh: REFRESH,
  room: ROOM,
  color: "black",
});

/** Put a fragment in the address bar and clear anything a previous test left behind. */
async function arriveWith(page: import("@playwright/test").Page, hash: string) {
  await page.evaluate((value) => {
    localStorage.clear();
    window.location.hash = value;
  }, hash);
}

// Assertions go through `page`, never through the handle `mount()` returns: that handle is scoped
// to the element mounted at the time, and every one of these tests navigates away from it.

test("a valid link stores the session and lands on the game", async ({
  mount,
  page,
}) => {
  await arriveWith(page, VALID);
  await mount(
    <MemoryRouter initialEntries={["/link"]}>
      <Routes>
        <Route path="/link" element={<LinkEntry />} />
        <Route path="/game/:roomId" element={<LocationProbe />} />
        <Route path="/" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );

  await expect(page.getByTestId("location")).toHaveText(
    `/game/${ROOM}?color=black`,
  );

  const stored = await page.evaluate(() => ({
    access: localStorage.getItem("bg_access_token"),
    refresh: localStorage.getItem("bg_refresh_token"),
  }));
  expect(stored).toEqual({ access: ACCESS, refresh: REFRESH });
});

test("the colour from the fragment decides the seat", async ({
  mount,
  page,
}) => {
  await arriveWith(
    page,
    fragment({ access: ACCESS, refresh: REFRESH, room: ROOM, color: "white" }),
  );
  await mount(
    <MemoryRouter initialEntries={["/link"]}>
      <Routes>
        <Route path="/link" element={<LinkEntry />} />
        <Route path="/game/:roomId" element={<LocationProbe />} />
        <Route path="/" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );

  await expect(page.getByTestId("location")).toHaveText(
    `/game/${ROOM}?color=white`,
  );
});

test("the fragment is taken out of the address bar", async ({
  mount,
  page,
}) => {
  await arriveWith(page, VALID);
  await mount(
    <MemoryRouter initialEntries={["/link"]}>
      <Routes>
        <Route path="/link" element={<LinkEntry />} />
        <Route path="/game/:roomId" element={<LocationProbe />} />
        <Route path="/" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
  await expect(page.getByTestId("location")).toBeVisible();

  const location = await page.evaluate(() => ({
    hash: window.location.hash,
    href: window.location.href,
  }));
  expect(location.hash).toBe("");
  expect(location.href).not.toContain(ACCESS);
  expect(location.href).not.toContain(REFRESH);
});

test("neither token is ever rendered", async ({ mount, page }) => {
  await arriveWith(page, VALID);
  await mount(
    <MemoryRouter initialEntries={["/link"]}>
      <Routes>
        <Route path="/link" element={<LinkEntry />} />
        <Route path="/game/:roomId" element={<LocationProbe />} />
        <Route path="/" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
  await expect(page.getByTestId("location")).toBeVisible();

  const html = await page.content();
  expect(html).not.toContain(ACCESS);
  expect(html).not.toContain(REFRESH);
});

test("a missing fragment is sent home with an explanation", async ({
  mount,
  page,
}) => {
  await arriveWith(page, "");
  await mount(
    <MemoryRouter initialEntries={["/link"]}>
      <Routes>
        <Route path="/link" element={<LinkEntry />} />
        <Route path="/game/:roomId" element={<LocationProbe />} />
        <Route path="/" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );

  await expect(page.getByTestId("location")).toHaveText("/?link=invalid");

  const stored = await page.evaluate(() =>
    localStorage.getItem("bg_access_token"),
  );
  expect(stored).toBeNull();
});

test("a fragment missing the refresh token is refused", async ({
  mount,
  page,
}) => {
  await arriveWith(
    page,
    fragment({ access: ACCESS, room: ROOM, color: "white" }),
  );
  await mount(
    <MemoryRouter initialEntries={["/link"]}>
      <Routes>
        <Route path="/link" element={<LinkEntry />} />
        <Route path="/game/:roomId" element={<LocationProbe />} />
        <Route path="/" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );

  await expect(page.getByTestId("location")).toHaveText("/?link=invalid");
  const stored = await page.evaluate(() =>
    localStorage.getItem("bg_access_token"),
  );
  expect(stored).toBeNull();
});

test("an unknown colour is refused rather than guessed", async ({
  mount,
  page,
}) => {
  await arriveWith(
    page,
    fragment({ access: ACCESS, refresh: REFRESH, room: ROOM, color: "green" }),
  );
  await mount(
    <MemoryRouter initialEntries={["/link"]}>
      <Routes>
        <Route path="/link" element={<LinkEntry />} />
        <Route path="/game/:roomId" element={<LocationProbe />} />
        <Route path="/" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );

  await expect(page.getByTestId("location")).toHaveText("/?link=invalid");
});

test("a refused link still leaves nothing in the address bar", async ({
  mount,
  page,
}) => {
  // The failure paths matter most here: a link that is rejected must not leave the session it
  // carried sitting in the address bar and the browser history.
  await arriveWith(
    page,
    fragment({ access: ACCESS, room: ROOM, color: "nonsense" }),
  );
  await mount(
    <MemoryRouter initialEntries={["/link"]}>
      <Routes>
        <Route path="/link" element={<LinkEntry />} />
        <Route path="/game/:roomId" element={<LocationProbe />} />
        <Route path="/" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
  await expect(page.getByTestId("location")).toHaveText("/?link=invalid");

  const location = await page.evaluate(() => window.location.href);
  expect(location).not.toContain(ACCESS);
  expect(location).not.toContain("nonsense");
});
