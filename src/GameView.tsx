import { useCallback, useState } from "react";
import type { User } from "firebase/auth";
import { db, friendly } from "./firebase";
import { castVote, joinGame } from "./gameApi";
import { useValue, usePresence } from "./hooks";
import {
  label,
  votingPhase,
  type Choice,
  type State,
  type Participant,
  type RoundResult,
  type Score,
} from "./model";
import { JoinCode } from "./JoinCode";
import { RoundResults, Leaderboard } from "./Results";
export function Game({
  game,
  user,
  screen,
}: {
  game: string;
  user: User;
  screen: boolean;
}) {
  const valid = /^[A-Z2-9]{6}$/.test(game);
  const [code, setCode] = useState(game),
    [name, setName] = useState(""),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [pending, setPending] = useState<string | null>(null);
  const fail = useCallback((e: unknown) => setError(friendly(e)), []);
  const connection = useValue<boolean>(".info/connected");
  const state = useValue<State>(valid ? `games/${game}/state` : null);
  const profile = useValue<Participant>(
    valid && !screen ? `games/${game}/participants/${user.uid}` : null,
  );
  const joined = !!profile.value && !busy;
  usePresence(game, user.uid, joined && !screen, fail);
  const s = state.value,
    round = s?.roundId,
    modern = s?.schemaVersion === 2;
  const phase = s ? votingPhase(s) : "phase1";
  const phaseKey = `${round}/${phase}`;
  const own = useValue<Choice>(
    valid && joined && modern && round && round !== "none"
      ? `games/${game}/${phase}Votes/${round}/votes/${user.uid}`
      : null,
  );
  const revealed = s?.phase === "results_revealed";
  const summary = useValue<RoundResult>(
    valid && modern && revealed ? `games/${game}/roundResults/${round}` : null,
  );
  const scores = useValue<Record<string, Score>>(
    valid && modern && s.scoreVersion !== "none"
      ? `games/${game}/scores/${s.scoreVersion}`
      : null,
  );
  const presence = useValue<Record<string, Record<string, boolean>>>(
    valid && screen ? `games/${game}/presence` : null,
  );
  const tally = useValue<{ roundId: string; phase1: number; phase2: number }>(
    valid && screen && modern ? `games/${game}/tally` : null,
  );
  const online = connection.value === true;
  async function join() {
    setBusy(true);
    setError("");
    try {
      await joinGame(db, game, user.uid, name);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function vote(choice: Choice) {
    if (!round || pending || !online) return;
    setPending(phaseKey);
    setError("");
    try {
      await castVote(db, game, round, phase, user.uid, choice);
    } catch (e) {
      fail(e);
    } finally {
      setPending(null);
    }
  }
  const issue =
    error ||
    state.error ||
    profile.error ||
    own.error ||
    summary.error ||
    scores.error ||
    presence.error ||
    tally.error;
  if (!valid)
    return (
      <main className="join">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="dot" /> ИГРА, КОТОРАЯ ОБЪЕДИНЯЕТ
          </div>
          <h1>
            На чьей
            <br />
            <span className="red-text">ты</span>{" "}
            <span className="blue-text">стороне?</span>
          </h1>
          <p>
            Сначала выбери сам.
            <br />
            Потом угадай выбор команды.
          </p>
          <div className="duel" aria-hidden="true">
            <div>R</div>
            <i>VS</i>
            <div>B</div>
          </div>
        </div>
        <form
          className="card join-card"
          onSubmit={(e) => {
            e.preventDefault();
            location.hash = `/${screen ? "screen" : "play"}?game=${code.trim().toUpperCase()}`;
          }}
        >
          <span className="eyebrow">
            {screen ? "ЭКРАН СОБЫТИЯ" : "ПРИСОЕДИНИТЬСЯ"}
          </span>
          <h2>
            Все уже здесь.
            <br />
            Не хватает тебя.
          </h2>
          <label>
            Код игры
            <input
              autoComplete="off"
              placeholder="ABC234"
              maxLength={6}
              pattern="[A-Za-z2-9]{6}"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </label>
          <button className="primary">
            {screen ? "Открыть экран" : "Найти игру"} <span>→</span>
          </button>
          <p className="small">
            Код на экране у ведущего.
            <br />
            Или просто отсканируй QR-код.
          </p>
        </form>
      </main>
    );
  const isOpen = s?.phase === "phase1_open" || s?.phase === "phase2_open";
  const accepted = own.value && pending !== phaseKey;
  return (
    <main className="game-view">
      <div className="game-top">
        <span className="pill">ИГРА {game}</span>
        <span className={online ? "connection" : "offline"}>
          {online ? "● В сети" : "○ Восстанавливаем связь…"}
        </span>
      </div>
      {issue && (
        <div className="notice error" role="alert">
          {issue}
        </div>
      )}
      {!state.loaded ? (
        <h2>Загружаем игру…</h2>
      ) : !s ? (
        <div className="center">
          <h1>Игра не найдена</h1>
          <a href="#/play">Ввести другой код →</a>
        </div>
      ) : !modern ? (
        <div className="center">
          <h2>Игра готовится к новому формату</h2>
          <p>
            Ведущий должен обновить эту игру в своём пульте. Твой никнейм
            сохранён.
          </p>
        </div>
      ) : !screen && !profile.loaded ? (
        <p>Восстанавливаем участие…</p>
      ) : !screen && !joined && s.phase !== "finished" ? (
        s.phase === "phase2_closed" ? (
          <div className="center">
            <h2>Считаем результаты</h2>
            <p>Присоединиться можно после раскрытия результатов.</p>
          </div>
        ) : (
          <form
            className="card nickname"
            onSubmit={(e) => {
              e.preventDefault();
              void join();
            }}
          >
            <div className="eyebrow">ТВОЯ КОМАНДА ЖДЁТ</div>
            <h2>Как тебя зовут?</h2>
            <label>
              Имя или никнейм
              <input
                autoComplete="nickname"
                required
                minLength={1}
                maxLength={24}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Например, Саша"
              />
            </label>
            <button
              className="primary"
              disabled={busy || !online || !name.trim()}
            >
              {busy ? "Присоединяемся…" : "Я в игре →"}
            </button>
          </form>
        )
      ) : (
        <>
          <div className="eyebrow phase">
            {screen && s.phase === "phase1_open"
              ? "Раунд 1: Личное мнение"
              : label[s.phase]}
          </div>
          {s.phase === "waiting" ? (
            <div className="center">
              <div className="orbit">↔</div>
              <h1>
                Всё начинается
                <br />с одного выбора.
              </h1>
              <p>
                {screen
                  ? "Сканируйте код и присоединяйтесь к игре."
                  : `${profile.value?.name}, ты в игре. Ждём ведущего.`}
              </p>
              {screen && <JoinCode game={game} />}
            </div>
          ) : s.phase === "finished" ? (
            <div className="final-board">
              <h1>
                Разные ответы.
                <br />
                <span className="blue-text">Одна команда.</span>
              </h1>
              <Leaderboard
                scores={scores.value ?? {}}
                uid={screen ? undefined : user.uid}
                final
              />
              <a href="#/play">Присоединиться к другой игре →</a>
            </div>
          ) : (
            <section
              key={phaseKey}
              className={`round ${revealed ? "revealed-round" : ""}`}
            >
              <h1>{s.question?.text}</h1>
              {revealed ? (
                summary.value && scores.loaded && (screen || own.loaded) ? (
                  <>
                    <div className="answer-legend">
                      <span className="red-text">● {s.question?.red}</span>
                      <span className="blue-text">● {s.question?.blue}</span>
                    </div>
                    <RoundResults
                      result={summary.value}
                      scores={scores.value ?? {}}
                      uid={screen ? undefined : user.uid}
                      screen={screen}
                      prediction={own.value}
                    />
                  </>
                ) : (
                  <p>Загружаем итог и рейтинг…</p>
                )
              ) : (
                <>
                  <p className="phase-instruction">
                    {phase === "phase1"
                      ? "Выбери вариант, который нравится тебе больше"
                      : "Как ты думаешь, какой вариант выбрало большинство участников?"}
                  </p>
                  <div className="answers">
                    {(["red", "blue"] as Choice[]).map((c) => (
                      <button
                        key={c}
                        className={`answer ${c}`}
                        disabled={
                          screen ||
                          !online ||
                          !own.loaded ||
                          !!own.value ||
                          !!pending ||
                          !isOpen
                        }
                        onClick={() => void vote(c)}
                      >
                        <span className="answer-label">
                          {c === "red" ? "КРАСНЫЙ" : "СИНИЙ"}
                          <span>
                            {accepted && own.value === c
                              ? "✓"
                              : c === "red"
                                ? "01"
                                : "02"}
                          </span>
                        </span>
                        <strong>{s.question?.[c]}</strong>
                        <span className="answer-bottom">
                          {screen
                            ? "Твой выбор?"
                            : accepted && own.value === c
                              ? "Ответ сохранён"
                              : isOpen && !own.value
                                ? "Нажми, чтобы выбрать ↗"
                                : " "}
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="status" role="status">
                    {pending === phaseKey
                      ? "Отправляем ответ. Ждём подтверждения сервера…"
                      : accepted
                        ? phase === "phase1"
                          ? "Твой ответ принят! Ждём остальных участников."
                          : "Прогноз принят! Ждём результатов."
                        : !isOpen
                          ? phase === "phase1"
                            ? "Первый раунд закрыт. Скоро будем угадывать большинство."
                            : "Прогнозы закрыты. Ведущий готовит результаты."
                          : screen
                            ? "Выбирайте на своих телефонах"
                            : "Ответ изменить нельзя."}
                  </p>
                </>
              )}
            </section>
          )}
          {screen && s.phase !== "finished" && (
            <div className="screen-count">
              Участников в сети:{" "}
              {
                Object.values(presence.value ?? {}).filter((c) =>
                  Object.values(c).some(Boolean),
                ).length
              }{" "}
              · Ответов в {phase === "phase1" ? "первом" : "втором"} раунде:{" "}
              {tally.value?.roundId === round ? (tally.value?.[phase] ?? 0) : 0}
            </div>
          )}
        </>
      )}
    </main>
  );
}
