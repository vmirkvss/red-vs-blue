import { describe, it, expect } from "vitest";
import { results, canTransition } from "../src/model";
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
    expect(results()).toEqual({
      red: 0,
      blue: 0,
      total: 0,
      redPercent: 0,
      bluePercent: 0,
    }));
  it("rounds complementary percentages", () => {
    const r = results({ a: "red", b: "blue", c: "blue" });
    expect(r.redPercent).toBe(33);
    expect(r.redPercent + r.bluePercent).toBe(100);
  });
});
it("requires close before reveal and reveal before next", () => {
  expect(canTransition("waiting", "question_open")).toBe(true);
  expect(canTransition("question_open", "results_revealed")).toBe(false);
  expect(canTransition("question_open", "voting_closed")).toBe(true);
  expect(canTransition("voting_closed", "results_revealed")).toBe(true);
  expect(canTransition("voting_closed", "question_open")).toBe(false);
  expect(canTransition("results_revealed", "question_open")).toBe(true);
  expect(canTransition("finished", "waiting")).toBe(true);
});
