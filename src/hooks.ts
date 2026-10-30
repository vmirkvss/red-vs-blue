import { useEffect, useState } from "react";
import {
  onValue,
  onDisconnect,
  push,
  ref,
  remove,
  set,
} from "firebase/database";
import { db, friendly } from "./firebase";
export function useValue<T>(path: string | null) {
  const [result, setResult] = useState<{
    path: string | null;
    value: T | null;
    loaded: boolean;
    error: string;
  }>({ path: null, value: null, loaded: false, error: "" });
  useEffect(() => {
    if (!path) return;
    return onValue(
      ref(db, path),
      (s) => setResult({ path, value: s.val(), loaded: true, error: "" }),
      (e) => setResult({ path, value: null, loaded: true, error: friendly(e) }),
    );
  }, [path]);
  return result.path === path
    ? result
    : { path, value: null, loaded: false, error: "" };
}
export function usePresence(
  game: string,
  uid: string,
  joined: boolean,
  onError: (e: unknown) => void,
) {
  useEffect(() => {
    if (!joined) return;
    let active = true;
    const connections: ReturnType<typeof ref>[] = [];
    const stop = onValue(ref(db, ".info/connected"), async (s) => {
      if (!s.val()) return;
      const connection = push(ref(db, `games/${game}/presence/${uid}`));
      connections.push(connection);
      try {
        await onDisconnect(connection).remove();
        if (active) await set(connection, true);
        if (!active) await remove(connection);
      } catch (e) {
        if (active) onError(e);
      }
    });
    return () => {
      active = false;
      stop();
      for (const c of connections) void remove(c).catch(() => {});
    };
  }, [game, uid, joined, onError]);
}
