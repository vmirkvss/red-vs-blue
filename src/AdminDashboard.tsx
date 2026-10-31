import { useEffect, useState } from "react";
import { ref, set, update } from "firebase/database";
import { db, friendly } from "./firebase";
import { useValue } from "./hooks";
import { transition, finalizeRound, resetGame, migrateGame } from "./gameApi";
import {
  label,
  distribution,
  type State,
  type Question,
  type Participant,
  type Score,
  type Counts,
  type RoundResult,
  type ScoringStatus,
} from "./model";
import { JoinCode } from "./JoinCode";
import { RoundResults, Leaderboard } from "./Results";
export function Dashboard({ game }: { game: string }) {
  const base = `games/${game}`;
  const state = useValue<State>(`${base}/state`),
    questions = useValue<Record<string, Question>>(`${base}/questions`),
    participants = useValue<Record<string, Participant>>(
      `${base}/participants`,
    ),
    presence = useValue<Record<string, Record<string, boolean>>>(
      `${base}/presence`,
    ),
    online = useValue<boolean>(".info/connected");
  const s = state.value,
    modern = s?.schemaVersion === 2;
  const one = useValue<Counts>(
      modern ? `${base}/phase1Votes/${s.roundId}/counts` : null,
    ),
    two = useValue<Counts>(
      modern ? `${base}/phase2Votes/${s.roundId}/counts` : null,
    );
  const used = useValue<Record<string, string>>(
    modern ? `${base}/usedQuestions` : null,
  );
  const scores = useValue<Record<string, Score>>(
    modern && s.scoreVersion !== "none"
      ? `${base}/scores/${s.scoreVersion}`
      : null,
  );
  const summary = useValue<RoundResult>(
    modern && s.phase === "results_revealed"
      ? `${base}/roundResults/${s.roundId}`
      : null,
  );
  const scoring = useValue<ScoringStatus>(
    modern && s.phase === "phase2_closed"
      ? `${base}/scoringStatus/${s.roundId}`
      : null,
  );
  const list = Object.values(questions.value ?? {}).sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  );
  const [selected, setSelected] = useState(""),
    [editing, setEditing] = useState<Question | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmReset, setConfirmReset] = useState(false),
    [confirmMigration, setConfirmMigration] = useState(false),
    [view, setView] = useState<"game" | "leaderboard">("game");
  const total1 = distribution(one.value ?? undefined).total,
    total2 = distribution(two.value ?? undefined).total;
  useEffect(() => {
    if (!modern || !one.loaded || !two.loaded || !online.value) return;
    const timer = setTimeout(() => {
      void set(ref(db, `${base}/tally`), {
        roundId: s.roundId,
        phase1: total1,
        phase2: total2,
      }).catch(() => {
        /* A vote may arrive between snapshot and write; the next count retries. */
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [
    base,
    modern,
    s?.roundId,
    total1,
    total2,
    one.loaded,
    two.loaded,
    online.value,
  ]);
  async function act(fn: () => Promise<unknown>) {
    if (!online.value) {
      setError("Нет подключения. Дождитесь восстановления связи.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }
  async function saveQuestion(q: Question) {
    await set(ref(db, `${base}/questions/${q.id}`), q);
    setEditing(null);
  }
  async function move(index: number, direction: number) {
    const reordered = [...list];
    [reordered[index], reordered[index + direction]] = [
      reordered[index + direction],
      reordered[index],
    ];
    await update(
      ref(db, `${base}/questions`),
      Object.fromEntries(reordered.map((q, i) => [`${q.id}/order`, i])),
    );
  }
  const issue =
    error ||
    state.error ||
    questions.error ||
    participants.error ||
    presence.error ||
    one.error ||
    two.error ||
    scores.error ||
    summary.error ||
    scoring.error ||
    used.error;
  if (!state.loaded) return <p>Загружаем пульт…</p>;
  if (!s)
    return (
      <div className="notice">
        {issue || "Игра не найдена."}
        <a href="#/admin"> К списку действий →</a>
      </div>
    );
  if (!modern)
    return (
      <section className="card">
        <h2>Обновить игру до двух раундов</h2>
        <p>
          Вопросы, код игры и никнеймы сохранятся. Старые голоса останутся в
          архиве и не принесут баллов. Незавершённый старый раунд остановится.
          Участники должны обновить страницу.
        </p>
        {confirmMigration ? (
          <div className="notice">
            <p>Начать новый формат с нулевым рейтингом?</p>
            <button
              disabled={busy}
              onClick={() => void act(() => migrateGame(db, game))}
            >
              Подтвердить обновление
            </button>{" "}
            <button onClick={() => setConfirmMigration(false)}>Отмена</button>
          </div>
        ) : (
          <button onClick={() => setConfirmMigration(true)}>
            Подготовить обновление
          </button>
        )}
        {issue && <p role="alert">{issue}</p>}
      </section>
    );
  const remaining = list.filter((q) => !used.value?.[q.id]);
  const chosen = remaining.find((q) => q.id === selected) || remaining[0];
  return (
    <>
      <div className="game-top">
        <span className="pill">ИГРА {game}</span>
        <span>{online.value ? "● Подключено" : "○ Нет связи"}</span>
        <a target="_blank" rel="noreferrer" href={`#/screen?game=${game}`}>
          Экран для проектора ↗
        </a>
        <a href="#/admin">Другая игра</a>
      </div>
      {issue && (
        <div role="alert" className="notice error">
          {issue}
        </div>
      )}
      <nav className="dashboard-tabs" aria-label="Разделы пульта">
        <button aria-pressed={view === "game"} onClick={() => setView("game")}>
          Игра
        </button>
        <button
          aria-pressed={view === "leaderboard"}
          onClick={() => setView("leaderboard")}
        >
          Рейтинг участников
        </button>
      </nav>
      <div className="stats four-stats">
        <div>
          <strong>{Object.keys(participants.value ?? {}).length}</strong>
          <span>Участников всего</span>
        </div>
        <div>
          <strong>
            {
              Object.values(presence.value ?? {}).filter((c) =>
                Object.values(c).some(Boolean),
              ).length
            }
          </strong>
          <span>Сейчас в сети</span>
        </div>
        <div>
          <strong>{total1}</strong>
          <span>Ответов · раунд 1</span>
        </div>
        <div>
          <strong>{total2}</strong>
          <span>Прогнозов · раунд 2</span>
        </div>
      </div>
      {view === "leaderboard" ? (
        <section className="card">
          <Leaderboard
            scores={scores.value ?? {}}
            final={s.phase === "finished"}
          />
        </section>
      ) : (
        <>
          <div className="dashboard-grid">
            <section className="card control">
              <div className="eyebrow">
                {label[s.phase]}
                {s.question
                  ? ` · Вопрос ${list.findIndex((q) => q.id === s.question?.id) + 1} из ${list.length}`
                  : ""}
              </div>
              <h2>{s.question?.text || "Пригласи команду. Начни разговор."}</h2>
              {(s.phase === "waiting" || s.phase === "results_revealed") &&
                (chosen ? (
                  <>
                    <label>
                      Следующий вопрос
                      <select
                        value={chosen.id}
                        onChange={(e) => setSelected(e.target.value)}
                      >
                        {remaining.map((q) => (
                          <option key={q.id} value={q.id}>
                            {q.order + 1}. {q.text}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="primary"
                      disabled={busy || !used.loaded || !online.value}
                      onClick={() =>
                        void act(() =>
                          transition(db, game, s, "phase1_open", chosen),
                        )
                      }
                    >
                      Начать раунд 1 →
                    </button>
                  </>
                ) : (
                  <p>
                    {list.length
                      ? "Все вопросы пройдены. Покажите финальный рейтинг."
                      : "Добавьте первый вопрос."}
                  </p>
                ))}
              {s.phase === "phase1_open" && (
                <button
                  className="primary"
                  disabled={busy || !online.value}
                  onClick={() =>
                    void act(() => transition(db, game, s, "phase1_closed"))
                  }
                >
                  Закрыть раунд 1
                </button>
              )}
              {s.phase === "phase1_closed" && (
                <button
                  className="primary"
                  disabled={busy || !online.value}
                  onClick={() =>
                    void act(() => transition(db, game, s, "phase2_open"))
                  }
                >
                  Начать раунд 2 · Угадай большинство →
                </button>
              )}
              {s.phase === "phase2_open" && (
                <button
                  className="primary"
                  disabled={busy || !online.value}
                  onClick={() =>
                    void act(() => transition(db, game, s, "phase2_closed"))
                  }
                >
                  Закрыть раунд 2
                </button>
              )}
              {s.phase === "phase2_closed" && (
                <>
                  <button
                    className="primary"
                    disabled={busy || !online.value}
                    onClick={() =>
                      void act(() => finalizeRound(db, game, s.roundId))
                    }
                  >
                    {busy
                      ? "Проверяем и начисляем баллы…"
                      : scoring.value
                        ? "Продолжить подсчёт и показать результаты"
                        : "Начислить баллы и показать результаты →"}
                  </button>
                  <p className="small" role="status">
                    Обработано участников: {scoring.value?.processed ?? 0} из{" "}
                    {Object.keys(participants.value ?? {}).length}. При потере
                    связи подсчёт можно продолжить.
                  </p>
                </>
              )}
              {s.phase === "finished" && (
                <Leaderboard scores={scores.value ?? {}} final />
              )}
              <div className="actions">
                {(s.phase === "waiting" || s.phase === "results_revealed") && (
                  <button
                    disabled={busy || !online.value}
                    onClick={() =>
                      void act(() => transition(db, game, s, "finished"))
                    }
                  >
                    Завершить игру · Финальный рейтинг
                  </button>
                )}
                {s.phase === "finished" && (
                  <button disabled={busy} onClick={() => setConfirmReset(true)}>
                    Начать заново / Сбросить баллы
                  </button>
                )}
              </div>
              {confirmReset && (
                <div className="notice">
                  <p>
                    Удалить голоса обоих раундов и весь рейтинг? Вопросы, код и
                    участники сохранятся.
                  </p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await resetGame(db, game);
                        setConfirmReset(false);
                      })
                    }
                  >
                    Да, сбросить игру и баллы
                  </button>{" "}
                  <button onClick={() => setConfirmReset(false)}>Отмена</button>
                </div>
              )}
            </section>
            <aside className="card">
              <div className="eyebrow">ПРИГЛАШАЙ КОМАНДУ</div>
              <JoinCode game={game} />
              <p className="small">
                Сначала личное мнение, затем прогноз большинства. За верный
                прогноз — один балл.
              </p>
              <button
                onClick={() =>
                  void act(() =>
                    navigator.clipboard.writeText(
                      `${location.origin}${location.pathname}#/play?game=${game}`,
                    ),
                  )
                }
              >
                Копировать ссылку ↗
              </button>
            </aside>
          </div>
          {s.phase === "results_revealed" && summary.value && scores.loaded && (
            <section className="card admin-results">
              <RoundResults
                result={summary.value}
                scores={scores.value ?? {}}
              />
            </section>
          )}
        </>
      )}
      <section className="card question-list">
        <div className="section-head">
          <div>
            <div className="eyebrow">СЦЕНАРИЙ ИГРЫ</div>
            <h2>
              Вопросы <span className="muted">/ {list.length}</span>
            </h2>
          </div>
          <button
            disabled={s.phase !== "waiting" || busy}
            onClick={() =>
              setEditing({
                id: crypto.randomUUID(),
                text: "",
                red: "",
                blue: "",
                order: Math.max(-1, ...list.map((q) => q.order)) + 1,
              })
            }
          >
            + Добавить вопрос
          </button>
        </div>
        {s.phase !== "waiting" && (
          <p className="small">
            Редактирование доступно до начала игры или после сброса.
          </p>
        )}
        {list.map((q, i) => (
          <div className="question-row" key={q.id}>
            <span className="number">{String(i + 1).padStart(2, "0")}</span>
            <div>
              <strong>{q.text}</strong>
              <p>
                <span className="red-text">● {q.red}</span>
                <span className="blue-text">● {q.blue}</span>
              </p>
            </div>
            <div className="row-actions">
              <button
                aria-label="Переместить вверх"
                disabled={s.phase !== "waiting" || busy || i === 0}
                onClick={() => void act(() => move(i, -1))}
              >
                ↑
              </button>
              <button
                aria-label="Переместить вниз"
                disabled={
                  s.phase !== "waiting" || busy || i === list.length - 1
                }
                onClick={() => void act(() => move(i, 1))}
              >
                ↓
              </button>
              <button
                disabled={s.phase !== "waiting" || busy}
                onClick={() => setEditing(q)}
              >
                Изменить
              </button>
              <button
                disabled={s.phase !== "waiting" || busy}
                onClick={() =>
                  void act(() =>
                    set(ref(db, `games/${game}/questions/${q.id}`), null),
                  )
                }
              >
                Удалить
              </button>
            </div>
          </div>
        ))}
        {!list.length && <p>Добавьте первый вопрос, чтобы начать игру.</p>}
      </section>
      {editing && (
        <div className="modal">
          <form
            className="card"
            onSubmit={(e) => {
              e.preventDefault();
              void act(() =>
                saveQuestion({
                  ...editing,
                  text: editing.text.trim(),
                  red: editing.red.trim(),
                  blue: editing.blue.trim(),
                }),
              );
            }}
          >
            <h2>Настроить вопрос</h2>
            {(["text", "red", "blue"] as const).map((field) => (
              <label key={field}>
                {field === "text"
                  ? "Вопрос"
                  : field === "red"
                    ? "Красный ответ"
                    : "Синий ответ"}
                <input
                  autoFocus={field === "text"}
                  required
                  maxLength={field === "text" ? 300 : 120}
                  value={editing[field]}
                  onChange={(e) =>
                    setEditing({ ...editing, [field]: e.target.value })
                  }
                />
              </label>
            ))}
            <button
              className="primary"
              disabled={
                busy ||
                !editing.text.trim() ||
                !editing.red.trim() ||
                !editing.blue.trim()
              }
            >
              Сохранить
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              Отмена
            </button>
            {error && <p role="alert">{error}</p>}
          </form>
        </div>
      )}
    </>
  );
}
