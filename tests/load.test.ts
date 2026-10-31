import { it, expect } from "vitest";
import {
  ref,
  set,
  get,
  onValue,
  onDisconnect,
  goOffline,
} from "firebase/database";
import { environment, question } from "./support";
import { initial, type State } from "../src/model";
import { joinGame, castVote, transition, finalizeRound } from "../src/gameApi";
it("60 clients register concurrently, vote twice, synchronize and share finalized scores", async () => {
  const env = await environment("demo-load");
  const stops: (() => void)[] = [];
  try {
    await env.withSecurityRulesDisabled((c) =>
      set(ref(c.database()), {
        admins: { host: true },
        games: { ABC234: { state: initial, questions: { q1: question } } },
      }),
    );
    const host = env.authenticatedContext("host").database();
    const clients = Array.from({ length: 60 }, (_, i) => ({
      uid: `p${i}`,
      db: env.authenticatedContext(`p${i}`).database(),
    }));
    const seen = new Map<string, Set<string>>();
    for (const { uid, db } of clients) {
      seen.set(uid, new Set());
      stops.push(
        onValue(ref(db, "games/ABC234/state"), (snap) => {
          seen.get(uid)!.add(snap.val()?.phase);
        }),
      );
    }
    await Promise.all(
      clients.map(async ({ uid, db }) => {
        await joinGame(db, "ABC234", uid, `Игрок ${uid.slice(1)}`);
        const p = ref(db, `games/ABC234/presence/${uid}/tab`);
        await onDisconnect(p).remove();
        await set(p, true);
      }),
    );
    expect((await get(ref(host, "games/ABC234/roster/count"))).val()).toBe(60);
    let state = (await get(ref(host, "games/ABC234/state"))).val() as State;
    await transition(host, "ABC234", state, "phase1_open", question);
    state = (await get(ref(host, "games/ABC234/state"))).val();
    const round = state.roundId;
    await Promise.all(
      clients.map(({ uid, db }, i) =>
        castVote(db, "ABC234", round, "phase1", uid, i < 38 ? "red" : "blue"),
      ),
    );
    await transition(host, "ABC234", state, "phase1_closed");
    state = { ...state, phase: "phase1_closed" };
    await transition(host, "ABC234", state, "phase2_open");
    state = { ...state, phase: "phase2_open" };
    await Promise.all(
      clients.map(({ uid, db }, i) =>
        castVote(db, "ABC234", round, "phase2", uid, i < 45 ? "red" : "blue"),
      ),
    );
    await transition(host, "ABC234", state, "phase2_closed");
    await finalizeRound(host, "ABC234", round);
    await Promise.all(
      clients.map(async ({ db }, i) => {
        const result = (
          await get(ref(db, `games/ABC234/roundResults/${round}`))
        ).val();
        expect(result).toEqual({
          phase1: { red: 38, blue: 22 },
          phase2: { red: 45, blue: 15 },
          winner: "red",
          awarded: 45,
        });
        const scores = (
          await get(ref(db, `games/ABC234/scores/${round}`))
        ).val();
        expect(Object.keys(scores)).toHaveLength(60);
        expect(scores[`p${i}`].total).toBe(i < 45 ? 1 : 0);
      }),
    );
    for (const phases of seen.values())
      for (const phase of [
        "waiting",
        "phase1_open",
        "phase1_closed",
        "phase2_open",
        "phase2_closed",
        "results_revealed",
      ])
        expect(phases.has(phase)).toBe(true);
    goOffline(clients[0].db);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        off();
        reject(new Error("Presence not removed"));
      }, 5000);
      const off = onValue(ref(host, "games/ABC234/presence/p0"), (snap) => {
        if (!snap.exists()) {
          clearTimeout(timeout);
          off();
          resolve();
        }
      });
    });
  } finally {
    stops.forEach((s) => s());
    await env.cleanup();
  }
}, 90000);
