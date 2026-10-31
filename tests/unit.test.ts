import { describe, it, expect } from "vitest";
import {
  results,
  canTransition,
  points,
  scoreParticipant,
  rankings,
  finalizeResult,
  type Score,
} from "../src/model";
describe("results", () => {
  it("counts actual votes", () =>
    expect(
      results(
        Object.fromEntries(
          Array.from({ length: 60 }, (_, i) => [i, i < 24 ? "red" : "blue"]),
        ),
      ),
    ).toEqual({
      red: 24,
      blue: 36,
      total: 60,
      redPercent: 40,
      bluePercent: 60,
    }));
  it("handles zero votes", () =>
    expect(results()).toMatchObject({
      total: 0,
      redPercent: 0,
      bluePercent: 0,
    }));
  it("rounds complementary percentages to one decimal", () => {
    const r = results({ a: "red", b: "blue", c: "blue" });
    expect(r.redPercent).toBe(33.3);
    expect(r.redPercent + r.bluePercent).toBe(100);
  });
});
it("requires all voting phases and results before next question", () => {
  const states = [
    "waiting",
    "phase1_open",
    "phase1_closed",
    "phase2_open",
    "phase2_closed",
    "results_revealed",
  ] as const;
  for (let i = 0; i < states.length - 1; i++)
    expect(canTransition(states[i], states[i + 1])).toBe(true);
  expect(canTransition("phase1_closed", "results_revealed")).toBe(false);
  expect(canTransition("phase1_open", "finished")).toBe(false);
  expect(canTransition("phase2_closed", "phase1_open")).toBe(false);
});
it("scores predictions only; absent prediction earns zero", () => {
  expect(points({ red: 3, blue: 2 }, "red")).toBe(1);
  expect(points({ red: 3, blue: 2 }, "blue")).toBe(0);
  expect(points({ red: 3, blue: 2 })).toBe(0);
});
it("tie rewards both colors but zero opinions rewards nobody", () => {
  expect(points({ red: 2, blue: 2 }, "blue")).toBe(1);
  expect(points({ red: 2, blue: 2 }, "red")).toBe(1);
  expect(points({ red: 0, blue: 0 }, "red")).toBe(0);
  expect(finalizeResult({ red: 0, blue: 0 }, { red: 2, blue: 3 }).awarded).toBe(
    0,
  );
});
it("accumulates score and completed predictions", () => {
  const a = scoreParticipant("А", undefined, { red: 2, blue: 1 }, "red");
  const b = scoreParticipant("А", a, { red: 2, blue: 1 }, "blue");
  const c = scoreParticipant("А", b, { red: 1, blue: 1 });
  expect(c).toEqual({
    name: "А",
    total: 1,
    correct: 1,
    completed: 2,
    earned: 0,
  });
});
it("sorts score, completed, Russian nickname, deterministic UID", () => {
  const row = (name: string, total: number, completed: number): Score => ({
    name,
    total,
    completed,
    correct: total,
    earned: 0,
  });
  expect(
    rankings({
      d: row("Борис", 2, 3),
      c: row("Анна", 2, 3),
      b: row("Яна", 2, 4),
      a: row("Лев", 3, 3),
    }).map((x) => x.uid),
  ).toEqual(["a", "b", "c", "d"]);
});
