import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { get, ref, runTransaction, set, update } from "firebase/database";
import { QRCodeSVG } from "qrcode.react";
import { auth, db, configured, identity, castVote, friendly } from "./firebase";
import { useValue, usePresence } from "./hooks";
import {
  results,
  canTransition,
  initial,
  samples,
  type Choice,
  type Question,
  type State,
  type Phase,
} from "./model";
import "./style.css";
const label: Record<Phase, string> = {
  waiting: "Собираемся вместе",
  question_open: "Голосование открыто",
  voting_closed: "Голоса приняты",
  results_revealed: "Вот что мы выбрали",
  finished: "Спасибо за игру!",
};
function Logo() {
  return (
    <a href="#/play" className="logo">
      <span>RED</span>
      <i>vs</i>
      <span>BLUE</span>
    </a>
  );
}
function Results({ votes }: { votes: Record<string, Choice> }) {
  const r = results(votes);
  return (
    <section className="results" aria-live="polite">
      <div className="result-head">
        <span>Наш общий выбор</span>
        <span>Голосов: {r.total}</span>
      </div>
      <div className="percent">
        <strong className="red-text">{r.redPercent}%</strong>
        <strong className="blue-text">{r.bluePercent}%</strong>
      </div>
      <div className="bar">
        <div className="red" style={{ width: `${r.redPercent}%` }} />
        <div className="blue" style={{ width: `${r.bluePercent}%` }} />
      </div>
      <div className="result-head">
        <span>Красный · {r.red}</span>
        <span>Синий · {r.blue}</span>
      </div>
      {!r.total && <p>В этом раунде никто не проголосовал.</p>}
    </section>
  );
}
function App() {
  const [hash, setHash] = useState(location.hash);
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const f = () => setHash(location.hash);
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  useEffect(() => {
    if (!configured) return;
    const off = onAuthStateChanged(auth, setUser);
    identity().catch((e) => setError(friendly(e)));
    return off;
  }, []);
  const [route, query = ""] = hash.slice(1).split("?");
  const game = (new URLSearchParams(query).get("game") || "").toUpperCase();
  return (
    <div className={route === "/screen" ? "app projector" : "app"}>
      <header>
        <Logo />
        <span className="event-label">ОДИН ВОПРОС. ДВА МНЕНИЯ.</span>
        {route !== "/screen" && (
          <a
            className="subtle"
            href={route === "/admin" ? "#/play" : "#/admin"}
          >
            {route === "/admin" ? "Участникам ↗" : "Ведущему ↗"}
          </a>
        )}
      </header>
      {!configured ? (
        <main className="center">
          <div className="eyebrow">ПОДГОТОВКА К ИГРЕ</div>
          <h1>
            Почти готовы
            <br />к первому выбору.
          </h1>
          <p>Подключите Firebase, чтобы участники играли вместе.</p>
          <div className="notice">
            Настройки подключения отсутствуют или некорректны. Заполните файл
            .env по примеру .env.example и перезапустите сборку. Пошаговая
            инструкция — в README.md.
          </div>
        </main>
      ) : error ? (
        <main className="center">
          <p role="alert">{error}</p>
          <button onClick={() => location.reload()}>
            Повторить подключение
          </button>
        </main>
      ) : !user ? (
        <main className="center">
          <p>Подключаемся…</p>
        </main>
      ) : route === "/admin" ? (
        <Admin user={user} game={game} />
      ) : (
        <Game
          key={`${route}-${game}`}
          game={game}
          user={user}
          screen={route === "/screen"}
        />
      )}
      <footer>
        РАЗНЫЕ МНЕНИЯ. ОДНА КОМАНДА.<span>RED vs BLUE · Живая игра</span>
      </footer>
    </div>
  );
}
function Game({
  game,
  user,
  screen,
}: {
  game: string;
  user: User;
  screen: boolean;
}) {
  const valid = /^[A-Z2-9]{6}$/.test(game);
  const [code, setCode] = useState(game);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const fail = useCallback((e: unknown) => setError(friendly(e)), []);
  const connection = useValue<boolean>(".info/connected");
  const state = useValue<State>(valid ? `games/${game}/state` : null);
  const profile = useValue<{ name: string }>(
    valid && !screen ? `games/${game}/participants/${user.uid}` : null,
  );
  const joined = !!profile.value;
  usePresence(game, user.uid, joined && !screen, fail);
  const s = state.value;
  const round = s?.roundId;
  const own = useValue<Choice>(
    valid && joined && round
      ? `games/${game}/votes/${round}/${user.uid}`
      : null,
  );
  const votes = useValue<Record<string, Choice>>(
    valid && s?.phase === "results_revealed"
      ? `games/${game}/votes/${round}`
      : null,
  );
  const presence = useValue<Record<string, Record<string, boolean>>>(
    valid && screen ? `games/${game}/presence` : null,
  );
  const tally = useValue<{ roundId: string; count: number }>(
    valid && screen ? `games/${game}/tally` : null,
  );
  const online = connection.value === true;
  async function join() {
    setBusy(true);
    setError("");
    try {
      await runTransaction(
        ref(db, `games/${game}/participants/${user.uid}`),
        (v) => v ?? { name: name.trim() },
        { applyLocally: false },
      );
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function vote(choice: Choice) {
    if (!round || pending || !online) return;
    setPending(round);
    setError("");
    try {
      await castVote(game, round, user.uid, choice);
    } catch (e) {
      fail(e);
    } finally {
      setPending(null);
    }
  }
  const problem =
    error ||
    state.error ||
    profile.error ||
    own.error ||
    votes.error ||
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
            Два варианта. Один выбор.
            <br />
            Узнай, что думает твоя команда.
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
  return (
    <main className="game-view">
      <div className="game-top">
        <span className="pill">ИГРА {game}</span>
        <span className={online ? "connection" : "offline"}>
          {online ? "● В сети" : "○ Восстанавливаем связь…"}
        </span>
      </div>
      {problem && (
        <div className="notice error" role="alert">
          {problem}
        </div>
      )}
      {!state.loaded ? (
        <h2>Загружаем игру…</h2>
      ) : !s ? (
        <div className="center">
          <h1>Игра не найдена</h1>
          <p>Проверь код у ведущего.</p>
          <a href="#/play">Ввести другой код →</a>
        </div>
      ) : !screen && !profile.loaded ? (
        <p>Восстанавливаем участие…</p>
      ) : !screen && !joined && s.phase !== "finished" ? (
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
      ) : (
        <>
          <div className="eyebrow phase">{label[s.phase]}</div>
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
            <div className="center">
              <h1>
                Разные ответы.
                <br />
                <span className="blue-text">Одна команда.</span>
              </h1>
              <p>Игра завершена. Спасибо за участие!</p>
              <a href="#/play">Присоединиться к другой игре →</a>
            </div>
          ) : (
            <section key={round} className="round">
              <h1>{s.question?.text}</h1>
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
                      s.phase !== "question_open"
                    }
                    onClick={() => void vote(c)}
                  >
                    <span className="answer-label">
                      {c === "red" ? "КРАСНЫЙ" : "СИНИЙ"}
                      <span>
                        {own.value === c && pending !== round
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
                        : own.value === c && pending !== round
                          ? "Твой голос сохранён"
                          : s.phase === "question_open" && !own.value
                            ? "Нажми, чтобы выбрать ↗"
                            : " "}
                    </span>
                  </button>
                ))}
              </div>
              {s.phase === "results_revealed" ? (
                votes.loaded && !votes.error ? (
                  <Results votes={votes.value || {}} />
                ) : (
                  <p>Загружаем результаты…</p>
                )
              ) : (
                <p className="status" role="status">
                  {pending === round
                    ? "Отправляем голос. Ждём подтверждения сервера…"
                    : own.value
                      ? "✓ Голос сохранён. Ждём результатов."
                      : s.phase === "voting_closed"
                        ? "Голосование закрыто. Ведущий скоро покажет результаты."
                        : screen
                          ? "Выбирайте на своих телефонах"
                          : "Доверься первому ощущению. Голос изменить нельзя."}
                </p>
              )}
            </section>
          )}
          {screen && (
            <div className="screen-count">
              Участников в сети:{" "}
              {
                Object.values(presence.value || {}).filter((c) =>
                  Object.values(c).some(Boolean),
                ).length
              }{" "}
              · Принято голосов:{" "}
              {tally.value?.roundId === round ? (tally.value?.count ?? 0) : 0}
            </div>
          )}
        </>
      )}
    </main>
  );
}
function JoinCode({ game }: { game: string }) {
  const url = `${location.origin}${location.pathname}#/play?game=${game}`;
  return (
    <div className="join-code">
      <div className="qr">
        <QRCodeSVG value={url} size={136} title="QR-код для входа в игру" />
      </div>
      <div>
        <span className="eyebrow">КОД ИГРЫ</span>
        <strong>{game}</strong>
        <a href={url}>Присоединиться ↗</a>
      </div>
    </div>
  );
}
function Admin({ user, game }: { user: User; game: string }) {
  const access = useValue<boolean>(`admins/${user.uid}`);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function act(fn: () => Promise<unknown>) {
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
  async function create() {
    for (let i = 0; i < 5; i++) {
      const bytes = crypto.getRandomValues(new Uint8Array(6));
      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const id = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join(
        "",
      );
      const r = await runTransaction(
        ref(db, `games/${id}/state`),
        (v) => (v ? undefined : initial),
        { applyLocally: false },
      );
      if (r.committed) {
        await set(
          ref(db, `games/${id}/questions`),
          Object.fromEntries(samples.map((q) => [q.id, q])),
        );
        location.hash = `/admin?game=${id}`;
        return;
      }
    }
    throw new Error("collision");
  }
  if (user.isAnonymous || access.value !== true)
    return (
      <main className="center">
        <form
          className="card login"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => signInWithEmailAndPassword(auth, email, password));
          }}
        >
          <span className="eyebrow">ЗА КУЛИСАМИ</span>
          <h1>Пульт ведущего</h1>
          {!user.isAnonymous && access.loaded && (
            <div className="notice">
              Этот аккаунт не включён в список администраторов. Добавьте UID в
              Firebase Console: <code>{user.uid}</code>
            </div>
          )}
          <label>
            Электронная почта
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Пароль
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Входим…" : "Войти →"}
          </button>
          {(error || access.error) && (
            <p role="alert">{error || access.error}</p>
          )}
        </form>
      </main>
    );
  return (
    <main className="admin">
      <div className="dashboard-heading">
        <div>
          <div className="eyebrow">УПРАВЛЯЙ МОМЕНТОМ</div>
          <h1>Пульт ведущего</h1>
        </div>
        <button
          onClick={() =>
            void act(async () => {
              await signOut(auth);
              await identityAfterLogout();
            })
          }
        >
          Выйти
        </button>
      </div>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      {!/^[A-Z2-9]{6}$/.test(game) ? (
        <div className="admin-start card">
          <h2>Начнём новую историю?</h2>
          <p>Создай игру, пригласи команду и задай первый вопрос.</p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void act(create)}
          >
            Создать игру +
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              location.hash = `/admin?game=${code.toUpperCase()}`;
            }}
          >
            <label>
              Или открой существующую игру
              <input
                value={code}
                maxLength={6}
                pattern="[A-Za-z2-9]{6}"
                required
                onChange={(e) => setCode(e.target.value)}
                placeholder="Код игры"
              />
            </label>
            <button>Открыть →</button>
          </form>
        </div>
      ) : (
        <Dashboard key={game} game={game} />
      )}
    </main>
  );
}
async function identityAfterLogout() {
  location.reload();
}
function Dashboard({ game }: { game: string }) {
  const state = useValue<State>(`games/${game}/state`);
  const questions = useValue<Record<string, Question>>(
    `games/${game}/questions`,
  );
  const participants = useValue<Record<string, { name: string }>>(
    `games/${game}/participants`,
  );
  const presence = useValue<Record<string, Record<string, boolean>>>(
    `games/${game}/presence`,
  );
  const online = useValue<boolean>(".info/connected");
  const s = state.value;
  const votes = useValue<Record<string, Choice>>(
    s ? `games/${game}/votes/${s.roundId}` : null,
  );
  const list = Object.values(questions.value || {}).sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  );
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState<Question | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const total = results(votes.value || {}).total;
  useEffect(() => {
    if (!s || !votes.loaded) return;
    const timer = setTimeout(() => {
      void set(ref(db, `games/${game}/tally`), {
        roundId: s.roundId,
        count: total,
      }).catch((e) => setError(friendly(e)));
    }, 200);
    return () => clearTimeout(timer);
  }, [game, s?.roundId, total, votes.loaded]);
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
  async function transition(phase: Phase, question?: Question) {
    if (!s) return;
    const expected = s;
    const result = await runTransaction(
      ref(db, `games/${game}/state`),
      (current) => {
        if (
          !current ||
          current.phase !== expected.phase ||
          current.roundId !== expected.roundId ||
          !canTransition(current.phase, phase)
        )
          return;
        if (phase === "question_open") {
          if (!question) return;
          return { phase, roundId: crypto.randomUUID(), question };
        }
        return { ...current, phase };
      },
      { applyLocally: false },
    );
    if (!result.committed) throw new Error("state changed");
  }
  async function saveQuestion(q: Question) {
    await set(ref(db, `games/${game}/questions/${q.id}`), q);
    setEditing(null);
  }
  async function move(index: number, direction: number) {
    const reordered = [...list];
    [reordered[index], reordered[index + direction]] = [
      reordered[index + direction],
      reordered[index],
    ];
    await update(
      ref(db, `games/${game}/questions`),
      Object.fromEntries(reordered.map((q, i) => [`${q.id}/order`, i])),
    );
  }
  const issue =
    error ||
    state.error ||
    questions.error ||
    participants.error ||
    presence.error ||
    votes.error;
  if (!state.loaded) return <p>Загружаем пульт…</p>;
  if (!s)
    return (
      <div className="notice">
        {issue || "Игра не найдена."}
        <a href="#/admin"> К списку действий →</a>
      </div>
    );
  const chosen =
    list.find((q) => q.id === selected) ||
    list.find((q) => q.order > (s.question?.order ?? -1)) ||
    list[0];
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
      <div className="stats">
        <div>
          <strong>{Object.keys(participants.value || {}).length}</strong>
          <span>Участников всего</span>
        </div>
        <div>
          <strong>
            {
              Object.values(presence.value || {}).filter((c) =>
                Object.values(c).some(Boolean),
              ).length
            }
          </strong>
          <span>Сейчас в сети</span>
        </div>
        <div>
          <strong>{total}</strong>
          <span>Голосов в раунде</span>
        </div>
      </div>
      <div className="dashboard-grid">
        <section className="card control">
          <div className="eyebrow">{label[s.phase]}</div>
          <h2>{s.question?.text || "Пригласи команду. Начни разговор."}</h2>
          {(s.phase === "waiting" || s.phase === "results_revealed") && (
            <>
              <label>
                Следующий вопрос
                <select
                  value={chosen?.id || ""}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {!list.length && <option value="">Добавьте вопрос</option>}
                  {list.map((q, i) => (
                    <option key={q.id} value={q.id}>
                      {i + 1}. {q.text}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary"
                disabled={busy || !chosen || !online.value}
                onClick={() =>
                  void act(() => transition("question_open", chosen))
                }
              >
                {s.phase === "waiting"
                  ? "Начать голосование"
                  : "Открыть следующий вопрос"}{" "}
                →
              </button>
            </>
          )}
          {s.phase === "question_open" && (
            <button
              className="primary"
              disabled={busy || !online.value}
              onClick={() => void act(() => transition("voting_closed"))}
            >
              Закрыть голосование
            </button>
          )}
          {s.phase === "voting_closed" && (
            <button
              className="primary"
              disabled={busy || !online.value}
              onClick={() => void act(() => transition("results_revealed"))}
            >
              Показать результаты →
            </button>
          )}
          {s.phase === "results_revealed" && votes.loaded && (
            <Results votes={votes.value || {}} />
          )}
          <div className="actions">
            {s.phase !== "finished" && (
              <button
                disabled={busy || !online.value}
                onClick={() => void act(() => transition("finished"))}
              >
                Завершить игру
              </button>
            )}
            {s.phase === "finished" && (
              <button disabled={busy} onClick={() => setConfirmReset(true)}>
                Сбросить игру
              </button>
            )}
          </div>
          {confirmReset && (
            <div className="notice">
              <p>
                Удалить все голоса и вернуться к ожиданию? Вопросы и участники
                останутся.
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await update(ref(db, `games/${game}`), {
                      state: initial,
                      votes: null,
                      tally: null,
                    });
                    setConfirmReset(false);
                  })
                }
              >
                Да, очистить голоса
              </button>{" "}
              <button onClick={() => setConfirmReset(false)}>Отмена</button>
            </div>
          )}
        </section>
        <aside className="card">
          <div className="eyebrow">ПРИГЛАШАЙ КОМАНДУ</div>
          <JoinCode game={game} />
          <p className="small">
            Покажи QR-код на большом экране или отправь ссылку участникам.
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
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
