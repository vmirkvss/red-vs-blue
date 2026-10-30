import { it, expect } from "vitest";
import {
  ref,
  set,
  get,
  onValue,
  runTransaction,
  onDisconnect,
  goOffline,
} from "firebase/database";
import { environment, seed } from "./support";
import { results } from "../src/model";
it("60 independent emulator clients vote and receive host transitions", async () => {
  const env = await environment("demo-load");
  try {
    await seed(env);
    const host = env.authenticatedContext("host").database();
    const clients = Array.from({ length: 60 }, (_, i) => ({
      uid: `p${i}`,
      db: env.authenticatedContext(`p${i}`).database(),
    }));
    const seen = new Set<string>();
    const stops = clients.map(({ uid, db }) =>
      onValue(ref(db, "games/ABC234/state"), (s) => {
        if (s.val()?.phase === "results_revealed") seen.add(uid);
      }),
    );
    await Promise.all(
      clients.map(async ({ uid, db }) => {
        await set(ref(db, `games/ABC234/participants/${uid}`), { name: uid });
        const presence = ref(db, `games/ABC234/presence/${uid}/tab`);
        await onDisconnect(presence).remove();
        await set(presence, true);
        const result = await runTransaction(
          ref(db, `games/ABC234/votes/r1/${uid}`),
          (v) =>
            v === null
              ? Number(uid.slice(1)) < 24
                ? "red"
                : "blue"
              : undefined,
          { applyLocally: false },
        );
        expect(result.committed).toBe(true);
      }),
    );
    await set(ref(host, "games/ABC234/state/phase"), "voting_closed");
    await set(ref(host, "games/ABC234/state/phase"), "results_revealed");
    const votes = (await get(ref(host, "games/ABC234/votes/r1"))).val();
    expect(results(votes)).toMatchObject({
      red: 24,
      blue: 36,
      total: 60,
      redPercent: 40,
      bluePercent: 60,
    });
    await Promise.all(
      clients.map(async ({ db }) =>
        expect(
          results((await get(ref(db, "games/ABC234/votes/r1"))).val()).total,
        ).toBe(60),
      ),
    );
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const timer = setInterval(() => {
        if (seen.size === 60) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() > deadline) {
          clearInterval(timer);
          reject(new Error(`Only ${seen.size} received results`));
        }
      }, 20);
    });
    goOffline(clients[0].db);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        off();
        reject(new Error("Presence not removed"));
      }, 5000);
      const off = onValue(ref(host, "games/ABC234/presence/p0"), (s) => {
        if (!s.exists()) {
          clearTimeout(timeout);
          off();
          resolve();
        }
      });
    });
    stops.forEach((s) => s());
  } finally {
    await env.cleanup();
  }
}, 60000);
