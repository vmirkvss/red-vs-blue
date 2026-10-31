import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { ref, runTransaction, set } from "firebase/database";
import { auth, db, configured, identity, friendly } from "./firebase";
import { useValue } from "./hooks";
import { initial, samples } from "./model";
import { Game } from "./GameView";
import { Dashboard } from "./AdminDashboard";
import "./style.css";
function Logo() {
  return (
    <a href="#/play" className="logo">
      <span>RED</span>
      <i>vs</i>
      <span>BLUE</span>
    </a>
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
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
