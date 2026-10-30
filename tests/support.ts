import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { ref, set } from "firebase/database";
export const question = {
  id: "q1",
  text: "Вопрос?",
  red: "Да",
  blue: "Нет",
  order: 0,
};
export async function environment(projectId: string) {
  const env = await initializeTestEnvironment({
    projectId,
    database: {
      host: "127.0.0.1",
      port: 9000,
      rules: readFileSync("database.rules.json", "utf8"),
    },
  });
  return env;
}
export async function seed(env: RulesTestEnvironment) {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await set(ref(ctx.database()), {
      admins: { host: true },
      games: {
        ABC234: {
          state: { phase: "question_open", roundId: "r1", question },
          questions: { q1: question },
          participants: { alice: { name: "Алиса" }, bob: { name: "Боб" } },
        },
      },
    });
  });
}
