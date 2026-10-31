import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  ref,
  set,
  get,
  update,
  goOffline,
  goOnline,
  onValue,
} from "firebase/database";
import { environment, seed, question, advance, closedRound } from "./support";
import {
  castVote,
  finalizeRound,
  joinGame,
  transition,
  resetGame,
  migrateGame,
} from "../src/gameApi";
import { initial, scoreParticipant, type State } from "../src/model";
let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await environment("demo-rules");
});
beforeEach(() => seed(env));
afterAll(() => env.cleanup());
const db = (uid = "alice") => env.authenticatedContext(uid).database();
const vote = (
  uid = "alice",
  phase: "phase1" | "phase2" = "phase1",
  choice: "red" | "blue" = "red",
) => castVote(db(uid), "ABC234", "r1", phase, uid, choice);
it("rejects unauthenticated reads", async () => {
  await assertFails(
    get(ref(env.unauthenticatedContext().database(), "games/ABC234/state")),
  );
});
it("participants cannot edit questions, state, scores or allowlist", async () => {
  for (const [path, value] of [
    ["questions/q1/text", "Hacked"],
    ["state/phase", "finished"],
    ["scores/r1/alice", { total: 99 }],
    ["roundResults/r1", { winner: "red" }],
  ] as const)
    await assertFails(set(ref(db(), `games/ABC234/${path}`), value));
  await assertFails(set(ref(db(), "admins/alice"), true));
});
it("rejects email user outside allowlist", async () => {
  await assertFails(
    set(
      ref(
        env
          .authenticatedContext("intruder", { email: "test@example.com" })
          .database(),
        "games/ABC234/state/phase",
      ),
      "phase1_closed",
    ),
  );
});
it("rejects skipped or backward phases even for host", async () => {
  await assertFails(
    set(ref(db("host"), "games/ABC234/state/phase"), "phase2_open"),
  );
  await assertFails(
    set(ref(db("host"), "games/ABC234/state/phase"), "finished"),
  );
  await advance(env, "phase1_closed");
  await assertFails(
    set(ref(db("host"), "games/ABC234/state/phase"), "phase1_open"),
  );
  await assertFails(
    set(ref(db("host"), "games/ABC234/state/question/text"), "Changed"),
  );
});
it("allows one vote per phase with separate storage", async () => {
  await vote();
  await assertFails(vote());
  await advance(env, "phase1_closed");
  await advance(env, "phase2_open");
  await vote("alice", "phase2", "blue");
  await assertFails(vote("alice", "phase2", "red"));
  expect(
    (
      await get(ref(db("host"), "games/ABC234/phase1Votes/r1/votes/alice"))
    ).val(),
  ).toBe("red");
  expect(
    (
      await get(ref(db("host"), "games/ABC234/phase2Votes/r1/votes/alice"))
    ).val(),
  ).toBe("blue");
});
it("rejects deletes, impersonation and invalid choices", async () => {
  await vote();
  await assertFails(
    set(ref(db(), "games/ABC234/phase1Votes/r1/votes/alice"), null),
  );
  await assertFails(castVote(db(), "ABC234", "r1", "phase1", "bob", "red"));
  await assertFails(
    castVote(db("bob"), "ABC234", "r1", "phase1", "bob", "green" as "red"),
  );
});
it("concurrent duplicate requests persist exactly once", async () => {
  const outcomes = await Promise.allSettled([vote(), vote()]);
  expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(
    (await get(ref(db("host"), "games/ABC234/phase1Votes/r1/counts"))).val(),
  ).toEqual({ red: 1, blue: 0 });
});
it("counter cannot be forged or omitted, even by a host", async () => {
  await assertFails(
    set(ref(db(), "games/ABC234/phase1Votes/r1/votes/alice"), "red"),
  );
  await assertFails(
    set(ref(db(), "games/ABC234/phase1Votes/r1/counts"), { red: 99, blue: 0 }),
  );
  await assertFails(
    update(ref(db(), "games/ABC234/phase1Votes/r1"), {
      "votes/alice": "red",
      counts: { red: 2, blue: 0 },
    }),
  );
  await vote();
  await assertFails(
    set(ref(db("host"), "games/ABC234/phase1Votes/r1/counts/red"), 30),
  );
});
it("rejects votes after each close and for stale rounds", async () => {
  await assertFails(castVote(db(), "ABC234", "old", "phase1", "alice", "red"));
  await advance(env, "phase1_closed");
  await assertFails(vote());
  await advance(env, "phase2_open");
  await advance(env, "phase2_closed");
  await assertFails(vote("alice", "phase2"));
});
it("both vote collections and distributions stay private, including during phase2", async () => {
  await vote();
  await advance(env, "phase1_closed");
  await advance(env, "phase2_open");
  for (const p of [
    "phase1Votes/r1",
    "phase1Votes/r1/counts",
    "phase1Votes/r1/votes/alice",
    "phase2Votes/r1",
    "roundResults/r1",
    "scores/r1",
  ])
    await assertFails(get(ref(db("bob"), `games/ABC234/${p}`)));
  await assertSucceeds(
    get(ref(db(), "games/ABC234/phase1Votes/r1/votes/alice")),
  );
});
it("membership roster updates atomically and only its owner registers", async () => {
  await assertFails(vote("new"));
  await assertFails(
    set(ref(db(), "games/ABC234/participants/bob"), {
      name: "Bad",
      next: "none",
    }),
  );
  await joinGame(db("new"), "ABC234", "new", "Новый");
  expect((await get(ref(db("host"), "games/ABC234/roster"))).val()).toEqual({
    head: "new",
    count: 3,
  });
  await assertFails(
    set(ref(db("new"), "games/ABC234/participants/new/next"), "none"),
  );
  await assertFails(set(ref(db("new"), "games/ABC234/roster/head"), "bob"));
});
it("freezes registration during scoring", async () => {
  await closedRound(env);
  await assertFails(joinGame(db("new"), "ABC234", "new", "Новый"));
});
it("scores correct predictions, not personal opinions; persists complete leaderboard", async () => {
  await closedRound(
    env,
    { alice: "red", bob: "red" },
    { alice: "blue", bob: "red" },
  );
  await finalizeRound(db("host"), "ABC234", "r1");
  const scores = (await get(ref(db(), "games/ABC234/scores/r1"))).val();
  expect(scores.alice).toMatchObject({ total: 0, completed: 1 });
  expect(scores.bob).toMatchObject({ total: 1, correct: 1 });
  expect(
    (await get(ref(db(), "games/ABC234/roundResults/r1"))).val(),
  ).toMatchObject({ winner: "red", awarded: 1 });
});
it("tie gives each predictor one point, missing prediction gets zero", async () => {
  await closedRound(env, { alice: "red", bob: "blue" }, { alice: "blue" });
  await finalizeRound(db("host"), "ABC234", "r1");
  const scores = (await get(ref(db(), "games/ABC234/scores/r1"))).val();
  expect(scores.alice.total).toBe(1);
  expect(scores.bob.total).toBe(0);
  expect(scores.bob.completed).toBe(0);
});
it("zero opinions award no points", async () => {
  await closedRound(env, {}, { alice: "red", bob: "blue" });
  await finalizeRound(db("host"), "ABC234", "r1");
  expect(
    (await get(ref(db(), "games/ABC234/scores/r1/alice/total"))).val(),
  ).toBe(0);
});
it("cannot reveal early or skip roster cursor, even as host", async () => {
  await closedRound(env);
  await assertFails(
    set(ref(db("host"), "games/ABC234/state/phase"), "results_revealed"),
  );
  await assertFails(
    set(ref(db("host"), "games/ABC234/scoringStatus/r1"), {
      cursor: "none",
      processed: 2,
    }),
  );
  await set(ref(db("host"), "games/ABC234/scoringStatus/r1"), {
    cursor: "alice",
    processed: 0,
  });
  await assertFails(
    set(ref(db("host"), "games/ABC234/scoringStatus/r1"), {
      cursor: "bob",
      processed: 1,
    }),
  );
});
it("rejects forged score and mismatched winner even from host", async () => {
  await closedRound(env);
  const host = db("host");
  await set(ref(host, "games/ABC234/scoringStatus/r1"), {
    cursor: "alice",
    processed: 0,
  });
  await assertFails(
    update(ref(host, "games/ABC234"), {
      "scores/r1/alice": {
        name: "Алиса",
        total: 99,
        correct: 99,
        completed: 1,
        earned: 1,
      },
      "scoringStatus/r1": { cursor: "bob", processed: 1 },
    }),
  );
  await finalizeRound(host, "ABC234", "r1");
  await assertFails(set(ref(host, "games/ABC234/scores/r1/alice/total"), 99));
  await assertFails(
    set(ref(host, "games/ABC234/roundResults/r1/winner"), "blue"),
  );
});
it("resumes after partial scoring; repeated and concurrent finalize does not double-score", async () => {
  await closedRound(env);
  const host = db("host");
  await set(ref(host, "games/ABC234/scoringStatus/r1"), {
    cursor: "alice",
    processed: 0,
  });
  await update(ref(host, "games/ABC234"), {
    "scores/r1/alice": scoreParticipant(
      "Алиса",
      undefined,
      { red: 2, blue: 0 },
      "red",
    ),
    "scoringStatus/r1": { cursor: "bob", processed: 1 },
  });
  await assertFails(get(ref(db(), "games/ABC234/scores/r1")));
  await Promise.all([
    finalizeRound(host, "ABC234", "r1"),
    finalizeRound(db("host"), "ABC234", "r1"),
  ]);
  await finalizeRound(host, "ABC234", "r1");
  expect(
    (await get(ref(db(), "games/ABC234/scores/r1/alice/total"))).val(),
  ).toBe(1);
});
it("accumulates two questions and refuses reopening a scored question", async () => {
  await closedRound(env);
  const host = db("host");
  await finalizeRound(host, "ABC234", "r1");
  let state = (await get(ref(host, "games/ABC234/state"))).val() as State;
  await assertFails(transition(host, "ABC234", state, "phase1_open", question));
  await transition(host, "ABC234", state, "phase1_open", {
    ...question,
    id: "q2",
    order: 1,
  });
  state = (await get(ref(host, "games/ABC234/state"))).val();
  await castVote(db(), "ABC234", state.roundId, "phase1", "alice", "blue");
  await advance(env, "phase1_closed");
  await advance(env, "phase2_open");
  await castVote(db(), "ABC234", state.roundId, "phase2", "alice", "blue");
  await advance(env, "phase2_closed");
  await finalizeRound(host, "ABC234", state.roundId);
  expect(
    (await get(ref(db(), `games/ABC234/scores/${state.roundId}/alice`))).val(),
  ).toMatchObject({ total: 2, completed: 2, correct: 2 });
});
it("reconnect and refreshed UID restore phase and own vote", async () => {
  const d = db();
  await castVote(d, "ABC234", "r1", "phase1", "alice", "red");
  goOffline(d);
  await advance(env, "phase1_closed");
  await advance(env, "phase2_open");
  goOnline(d);
  const current = await new Promise<any>((resolve, reject) => {
    const off = onValue(
      ref(d, "games/ABC234/state"),
      (snap) => {
        if (snap.val()?.phase === "phase2_open") {
          off();
          resolve(snap.val());
        }
      },
      reject,
    );
  });
  expect(current.question.id).toBe("q1");
  expect(
    (await get(ref(db(), "games/ABC234/phase1Votes/r1/votes/alice"))).val(),
  ).toBe("red");
});
it("reset requires finished, clears scoring history and preserves participants/questions", async () => {
  await assertFails(resetGame(db("host"), "ABC234"));
  await closedRound(env);
  await finalizeRound(db("host"), "ABC234", "r1");
  await advance(env, "finished");
  await resetGame(db("host"), "ABC234");
  expect((await get(ref(db("host"), "games/ABC234/scores"))).exists()).toBe(
    false,
  );
  expect(
    (await get(ref(db("host"), "games/ABC234/participants/alice/name"))).val(),
  ).toBe("Алиса");
  await assertFails(vote("bob", "phase2"));
});
it("migrates legacy questions and participants, preserves old votes without inventing scores", async () => {
  await env.withSecurityRulesDisabled(async (c) =>
    set(ref(c.database(), "games/ABC234"), {
      state: { phase: "finished", roundId: "old", question },
      questions: { q1: question },
      participants: { alice: { name: "Алиса" } },
      votes: { old: { alice: "red" } },
    }),
  );
  await migrateGame(db("host"), "ABC234");
  expect(
    (await get(ref(db("host"), "games/ABC234/state"))).val(),
  ).toMatchObject(
    initial.question ? initial : { schemaVersion: 2, phase: "waiting" },
  );
  expect(
    (await get(ref(db("host"), "games/ABC234/votes/old/alice"))).val(),
  ).toBe("red");
  await assertFails(migrateGame(db("host"), "ABC234"));
});
it("presence remains owned per UID and questions editable only in waiting", async () => {
  await assertSucceeds(set(ref(db(), "games/ABC234/presence/alice/tab"), true));
  await assertFails(
    set(ref(db("bob"), "games/ABC234/presence/alice/tab"), null),
  );
  await assertFails(
    set(ref(db("host"), "games/ABC234/questions/q1"), question),
  );
});
it("cannot delete or corrupt roster using an unregistered UID", async () => {
  await assertFails(set(ref(db("new"), "games/ABC234/roster"), null));
  await assertFails(
    update(ref(db("new"), "games/ABC234"), {
      "roster/head": "new",
      "roster/count": 3,
      "participants/new": { name: "New", next: "none" },
    }),
  );
});
it("cannot publish summary without completed scoring or forged totals", async () => {
  await closedRound(env);
  const host = db("host");
  await assertFails(
    update(ref(host, "games/ABC234"), {
      "roundResults/r1": {
        phase1: { red: 2, blue: 0 },
        phase2: { red: 1, blue: 1 },
        winner: "red",
        awarded: 1,
      },
      "state/phase": "results_revealed",
      "state/scoreVersion": "r1",
    }),
  );
  await finalizeRound(host, "ABC234", "r1");
  await assertFails(
    set(ref(host, "games/ABC234/roundResults/r1/phase1/red"), 9),
  );
});
it("zero-participant round can finalize and cannot invent a leaderboard row", async () => {
  await env.withSecurityRulesDisabled((c) =>
    update(ref(c.database(), "games/ABC234"), {
      participants: null,
      roster: null,
    }),
  );
  await advance(env, "phase1_closed");
  await advance(env, "phase2_open");
  await advance(env, "phase2_closed");
  await finalizeRound(db("host"), "ABC234", "r1");
  expect(
    (await get(ref(db(), "games/ABC234/roundResults/r1/winner"))).val(),
  ).toBe("none");
  await assertFails(
    set(ref(db("host"), "games/ABC234/scores/r1/fake"), {
      name: "Fake",
      earned: 1,
      total: 1,
      correct: 1,
      completed: 1,
    }),
  );
});
it("late join after reveal starts at zero without modifying previous leaderboard", async () => {
  await closedRound(env);
  await finalizeRound(db("host"), "ABC234", "r1");
  await joinGame(db("new"), "ABC234", "new", "Новый");
  expect(
    (await get(ref(db("new"), "games/ABC234/scores/r1/new"))).exists(),
  ).toBe(false);
});
it("rejects reserved round ID and substituted question snapshot", async () => {
  await closedRound(env);
  const host = db("host");
  await finalizeRound(host, "ABC234", "r1");
  const state = (await get(ref(host, "games/ABC234/state"))).val();
  const q2 = { ...question, id: "q2", order: 1 };
  await assertFails(
    update(ref(host, "games/ABC234"), {
      state: { ...state, phase: "phase1_open", roundId: "none", question: q2 },
      "usedQuestions/q2": "none",
    }),
  );
  await assertFails(
    transition(host, "ABC234", state, "phase1_open", {
      ...q2,
      text: "Подмена",
    }),
  );
});
