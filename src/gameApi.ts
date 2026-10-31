import {
  get,
  ref,
  update,
  set,
  increment,
  type Database,
} from "firebase/database";
import {
  canTransition,
  initial,
  scoreParticipant,
  finalizeResult,
  type Choice,
  type State,
  type Question,
  type VotingPhase,
  type Participant,
  type Score,
  type BallotBox,
  type ScoringStatus,
} from "./model";
const empty = { red: 0, blue: 0 };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** CAS registration: immutable linked roster lets server rules prove scoring completeness. */
export async function joinGame(
  db: Database,
  game: string,
  uid: string,
  name: string,
) {
  if (!name.trim() || name.trim().length > 24) throw new Error("invalid-name");
  const base = `games/${game}`;
  for (let attempt = 0; attempt < 40; attempt++) {
    if ((await get(ref(db, `${base}/participants/${uid}`))).exists()) return;
    const roster = (await get(ref(db, `${base}/roster`))).val();
    try {
      await update(ref(db, base), {
        [`participants/${uid}`]: {
          name: name.trim(),
          next: roster?.head ?? "none",
        },
        "roster/head": uid,
        "roster/count": increment(1),
      });
      return;
    } catch (error) {
      const state = (await get(ref(db, `${base}/state`))).val() as State | null;
      if (
        !state ||
        state.schemaVersion !== 2 ||
        ![
          "waiting",
          "phase1_open",
          "phase1_closed",
          "phase2_open",
          "results_revealed",
        ].includes(state.phase) ||
        attempt === 39
      )
        throw error;
      await pause(30 + Math.random() * Math.min(1000, 70 * (attempt + 1)));
    }
  }
}
/** Vote and both count fields are validated as one server-side atomic update. */
export function castVote(
  db: Database,
  game: string,
  round: string,
  phase: VotingPhase,
  uid: string,
  choice: Choice,
) {
  return update(ref(db, `games/${game}/${phase}Votes/${round}`), {
    [`votes/${uid}`]: choice,
    "counts/red": increment(choice === "red" ? 1 : 0),
    "counts/blue": increment(choice === "blue" ? 1 : 0),
  });
}
export async function transition(
  db: Database,
  game: string,
  expected: State,
  phase: PhaseTarget,
  question?: Question,
) {
  if (!canTransition(expected.phase, phase)) throw new Error("stale");
  const base = `games/${game}`;
  if (phase === "phase1_open") {
    if (!question) throw new Error("empty");
    const roundId = crypto.randomUUID();
    await update(ref(db, base), {
      state: { ...expected, phase, roundId, question },
      [`usedQuestions/${question.id}`]: roundId,
    });
  } else {
    await set(ref(db, `${base}/state`), { ...expected, phase });
  }
}
type PhaseTarget = Exclude<State["phase"], "results_revealed" | "waiting">;
/** Resume an immutable scoring ledger. Every row and every cursor step is checked by RTDB rules. */
export async function finalizeRound(
  db: Database,
  game: string,
  roundId: string,
  onProgress?: (done: number) => void,
) {
  const base = `games/${game}`;
  for (let retry = 0; retry < 10; retry++) {
    const s = (await get(ref(db, `${base}/state`))).val() as State;
    if (!s || s.roundId !== roundId) throw new Error("stale");
    if (s.phase === "results_revealed") return;
    if (s.phase !== "phase2_closed") throw new Error("stale");
    const [rosterSnap, profilesSnap, oneSnap, twoSnap, previousSnap] =
      await Promise.all([
        get(ref(db, `${base}/roster`)),
        get(ref(db, `${base}/participants`)),
        get(ref(db, `${base}/phase1Votes/${roundId}/counts`)),
        get(ref(db, `${base}/phase2Votes/${roundId}`)),
        get(ref(db, `${base}/scores/${s.scoreVersion}`)),
      ]);
    const profiles: Record<string, Participant> = profilesSnap.val() ?? {};
    const one: BallotBox = { counts: oneSnap.val() ?? empty },
      two: BallotBox = twoSnap.val() ?? {};
    const previous: Record<string, Score> = previousSnap.val() ?? {};
    try {
      const progressSnapshot = await get(
        ref(db, `${base}/scoringStatus/${roundId}`),
      );
      let progress: ScoringStatus = progressSnapshot.val() ?? {
        cursor: rosterSnap.val()?.head ?? "none",
        processed: 0,
      };
      if (!progressSnapshot.exists())
        await set(ref(db, `${base}/scoringStatus/${roundId}`), progress);
      while (progress.cursor !== "none") {
        const uid: string = progress.cursor;
        const profile: Participant = profiles[uid];
        if (!profile) throw new Error("roster");
        const row = scoreParticipant(
          profile.name,
          previous[uid],
          one.counts ?? empty,
          two.votes?.[uid],
        );
        const next: ScoringStatus = {
          cursor: profile.next,
          processed: progress.processed + 1,
        };
        await update(ref(db, base), {
          [`scores/${roundId}/${uid}`]: row,
          [`scoringStatus/${roundId}`]: next,
        });
        progress = next;
        onProgress?.(progress.processed);
      }
      await update(ref(db, base), {
        state: { ...s, phase: "results_revealed", scoreVersion: roundId },
        [`roundResults/${roundId}`]: finalizeResult(
          one.counts ?? empty,
          two.counts ?? empty,
        ),
      });
      return;
    } catch (error) {
      if (retry === 9) throw error;
      await pause(100);
    }
  }
}
export async function resetGame(db: Database, game: string) {
  await update(ref(db, `games/${game}`), {
    state: initial,
    phase1Votes: null,
    phase2Votes: null,
    scores: null,
    roundResults: null,
    scoringStatus: null,
    usedQuestions: null,
    tally: null,
  });
}
/** Explicit migration; preserves legacy votes, question IDs and existing participant names. */
export async function migrateGame(db: Database, game: string) {
  const base = `games/${game}`;
  const profiles = (await get(ref(db, `${base}/participants`))).val() as Record<
    string,
    { name: string }
  > | null;
  const patch: Record<string, unknown> = { state: initial };
  let head = "none",
    count = 0;
  for (const [uid] of Object.entries(profiles ?? {})) {
    patch[`participants/${uid}/next`] = head;
    head = uid;
    count++;
  }
  patch.roster = { head, count };
  await update(ref(db, base), patch);
}
