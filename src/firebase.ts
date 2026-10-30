import { initializeApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  browserLocalPersistence,
  setPersistence,
  signInAnonymously,
} from "firebase/auth";
import {
  getDatabase,
  connectDatabaseEmulator,
  ref,
  runTransaction,
} from "firebase/database";
import type { Choice } from "./model";
const e = import.meta.env;
export let configured = !!(
  e.VITE_FIREBASE_API_KEY &&
  e.VITE_FIREBASE_AUTH_DOMAIN &&
  e.VITE_FIREBASE_DATABASE_URL &&
  e.VITE_FIREBASE_PROJECT_ID &&
  e.VITE_FIREBASE_APP_ID
);
export let auth: ReturnType<typeof getAuth> = null!;
export let db: ReturnType<typeof getDatabase> = null!;
if (configured) {
  try {
    const app = initializeApp({
      apiKey: e.VITE_FIREBASE_API_KEY,
      authDomain: e.VITE_FIREBASE_AUTH_DOMAIN,
      databaseURL: e.VITE_FIREBASE_DATABASE_URL,
      projectId: e.VITE_FIREBASE_PROJECT_ID,
      appId: e.VITE_FIREBASE_APP_ID,
    });
    auth = getAuth(app);
    db = getDatabase(app);
    if (import.meta.env.DEV && e.VITE_USE_EMULATORS === "true") {
      connectAuthEmulator(auth, "http://127.0.0.1:9099", {
        disableWarnings: true,
      });
      connectDatabaseEmulator(db, "127.0.0.1", 9000);
    }
  } catch {
    configured = false;
  }
}
let ready: Promise<unknown> | undefined;
export function identity() {
  return (ready ??= (async () => {
    await setPersistence(auth, browserLocalPersistence);
    await auth.authStateReady();
    if (!auth.currentUser) await signInAnonymously(auth);
  })().catch((error) => {
    ready = undefined;
    throw error;
  }));
}
export async function castVote(
  game: string,
  round: string,
  uid: string,
  choice: Choice,
) {
  const result = await runTransaction(
    ref(db, `games/${game}/votes/${round}/${uid}`),
    (value) => (value === null ? choice : undefined),
    { applyLocally: false },
  );
  if (!result.committed) throw new Error("duplicate");
}
export function friendly(error: unknown) {
  const code = String((error as { code?: string })?.code || error);
  if (/permission|PERMISSION/i.test(code))
    return "Действие недоступно. Возможно, голосование уже закрыто или у вас нет прав.";
  if (/duplicate/.test(code)) return "Ваш голос уже сохранён.";
  if (/auth\//.test(code))
    return "Не удалось войти. Проверьте данные, подключение и настройки авторизации.";
  return "Не удалось выполнить действие. Проверьте подключение и попробуйте снова.";
}
