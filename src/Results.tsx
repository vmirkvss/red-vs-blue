import {
  distribution,
  rankings,
  type Choice,
  type Counts,
  type RoundResult,
  type Score,
} from "./model";
export function Distribution({
  counts,
  title,
}: {
  counts: Counts;
  title: string;
}) {
  const r = distribution(counts);
  return (
    <section className="results" aria-label={title}>
      <div className="result-head">
        <span>{title}</span>
        <span>Ответов: {r.total}</span>
      </div>
      <div className="percent">
        <strong className="red-text">
          {r.redPercent.toLocaleString("ru")}%
        </strong>
        <strong className="blue-text">
          {r.bluePercent.toLocaleString("ru")}%
        </strong>
      </div>
      <div className="bar">
        <div className="red" style={{ width: `${r.redPercent}%` }} />
        <div className="blue" style={{ width: `${r.bluePercent}%` }} />
      </div>
      <div className="result-head">
        <span>Красный · {r.red}</span>
        <span>Синий · {r.blue}</span>
      </div>
    </section>
  );
}
export function Leaderboard({
  scores,
  uid,
  limit,
  final = false,
}: {
  scores: Record<string, Score>;
  uid?: string;
  limit?: number;
  final?: boolean;
}) {
  const rows = rankings(scores);
  return (
    <section className={`leaderboard ${final ? "final-ranking" : ""}`}>
      <h2>
        {final
          ? "Финальный рейтинг"
          : limit
            ? "Топ-10 команды"
            : "Рейтинг команды"}
      </h2>
      {!rows.length ? (
        <p>Рейтинг появится после первого завершённого вопроса.</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th scope="col">Место</th>
                <th scope="col">Участник</th>
                <th scope="col">Баллы</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit ?? rows.length).map((s) => (
                <tr
                  key={s.uid}
                  className={`${s.uid === uid ? "is-me" : ""} ${final && s.rank <= 3 ? "podium podium-" + s.rank : ""}`}
                >
                  <td>
                    {final && s.rank <= 3
                      ? ["🥇", "🥈", "🥉"][s.rank - 1]
                      : s.rank}
                  </td>
                  <th scope="row">
                    {s.name}
                    {s.uid === uid && <small> · это ты</small>}
                  </th>
                  <td>
                    <strong>{s.total}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small">
            При равных баллах: больше прогнозов, затем имя по алфавиту.
          </p>
        </>
      )}
    </section>
  );
}
export function RoundResults({
  result,
  scores,
  uid,
  screen = false,
  prediction,
}: {
  result: RoundResult;
  scores: Record<string, Score>;
  uid?: string;
  screen?: boolean;
  prediction?: Choice | null;
}) {
  const mine = uid ? scores[uid] : undefined;
  const answer =
    result.winner === "none"
      ? "В первом раунде нет голосов — баллы не начисляются."
      : result.winner === "tie"
        ? "Ничья! Оба прогноза верны. Каждый, кто сделал прогноз, получает +1."
        : `Большинство выбрало ${result.winner === "red" ? "красный" : "синий"} вариант.`;
  return (
    <div className={`round-outcome ${screen ? "projector-outcome" : ""}`}>
      <div>
        <div className="winner-message" role="status">
          {answer}
          <span>Угадали большинство: {result.awarded}</span>
        </div>
        <div className="dual-results">
          <Distribution
            counts={result.phase1}
            title="Раунд 1 · Личное мнение"
          />
          <Distribution counts={result.phase2} title="Раунд 2 · Прогнозы" />
        </div>
        {uid && (
          <div className="personal-score">
            {mine ? (
              <>
                <strong>+{mine.earned}</strong>
                <div>
                  {mine.earned
                    ? "Ты угадал большинство!"
                    : result.winner === "none"
                      ? "В первом раунде не было голосов."
                      : prediction
                        ? "Ты не угадал большинство."
                        : "Ты не отправил прогноз."}
                  <span>
                    Всего баллов: {mine.total} · Завершённых прогнозов:{" "}
                    {mine.completed}
                  </span>
                </div>
              </>
            ) : (
              <p>
                Ты присоединился после подсчёта. Первый прогноз — в следующем
                вопросе.
              </p>
            )}
          </div>
        )}
      </div>
      <Leaderboard scores={scores} uid={uid} limit={screen ? 10 : undefined} />
    </div>
  );
}
