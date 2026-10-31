import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { ref, set, get } from "firebase/database";
import { initial, type State } from "../src/model";
import { transition, castVote } from "../src/gameApi";
export const question = {
  id: "q1",
  text: "Вопрос?",
  red: "Да",
  blue: "Нет",
  order: 0,
};
export async function environment(projectId: string) {
  return initializeTestEnvironment({
    projectId,
    database: {
      host: "127.0.0.1",
      port: 9000,
      rules: readFileSync("database.rules.json", "utf8"),
    },
  });
}
export async function seed(env: RulesTestEnvironment) {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async (ctx) =>
    set(ref(ctx.database()), {
      admins: { host: true },
      games: {
        ABC234: {
          state: { ...initial, phase: "phase1_open", roundId: "r1", question },
          questions: { q1: question, q2: { ...question, id: "q2", order: 1 } },
          usedQuestions: { q1: "r1" },
          participants: {
            alice: { name: "Алиса", next: "bob" },
            bob: { name: "Боб", next: "none" },
          },
          roster: { head: "alice", count: 2 },
        },
      },
    }),
  );
}
export async function advance(
  env: RulesTestEnvironment,
  phase: "phase1_closed" | "phase2_open" | "phase2_closed" | "finished",
) {
  const db = env.authenticatedContext("host").database();
  const state = (await get(ref(db, "games/ABC234/state"))).val() as State;
  await transition(db, "ABC234", state, phase);
}
export async function closedRound(
  env: RulesTestEnvironment,
  one: { alice?: "red" | "blue"; bob?: "red" | "blue" } = {
    alice: "red",
    bob: "red",
  },
  two: { alice?: "red" | "blue"; bob?: "red" | "blue" } = {
    alice: "red",
    bob: "blue",
  },
) {
  for (const [uid, v] of Object.entries(one))
    await castVote(
      env.authenticatedContext(uid).database(),
      "ABC234",
      "r1",
      "phase1",
      uid,
      v,
    );
  await advance(env, "phase1_closed");
  await advance(env, "phase2_open");
  for (const [uid, v] of Object.entries(two))
    await castVote(
      env.authenticatedContext(uid).database(),
      "ABC234",
      "r1",
      "phase2",
      uid,
      v,
    );
  await advance(env, "phase2_closed");
}
