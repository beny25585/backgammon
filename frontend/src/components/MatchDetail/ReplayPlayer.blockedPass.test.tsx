import { test, expect } from "@playwright/experimental-ct-react";
import ReplayPlayer from "./ReplayPlayer";
import { MockGameWrapper } from "../../test-utils/wrappers";

for (const color of ["white", "black"] as const) {
  test(`${color}: legacy replay describes an unrolled pass without showing dice`, async ({ mount }) => {
    const component = await mount(
      <MockGameWrapper>
        <ReplayPlayer transcript={[{ kind: "blocked_pass", turn: color, roll: [], moves: [] }]} />
      </MockGameWrapper>,
    );
    await component.getByRole("button", { name: "Forward", exact: true }).click();
    await expect(component.getByText(`Turn 1: ${color === "white" ? "White" : "Black"} passed with all bar entries closed, without rolling`)).toBeVisible();
    await expect(component.getByTestId("die")).toHaveCount(0);
  });
}
