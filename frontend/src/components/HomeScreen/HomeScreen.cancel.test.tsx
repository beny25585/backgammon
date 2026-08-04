import { test, expect } from "@playwright/experimental-ct-react";
import { MemoryRouter } from "react-router-dom";
import HomeScreen from ".";

test("Cancel button calls cancelRoom and clears stored active room", async ({
  mount,
  page,
}) => {
  let cancelCalled = false;
  await page.route("**/api/rooms/cancel/", (route) => {
    cancelCalled = true;
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

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
    <MemoryRouter>
      <HomeScreen />
    </MemoryRouter>,
  );

  // Click the Cancel button in the active room section
  await component.getByRole("button", { name: /Cancel/i }).click();

  await page.waitForTimeout(50);
  const stored = await page.evaluate(() =>
    localStorage.getItem("bg_active_room"),
  );
  expect(cancelCalled).toBe(true);
  expect(stored).toBeNull();
});
