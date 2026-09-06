import { test, expect } from "@playwright/experimental-ct-react";
import GameScreen from "./GameScreen";
import { MockGameWrapper } from "../../test-utils/wrappers";
import { allLegalMoves, applyMove, applyRoll, newGame, type GameState } from "../../lib/backgammon/engine";

type FrameAudit = { gaps: number[]; longTasks: number[]; longFrames: unknown[]; startupDelayMs: number; stop: () => void };

for (const viewport of [{ width: 844, height: 390 }, { width: 736, height: 414 }, { width: 1280, height: 800 }]) {
  test(`profiles a live board during consecutive updates (${viewport.width}px)`, async ({ mount, page, browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "CPU and long-frame profiling uses Chromium's performance instrumentation.");
    await page.setViewportSize(viewport);
    const cpuSlowdown = viewport.height < 430 ? 4 : 1;
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setCPUThrottlingRate", { rate: cpuSlowdown });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    let state: GameState = { ...newGame(), phase: "rolling" };
    const component = await mount(
      <MockGameWrapper state={state}><GameScreen /></MockGameWrapper>,
    );
    await expect(component.getByTestId("board-frame")).toHaveCSS("opacity", "1");
    // Other component tests disable CSS animations for stable screenshots.
    // This audit restores them so its frame measurements include the real UI.
    await page.evaluate(() => {
      for (const style of document.querySelectorAll("style")) {
        if (style.textContent?.includes("animation-duration: 0s !important")) style.remove();
      }
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => new Promise<void>(resolve => {
      const started = performance.now();
      let previous: number | null = null;
      let frame = 0;
      const audit: FrameAudit = { gaps: [], longTasks: [], longFrames: [], startupDelayMs: 0, stop: () => {} };
      const observer = new PerformanceObserver(list => {
        audit.longTasks.push(...list.getEntries().map(entry => entry.duration));
      });
      observer.observe({ type: "longtask" });
      const frameObserver = new PerformanceObserver(list => {
        audit.longFrames.push(...list.getEntries().map(entry => entry.toJSON()));
      });
      if (PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")) {
        frameObserver.observe({ type: "long-animation-frame" });
      }
      const tick = (now: number) => {
        if (previous !== null) audit.gaps.push(now - previous);
        else {
          audit.startupDelayMs = Math.max(0, now - started);
          resolve();
        }
        previous = now;
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      audit.stop = () => { cancelAnimationFrame(frame); observer.disconnect(); frameObserver.disconnect(); };
      (window as unknown as { __frameAudit: FrameAudit }).__frameAudit = audit;
    }));

    for (let step = 0; step < 40; step++) {
      if (state.phase === "rolling") state = applyRoll(state, [step % 6 + 1, (step + 2) % 6 + 1]);
      const moves = allLegalMoves(state, state.turn);
      if (moves.length) {
        state = applyMove(state, moves[step % moves.length], state.turn);
      } else {
        state = { ...state, phase: "rolling", turn: state.turn === "white" ? "black" : "white", dice: [], remaining: [], lastMove: null, moveHistory: null };
      }
      await component.update(
        <MockGameWrapper state={state}><GameScreen /></MockGameWrapper>,
      );
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(800);
    const metrics = await page.evaluate(() => {
      const audit = (window as unknown as { __frameAudit: FrameAudit }).__frameAudit;
      audit.stop();
      const slowFrames = audit.gaps.flatMap((gap, index) => gap > 50 ? [{ index, gap: Number(gap.toFixed(2)) }] : []);
      audit.gaps.sort((a, b) => a - b);
      return {
        frames: audit.gaps.length,
        startupDelayMs: Number(audit.startupDelayMs.toFixed(2)),
        frameGapP95ms: Number(audit.gaps[Math.floor(audit.gaps.length * .95)].toFixed(2)),
        maxFrameGapMs: Number(Math.max(...audit.gaps).toFixed(2)),
        mainThreadTasksOver50ms: audit.longTasks.length,
        longestMainThreadTaskMs: Math.max(0, ...audit.longTasks),
        slowFrames,
        longAnimationFrames: audit.longFrames,
      };
    });
    console.log(JSON.stringify({ viewport, cpuSlowdown, updates: 40, ...metrics }));
    await testInfo.attach("frame-metrics", { body: JSON.stringify({ viewport, cpuSlowdown, updates: 40, ...metrics }, null, 2), contentType: "application/json" });
    expect(metrics.frames).toBeGreaterThan(30);
    expect(errors).toEqual([]);
    await expect(component.getByTestId("flying-checker")).toHaveCount(0);
  });
}
