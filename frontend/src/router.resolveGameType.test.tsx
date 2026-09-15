import { test, expect } from "@playwright/experimental-ct-react";
import { resolveGameType, isValidTournamentId } from "./router";

function params(query: string) {
  return new URLSearchParams(query);
}

test("isValidTournamentId rejects 0 and empty", async () => {
  expect(isValidTournamentId(null)).toBe(false);
  expect(isValidTournamentId("")).toBe(false);
  expect(isValidTournamentId("0")).toBe(false);
  expect(isValidTournamentId(" 0 ")).toBe(false);
  expect(isValidTournamentId("123")).toBe(true);
  expect(isValidTournamentId("7")).toBe(true);
});

test("?tournament=123 => tournament", async () => {
  expect(resolveGameType(params("tournament=123"))).toBe("tournament");
});

test("?tournament=0 => NOT tournament", async () => {
  expect(resolveGameType(params("tournament=0"))).toBe("1v1");
});

test("?mode=quick&tournament=0 => quick", async () => {
  expect(resolveGameType(params("mode=quick&tournament=0"))).toBe("quick");
});

test("?mode=1v1&tournament=0 => 1v1", async () => {
  expect(resolveGameType(params("mode=1v1&tournament=0"))).toBe("1v1");
});

test("?mode=match => 1v1", async () => {
  expect(resolveGameType(params("mode=match"))).toBe("1v1");
});

test("?mode=friend => 1v1", async () => {
  expect(resolveGameType(params("mode=friend"))).toBe("1v1");
});

test("no parameters => 1v1", async () => {
  expect(resolveGameType(params(""))).toBe("1v1");
});

test("backend format=money => quick", async () => {
  expect(resolveGameType(params(""), "money")).toBe("quick");
  expect(resolveGameType(params("tournament=0"), "money")).toBe("quick");
});

test("backend format=match => 1v1", async () => {
  expect(resolveGameType(params(""), "match")).toBe("1v1");
  expect(resolveGameType(params("tournament=0"), "match")).toBe("1v1");
});

test("real tournament fixture => tournament", async () => {
  expect(resolveGameType(params("tournament=123"), "match")).toBe("tournament");
  expect(resolveGameType(params("tournament=456"), "money")).toBe("tournament");
});

test("exact case ?tournament=0 + format=money => quick", async () => {
  expect(resolveGameType(params("tournament=0"), "money")).toBe("quick");
  expect(resolveGameType(params("tournament=0&format=money"))).toBe("quick");
});
