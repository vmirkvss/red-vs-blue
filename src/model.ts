export type Choice = "red" | "blue";
export type Phase =
  | "waiting"
  | "question_open"
  | "voting_closed"
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
  phase: Phase;
  roundId: string;
  question: Question | null;
}
export const initial: State = {
  phase: "waiting",
  roundId: "none",
  question: null,
};
export function results(votes: Record<string, Choice> = {}) {
  const values = Object.values(votes);
  const red = values.filter((v) => v === "red").length;
  const blue = values.filter((v) => v === "blue").length;
  const total = red + blue;
  const redPercent = total ? Math.round((red / total) * 100) : 0;
  return {
    red,
    blue,
    total,
    redPercent,
    bluePercent: total ? 100 - redPercent : 0,
  };
}
export function canTransition(from: Phase, to: Phase) {
  return (
    {
      waiting: ["question_open", "finished"],
      question_open: ["voting_closed", "finished"],
      voting_closed: ["results_revealed", "finished"],
      results_revealed: ["question_open", "finished"],
      finished: ["waiting"],
    } as Record<Phase, Phase[]>
  )[from].includes(to);
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
