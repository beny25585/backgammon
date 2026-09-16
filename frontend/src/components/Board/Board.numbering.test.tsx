import { test, expect } from "@playwright/experimental-ct-react";
import type { Locator } from "@playwright/test";
import { Board } from "./Board";
import PointCell from "./pieces/pointcell/PointCell";
import { newGame, type GameState } from "@/lib/backgammon/engine";

function blankState(overrides: Partial<GameState> = {}): GameState {
  return {
    ...newGame(),
    points: new Array(24).fill(0),
    bar: { white: 0, black: 0 },
    home: { white: 0, black: 0 },
    phase: "moving",
    turn: "white",
    dice: [1],
    remaining: [1],
    lastMove: [],
    moveHistory: [],
    cube: 1,
    cubeOwner: "center",
    doubleOfferedBy: null,
    winner: null,
    winType: null,
    openingRoll: { white: null, black: null },
    message: "",
    ...overrides,
  };
}

async function getPointNumberMap(component: Locator) {
  return await component.evaluate((root: HTMLElement) => {
    const map: Record<number, number> = {};
    root.querySelectorAll("[data-point-idx]").forEach((el) => {
      const idxAttr = el.getAttribute("data-point-idx");
      const idx = Number(idxAttr);
      if (!Number.isInteger(idx) || idx < 0 || idx >= 24) return;
      const span = el.querySelector('[class*="pointNumber"]') as HTMLElement | null;
      const text = span?.textContent?.trim();
      if (text !== undefined) map[idx] = Number(text);
    });
    return map;
  });
}

test("A - white viewer: every point i displays i+1", async ({ mount }) => {
  const state = blankState({ turn: "white", phase: "moving" });
  const component = await mount(
    <Board
      state={state}
      myColor="white"
      selected={null}
      legalTargets={[]}
      onSelect={() => {}}
      onMove={() => {}}
      legalFromPoints={[]}
    />,
  );
  const map = await getPointNumberMap(component);
  // verify all 24
  expect(Object.keys(map).length).toBe(24);
  const labels = (Object.values(map) as number[]).sort((a, b) => a - b);
  expect(labels).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  for (let i = 0; i < 24; i++) {
    expect(map[i], `white label for index ${i}`).toBe(i + 1);
  }
  // reference cases
  expect(map[0]).toBe(1);
  expect(map[4]).toBe(5);
  expect(map[5]).toBe(6);
  expect(map[18]).toBe(19);
  expect(map[23]).toBe(24);
});

test("A - black viewer: every point i displays 24-i", async ({ mount }) => {
  const state = blankState({ turn: "black", phase: "moving" });
  const component = await mount(
    <Board
      state={state}
      myColor="black"
      selected={null}
      legalTargets={[]}
      onSelect={() => {}}
      onMove={() => {}}
      legalFromPoints={[]}
    />,
  );
  const map = await getPointNumberMap(component);
  expect(Object.keys(map).length).toBe(24);
  const labels = (Object.values(map) as number[]).sort((a, b) => a - b);
  expect(labels).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  for (let i = 0; i < 24; i++) {
    expect(map[i], `black label for index ${i}`).toBe(24 - i);
  }
  expect(map[0]).toBe(24);
  expect(map[4]).toBe(20);
  expect(map[5]).toBe(19);
  expect(map[18]).toBe(6);
  expect(map[23]).toBe(1);
});

test("B - white viewer perspective is stable across turn changes", async ({ mount }) => {
  const whiteState = blankState({ turn: "white", phase: "moving" });
  const component = await mount(
    <Board
      state={whiteState}
      myColor="white"
      selected={null}
      legalTargets={[]}
      onSelect={() => {}}
      onMove={() => {}}
      legalFromPoints={[]}
    />,
  );
  const mapBefore = await getPointNumberMap(component);
  const whiteStateTurnBlack = { ...whiteState, turn: "black" as const };
  await component.update(
    <Board
      state={whiteStateTurnBlack}
      myColor="white"
      selected={null}
      legalTargets={[]}
      onSelect={() => {}}
      onMove={() => {}}
      legalFromPoints={[]}
    />,
  );
  const mapAfter = await getPointNumberMap(component);
  expect(mapAfter).toEqual(mapBefore);
});

test("B - black viewer perspective is stable across turn changes", async ({ mount }) => {
  const blackState = blankState({ turn: "white", phase: "moving" });
  const component = await mount(
    <Board
      state={blackState}
      myColor="black"
      selected={null}
      legalTargets={[]}
      onSelect={() => {}}
      onMove={() => {}}
      legalFromPoints={[]}
    />,
  );
  const mapBefore = await getPointNumberMap(component);
  const blackStateTurnWhite = { ...blackState, turn: "white" as const };
  await component.update(
    <Board
      state={blackStateTurnWhite}
      myColor="black"
      selected={null}
      legalTargets={[]}
      onSelect={() => {}}
      onMove={() => {}}
      legalFromPoints={[]}
    />,
  );
  const mapAfter = await getPointNumberMap(component);
  expect(mapAfter).toEqual(mapBefore);
});

test("B - complementary labels: whiteLabel + blackLabel === 25", async ({ mount }) => {
  const state = blankState({ phase: "moving", turn: "white" });
  const component = await mount(
    <Board state={state} myColor="white" selected={null} legalTargets={[]} onSelect={() => {}} onMove={() => {}} legalFromPoints={[]} />,
  );
  const whiteMap = await getPointNumberMap(component);
  const whitePlain: Record<number, number> = { ...whiteMap };
  await component.update(
    <Board state={state} myColor="black" selected={null} legalTargets={[]} onSelect={() => {}} onMove={() => {}} legalFromPoints={[]} />,
  );
  const blackMap = await getPointNumberMap(component);
  for (let i = 0; i < 24; i++) {
    expect(whitePlain[i] + blackMap[i], `index ${i}`).toBe(25);
  }
});

test("C - null perspective fallback uses white numbering", async ({ mount }) => {
  const state = blankState({ phase: "moving", turn: "white" });
  const component = await mount(
    <Board
      state={state}
      myColor={null}
      selected={null}
      legalTargets={[]}
      onSelect={() => {}}
      onMove={() => {}}
      legalFromPoints={[]}
    />,
  );
  const map = await getPointNumberMap(component);
  for (let i = 0; i < 24; i++) {
    expect(map[i]).toBe(i + 1);
  }
});

test("D - PointCell explicit pointNumber and fallback", async ({ mount }) => {
  const onClick = () => {};
  const component = await mount(
    <PointCell index={5} pointNumber={19} pointValue={0} selected={false} isLegalTarget={false} isLegalFrom={false} onClick={onClick} />,
  );
  await expect(component.locator('[class*="pointNumber"]')).toHaveText("19");
  await component.update(
    <PointCell index={5} pointValue={0} selected={false} isLegalTarget={false} isLegalFrom={false} onClick={onClick} />,
  );
  await expect(component.locator('[class*="pointNumber"]')).toHaveText("6");
});

test("D - PointCell empty point shows number", async ({ mount }) => {
  const onClick = () => {};
  const component = await mount(
    <PointCell index={0} pointNumber={1} pointValue={0} selected={false} isLegalTarget={false} isLegalFrom={false} onClick={onClick} />,
  );
  await expect(component.locator('[class*="pointNumber"]')).toBeVisible();
  await expect(component.locator('[class*="pointNumber"]')).toHaveText("1");
});

test("D - PointCell occupied point shows number and checkers", async ({ mount }) => {
  const onClick = () => {};
  const component = await mount(
    <PointCell index={0} pointNumber={1} pointValue={5} selected={false} isLegalTarget={false} isLegalFrom={false} onClick={onClick} />,
  );
  await expect(component.locator('[class*="pointNumber"]')).toHaveText("1");
  await expect(component.locator('[data-checker]')).toHaveCount(5);
});

test("E - Board preserves absolute index and label for black viewer", async ({ mount }) => {
  const state = blankState({ phase: "moving", turn: "white" });
  const component = await mount(
    <Board
      state={state}
      myColor="black"
      selected={null}
      legalTargets={[]}
      onSelect={() => {}}
      onMove={() => {}}
      legalFromPoints={[5]}
      onUndo={() => {}}
    />,
  );
  const btn = component.locator('[data-point-idx="5"]');
  await expect(btn).toHaveAttribute("data-point-idx", "5");
  await expect(btn.locator('[class*="pointNumber"]')).toHaveText("19");
});

test("E - PointCell direct click returns absolute index", async ({ mount }) => {
  let directClicked: number | null = null;
  const component = await mount(
    <PointCell index={5} pointNumber={19} pointValue={1} selected={false} isLegalTarget={false} isLegalFrom={false} onClick={(idx) => (directClicked = idx)} />,
  );
  await component.click();
  expect(directClicked).toBe(5);
});

test("E - Board click handler returns absolute index", async ({ mount }) => {
  let boardClicked: number | null = null;
  const state2 = blankState({ phase: "moving", turn: "black" });
  const component = await mount(
    <Board
      state={state2}
      myColor="black"
      selected={null}
      legalTargets={[]}
      onSelect={(from) => { if (from !== null) boardClicked = from as number; }}
      onMove={() => {}}
      legalFromPoints={[5]}
    />,
  );
  await component.locator('[data-point-idx="5"]').click();
  expect(boardClicked).toBe(5);
});

test("F - checker-stack remains last element child and span is before it", async ({ mount }) => {
  const state = blankState({ phase: "moving" });
  const component = await mount(
    <Board
      state={state}
      myColor="white"
      selected={null}
      legalTargets={[]}
      onSelect={() => {}}
      onMove={() => {}}
      legalFromPoints={[]}
    />,
  );
  const structureOk = await component.evaluate((root: HTMLElement) => {
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-point-idx]")).filter((el) => {
      const v = Number(el.getAttribute("data-point-idx"));
      return Number.isInteger(v) && v >= 0 && v < 24;
    });
    if (buttons.length !== 24) return `expected 24 points got ${buttons.length}`;
    for (const btn of buttons) {
      const last = btn.lastElementChild as HTMLElement | null;
      if (!last) return "missing last child";
      const isStack = last.className.includes("checkersTop") || last.className.includes("checkersBottom");
      if (!isStack) return `last child not stack for idx ${btn.getAttribute("data-point-idx")}: ${last.className}`;
      // pointNumber must be inside button but not inside stack
      const pointNumber = btn.querySelector('[class*="pointNumber"]') as HTMLElement | null;
      if (!pointNumber) return `missing pointNumber for ${btn.getAttribute("data-point-idx")}`;
      if (last.contains(pointNumber)) return `pointNumber inside stack for ${btn.getAttribute("data-point-idx")}`;
      // must be before stack
      if (pointNumber.compareDocumentPosition(last) !== Node.DOCUMENT_POSITION_FOLLOWING) {
        return `pointNumber not before stack for ${btn.getAttribute("data-point-idx")}`;
      }
      // must not be inside background triangle
      const bg = btn.querySelector('[class*="background"]');
      if (bg && bg.contains(pointNumber)) return `pointNumber inside background for ${btn.getAttribute("data-point-idx")}`;
    }
    return "ok";
  });
  expect(structureOk).toBe("ok");

  // Also test top vs bottom class
  const topHasTopClass = await component.evaluate((root: HTMLElement) => {
    const topBtn = root.querySelector('[data-point-idx="12"]') as HTMLElement | null; // for white, 12 is top row
    if (!topBtn) return false;
    const isTop = topBtn.querySelector('[class*="pointNumberTop"]') !== null;
    return isTop;
  });
  // For white viewer, point 12 is top, should have pointNumberTop
  expect(topHasTopClass).toBe(true);
});
