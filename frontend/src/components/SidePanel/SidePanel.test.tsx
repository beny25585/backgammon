import { test, expect } from "@playwright/experimental-ct-react";
import SidePanel from "./SidePanel";
import { MockGameWrapper, makeGameState } from "../../test-utils/wrappers";

test("shows usernames for both players when provided", async ({ mount }) => {
  const component = await mount(
    <MockGameWrapper playerColor="white" context={{ whiteName: "alice", blackName: "bob" }}>
      <SidePanel state={makeGameState({ turn: "white" })} playerColor="white" onLeave={() => {}} />
    </MockGameWrapper>,
  );

  await expect(component.getByText("alice")).toBeVisible();
  await expect(component.getByText("bob")).toBeVisible();
  await expect(component.getByText("alice", { exact: true })).toBeVisible();
});

test("falls back to generic labels when names are null", async ({ mount }) => {
  const component = await mount(
    <MockGameWrapper playerColor="white">
      <SidePanel state={makeGameState({ turn: "black" })} playerColor="white" onLeave={() => {}} />
    </MockGameWrapper>,
  );

  await expect(component.getByText("You (White)")).toBeVisible();
  await expect(component.getByText("Black Player")).toBeVisible();
});
