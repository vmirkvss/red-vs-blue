export type Choice = "red" | "blue";
export type VotingPhase = "phase1" | "phase2";
export type Phase =
  | "waiting"
  | "phase1_open"
  | "phase1_closed"
  | "phase2_open"
  | "phase2_closed"
  | "results_revealed"
  | "finished";
export interface Question {
  id: string;
  text: string;
  red: string;
  blue: string;
  order: number;
}
export interface State {
  schemaVersion: 2;
  phase: Phase;
  roundId: string;
  scoreVersion: string;
  question: Question | null;
}
export interface Participant {
  name: string;
  next: string;
}
export interface Counts {
  red: number;
  blue: number;
}
export interface BallotBox {
  counts?: Counts;
  votes?: Record<string, Choice>;
}
export interface Score {
  name: string;
  total: number;
  correct: number;
  completed: number;
  earned: number;
}
export interface RoundResult {
  phase1: Counts;
  phase2: Counts;
  winner: Choice | "tie" | "none";
  awarded: number;
}
export interface ScoringStatus {
  cursor: string;
  processed: number;
}
export const initial: State = {
  schemaVersion: 2,
  phase: "waiting",
  roundId: "none",
  scoreVersion: "none",
  question: null,
};
export const label: Record<Phase, string> = {
  waiting: "Собираемся вместе",
  phase1_open: "Раунд 1: Твоё мнение",
  phase1_closed: "Раунд 1 завершён",
  phase2_open: "Раунд 2: Угадай большинство",
  phase2_closed: "Прогнозы приняты",
  results_revealed: "Вот что мы выбрали",
  finished: "Спасибо за игру!",
};
export function canTransition(from: Phase, to: Phase) {
  return (
    (
      {
        waiting: ["phase1_open", "finished"],
        phase1_open: ["phase1_closed"],
        phase1_closed: ["phase2_open"],
        phase2_open: ["phase2_closed"],
        phase2_closed: ["results_revealed"],
        results_revealed: ["phase1_open", "finished"],
        finished: ["waiting"],
      } as Record<Phase, Phase[]>
    )[from]?.includes(to) ?? false
  );
}
export function votingPhase(s: State): VotingPhase {
  return s.phase.startsWith("phase1") ? "phase1" : "phase2";
}
export function countVotes(votes: Record<string, Choice> = {}): Counts {
  return {
    red: Object.values(votes).filter((v) => v === "red").length,
    blue: Object.values(votes).filter((v) => v === "blue").length,
  };
}
export function distribution(
  { red = 0, blue = 0 }: Counts = { red: 0, blue: 0 },
) {
  const total = red + blue;
  const redPercent = total ? Math.round((red / total) * 1000) / 10 : 0;
  return {
    red,
    blue,
    total,
    redPercent,
    bluePercent: total ? Math.round((100 - redPercent) * 10) / 10 : 0,
  };
}
export function results(votes: Record<string, Choice> = {}) {
  return distribution(countVotes(votes));
}
export function winner(counts: Counts): RoundResult["winner"] {
  return counts.red + counts.blue === 0
    ? "none"
    : counts.red === counts.blue
      ? "tie"
      : counts.red > counts.blue
        ? "red"
        : "blue";
}
export function points(counts: Counts, prediction?: Choice) {
  const answer = winner(counts);
  return prediction &&
    answer !== "none" &&
    (answer === "tie" || answer === prediction)
    ? 1
    : 0;
}
export function scoreParticipant(
  name: string,
  previous: Score | undefined,
  counts: Counts,
  prediction?: Choice,
): Score {
  const earned = points(counts, prediction);
  return {
    name,
    total: (previous?.total ?? 0) + earned,
    correct: (previous?.correct ?? 0) + earned,
    completed: (previous?.completed ?? 0) + (prediction ? 1 : 0),
    earned,
  };
}
export function finalizeResult(phase1: Counts, phase2: Counts): RoundResult {
  const answer = winner(phase1);
  return {
    phase1,
    phase2,
    winner: answer,
    awarded:
      answer === "none"
        ? 0
        : answer === "tie"
          ? phase2.red + phase2.blue
          : phase2[answer],
  };
}
export function rankings(scores: Record<string, Score> = {}) {
  return Object.entries(scores)
    .map(([uid, s]) => ({ uid, ...s }))
    .sort(
      (a, b) =>
        b.total - a.total ||
        b.completed - a.completed ||
        a.name.localeCompare(b.name, "ru") ||
        a.uid.localeCompare(b.uid, "en"),
    )
    .map((s, i) => ({ ...s, rank: i + 1 }));
}
export const samples: Question[] = [
  {
    id: "time",
    text: "Куда отправимся: в прошлое или в будущее?",
    red: "В прошлое",
    blue: "В будущее",
    order: 0,
  },
  {
    id: "trip",
    text: "Идеальные выходные — это…",
    red: "Горы и приключения",
    blue: "Море и спокойствие",
    order: 1,
  },
  {
    id: "power",
    text: "Какую суперспособность выберете?",
    red: "Читать мысли",
    blue: "Телепортироваться",
    order: 2,
  },
];
