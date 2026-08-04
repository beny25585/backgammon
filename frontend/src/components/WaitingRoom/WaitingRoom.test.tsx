import { test, expect } from "@playwright/experimental-ct-react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import WaitingRoom from ".";

test("Leave cancels server room and clears stored room", async ({
  mount,
  page,
}) => {
  // Intercept cancel API call
  let cancelCalled = false;
  await page.route("**/api/rooms/cancel/", (route) => {
    cancelCalled = true;
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  // Seed localStorage with an active waiting room
  await page.evaluate(() =>
    localStorage.setItem(
      "bg_active_room",
      JSON.stringify({
        roomId: "ROOM123",
        roomCode: "ABC123",
        playerColor: "white",
        status: "waiting",
      }),
    ),
  );

  const component = await mount(
    <MemoryRouter initialEntries={["/waiting/ROOM123"]}>
      <Routes>
        <Route path="/waiting/:roomId" element={<WaitingRoom />} />
      </Routes>
    </MemoryRouter>,
  );

  await component.getByText("Leave").click();

  // allow the fetch to run
  await page.waitForTimeout(50);

  const stored = await page.evaluate(() =>
    localStorage.getItem("bg_active_room"),
  );
  expect(cancelCalled).toBe(true);
  expect(stored).toBeNull();
});
