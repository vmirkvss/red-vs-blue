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
  runTransaction,
  goOffline,
  goOnline,
  onValue,
} from "firebase/database";
import { environment, seed, question } from "./support";
let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await environment("demo-rules");
});
beforeEach(() => seed(env));
afterAll(() => env.cleanup());
const db = (uid = "alice") => env.authenticatedContext(uid).database();
it("rejects unauthenticated reads", async () => {
  await assertFails(
    get(ref(env.unauthenticatedContext().database(), "games/ABC234/state")),
  );
});
it("participants cannot edit questions, state, tally or allowlist", async () => {
  for (const [path, value] of [
    ["questions/q1/text", "Hacked"],
    ["state/phase", "finished"],
    ["tally", { roundId: "r1", count: 99 }],
  ] as const)
    await assertFails(set(ref(db(), `games/ABC234/${path}`), value));
  await assertFails(set(ref(db(), "admins/alice"), true));
});
it("rejects unauthorized non-anonymous administrators", async () => {
  await assertFails(
    set(
      ref(
        env
          .authenticatedContext("intruder", { email: "test@example.com" })
          .database(),
        "games/ABC234/state/phase",
      ),
      "voting_closed",
    ),
  );
});
it("permits authorized host controls", async () => {
  await assertSucceeds(
    set(ref(db("host"), "games/ABC234/state/phase"), "voting_closed"),
  );
  await assertSucceeds(
    set(ref(db("host"), "games/ABC234/state/phase"), "results_revealed"),
  );
});
it("one immutable vote per UID, no deleting or impersonation", async () => {
  const d = db();
  const path = ref(d, "games/ABC234/votes/r1/alice");
  await assertSucceeds(set(path, "red"));
  await assertFails(set(path, "blue"));
  await assertFails(set(path, null));
  await assertFails(set(ref(d, "games/ABC234/votes/r1/bob"), "red"));
});
it("concurrent transactions create exactly one vote", async () => {
  const a = db(),
    b = db();
  const vote = (d: ReturnType<typeof db>, choice: string) =>
    runTransaction(
      ref(d, "games/ABC234/votes/r1/alice"),
      (v) => (v === null ? choice : undefined),
      { applyLocally: false },
    );
  const outcomes = await Promise.allSettled([vote(a, "red"), vote(b, "blue")]);
  expect(
    outcomes.filter((r) => r.status === "fulfilled" && r.value.committed),
  ).toHaveLength(1);
  expect(["red", "blue"]).toContain(
    (await get(ref(a, "games/ABC234/votes/r1/alice"))).val(),
  );
});
it("rejects votes after close and stale rounds and invalid choices", async () => {
  await assertFails(set(ref(db(), "games/ABC234/votes/old/alice"), "red"));
  await assertFails(set(ref(db(), "games/ABC234/votes/r1/alice"), "green"));
  await set(ref(db("host"), "games/ABC234/state/phase"), "voting_closed");
  await assertFails(set(ref(db(), "games/ABC234/votes/r1/alice"), "red"));
});
it("protects votes until reveal while host can count", async () => {
  await set(ref(db(), "games/ABC234/votes/r1/alice"), "red");
  await assertFails(get(ref(db("bob"), "games/ABC234/votes/r1")));
  await assertFails(get(ref(db("bob"), "games/ABC234/votes/r1/alice")));
  await assertSucceeds(get(ref(db("host"), "games/ABC234/votes/r1")));
  await set(ref(db("host"), "games/ABC234/state/phase"), "results_revealed");
  expect(
    (await assertSucceeds(get(ref(db("bob"), "games/ABC234/votes/r1")))).val(),
  ).toEqual({ alice: "red" });
});
it("requires membership and immutable valid participant profile", async () => {
  await assertFails(set(ref(db("new"), "games/ABC234/votes/r1/new"), "red"));
  await assertFails(
    set(ref(db(), "games/ABC234/participants/bob"), { name: "Bad" }),
  );
  await assertFails(
    set(ref(db("new"), "games/ABC234/participants/new"), { name: "" }),
  );
  await assertSucceeds(
    set(ref(db("new"), "games/ABC234/participants/new"), { name: "Новый" }),
  );
  await assertFails(
    set(ref(db("new"), "games/ABC234/participants/new"), { name: "Изменён" }),
  );
});
it("presence is owned per participant and connection", async () => {
  await assertSucceeds(
    set(ref(db(), "games/ABC234/presence/alice/tab1"), true),
  );
  await assertFails(
    set(ref(db("bob"), "games/ABC234/presence/alice/tab1"), null),
  );
  await assertSucceeds(
    set(ref(db(), "games/ABC234/presence/alice/tab1"), null),
  );
});
it("reconnect retrieves current question and preserves vote", async () => {
  const d = db();
  await set(ref(d, "games/ABC234/votes/r1/alice"), "red");
  goOffline(d);
  await set(ref(db("host"), "games/ABC234/state"), {
    phase: "question_open",
    roundId: "r2",
    question: { ...question, id: "q2" },
  });
  goOnline(d);
  const current = await new Promise<any>((resolve, reject) => {
    const off = onValue(
      ref(d, "games/ABC234/state"),
      (s) => {
        if (s.val()?.roundId === "r2") {
          off();
          resolve(s.val());
        }
      },
      reject,
    );
  });
  expect(current.question.id).toBe("q2");
  const restored = db();
  expect((await get(ref(restored, "games/ABC234/votes/r1/alice"))).val()).toBe(
    "red",
  );
  await assertFails(set(ref(restored, "games/ABC234/votes/r1/alice"), "blue"));
});
it("reset is atomic and invalidates stale submissions", async () => {
  await set(ref(db(), "games/ABC234/votes/r1/alice"), "red");
  await assertSucceeds(
    update(ref(db("host"), "games/ABC234"), {
      state: { phase: "waiting", roundId: "none" },
      votes: null,
      tally: null,
    }),
  );
  await assertFails(set(ref(db("bob"), "games/ABC234/votes/r1/bob"), "blue"));
  expect((await get(ref(db(), "games/ABC234/state/phase"))).val()).toBe(
    "waiting",
  );
});
it("questions can only be edited in lobby", async () => {
  await assertFails(
    set(ref(db("host"), "games/ABC234/questions/q1"), question),
  );
  await set(ref(db("host"), "games/ABC234/state/phase"), "waiting");
  await assertSucceeds(
    set(ref(db("host"), "games/ABC234/questions/q1"), {
      ...question,
      text: "Новый вопрос",
    }),
  );
});
