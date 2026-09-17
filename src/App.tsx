import { useEffect, useState, type FormEvent } from "react";
import {
  listContacts,
  loginAccount,
  pairApprove,
  pairJoin,
  pairPreview,
  pairReady,
  putContact,
  recoverAccount,
  registerAccount,
  type Session,
} from "./lib/client";
import { loadDevice, saveDevice } from "./lib/storage";
import type { Contact, DeviceState } from "./lib/types";

type Mode = "register" | "signin";
type Screen = "auth" | "phrase" | "pair" | "recover";

function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const text = raw.toLowerCase();
  if (text.includes("username taken")) {
    return "That name is taken.";
  }
  if (text.includes("invalid credentials") || text.includes("unauthorized")) {
    return "Wrong password.";
  }
  if (text.includes("rate limited")) {
    return "Too many tries. Wait a moment.";
  }
  if (text.includes("hasn't signed in") || text.includes("this browser")) {
    return "This browser isn’t signed in yet. Pair it, or use your recovery words.";
  }
  if (text.includes("expired") || text.includes("not found")) {
    return "That request expired. Start again.";
  }
  if (text.includes("phrase") || text.includes("unwrap") || text.includes("aead")) {
    return "Those words didn’t match.";
  }
  return "Something went wrong. Try again.";
}

const field =
  "mt-1.5 w-full rounded-lg border border-line bg-bg px-3 py-2.5 text-text outline-none placeholder:text-mute/70 focus:border-text/30";
const primary =
  "w-full rounded-lg bg-text py-2.5 text-sm font-medium text-bg disabled:opacity-50";
const ghost = "text-sm text-mute hover:text-text";

export default function App() {
  const initial = loadDevice();
  const [stored, setStored] = useState<DeviceState | null>(initial);
  const [mode, setMode] = useState<Mode>(initial ? "signin" : "register");
  const [switchAccount, setSwitchAccount] = useState(false);
  const [screen, setScreen] = useState<Screen>("auth");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pairId, setPairId] = useState("");
  const [pairConfirm, setPairConfirm] = useState("");
  const [pairState, setPairState] = useState<DeviceState | null>(null);
  const [pairApproved, setPairApproved] = useState(false);
  const [addCode, setAddCode] = useState("");
  const [addConfirm, setAddConfirm] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const locked = Boolean(stored) && !switchAccount;

  useEffect(() => {
    if (screen !== "pair" || !pairId || pairApproved) {
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const ready = await pairReady("", pairId);
        if (!cancelled && ready) {
          setPairApproved(true);
        }
      } catch (err) {
        const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
        if (!cancelled && msg.includes("expired")) {
          setError(friendlyError(err));
        }
      }
    };
    const id = window.setInterval(() => {
      void tick();
    }, 2000);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [screen, pairId, pairApproved]);

  async function openSession(next: Session) {
    saveDevice(next.state);
    setStored(next.state);
    setSwitchAccount(false);
    setSession(next);
    await refresh(next);
  }

  async function refresh(next: Session) {
    const listed = await listContacts(next);
    setContacts(listed.open);
  }

  function backToAuth() {
    setScreen("auth");
    setPairId("");
    setPairConfirm("");
    setPairState(null);
    setPairApproved(false);
    setPhrase("");
    setError(null);
    if (stored) {
      setSwitchAccount(false);
      setUsername(stored.username);
      setMode("signin");
    }
  }

  async function onUnlock(event: FormEvent) {
    event.preventDefault();
    if (!stored) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await openSession(await loginAccount(stored, password));
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onRegister(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { session: next, phrase: words } = await registerAccount(
        "",
        username.trim(),
        password,
      );
      saveDevice(next.state);
      setStored(next.state);
      setSwitchAccount(false);
      setSession(next);
      setPhrase(words);
      setScreen("phrase");
      await refresh(next);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onPairJoin(event: FormEvent) {
    event.preventDefault();
    if (!username.trim()) {
      setError("Enter your username first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const joined = await pairJoin("", username.trim());
      setPairId(joined.pairId);
      setPairConfirm(joined.confirm);
      setPairState(joined.state);
      setPairApproved(false);
      setPassword("");
      setScreen("pair");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onPairLogin(event: FormEvent) {
    event.preventDefault();
    if (!pairState) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await openSession(await loginAccount(pairState, password));
      setScreen("auth");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onRecover(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await openSession(
        await recoverAccount("", username.trim(), phrase.trim().toLowerCase(), password),
      );
      setScreen("auth");
      setPhrase("");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onAddDevice(event: FormEvent) {
    event.preventDefault();
    if (!session || !addCode.trim()) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!addConfirm) {
        const preview = await pairPreview(session, addCode.trim());
        setAddConfirm(preview.confirm);
        return;
      }
      await pairApprove(session, addCode.trim());
      setAddCode("");
      setAddConfirm(null);
      setAdding(false);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    if (!session || !name.trim()) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await putContact(session, name.trim(), email.trim() || undefined);
      setName("");
      setEmail("");
      await refresh(session);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  if (screen === "phrase" && session) {
    const words = phrase.split(/\s+/u).filter(Boolean);
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5">
        <h1 className="text-2xl font-semibold tracking-tight">Write these down</h1>
        <p className="mt-1 text-sm text-mute">They are shown once. You will need them on a new browser.</p>
        <ol className="mt-8 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          {words.map((word, index) => (
            <li key={`${index}-${word}`} className="flex gap-2 font-mono">
              <span className="w-5 text-right text-mute">{index + 1}</span>
              <span>{word}</span>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className={`${primary} mt-8`}
          onClick={() => {
            setPhrase("");
            setScreen("auth");
          }}
        >
          I’ve written them down
        </button>
      </main>
    );
  }

  if (screen === "pair") {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-5">
        <h1 className="text-2xl font-semibold tracking-tight">Pair this browser</h1>
        <p className="mt-1 text-sm text-mute">Confirm this matches the other screen.</p>
        <p className="mt-8 text-center font-mono text-3xl tracking-[0.35em]">{pairConfirm}</p>
        <p className="mt-8 text-sm text-mute">Type this on the signed-in device.</p>
        <p className="mt-2 break-all font-mono text-sm">{pairId}</p>
        {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
        {pairApproved ? (
          <form onSubmit={onPairLogin} className="mt-8">
            <p className="text-sm text-mute">Approved. Enter your password.</p>
            <label className="mt-4 block text-sm text-mute">
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className={field}
                required
              />
            </label>
            <button type="submit" disabled={busy} className={`${primary} mt-6`}>
              {busy ? "Please wait…" : "Continue"}
            </button>
          </form>
        ) : (
          <p className="mt-8 text-sm text-mute">Waiting for the other device…</p>
        )}
        <button type="button" className={`${ghost} mt-6`} onClick={backToAuth}>
          Cancel
        </button>
      </main>
    );
  }

  if (screen === "recover") {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-5">
        <h1 className="text-2xl font-semibold tracking-tight">Recovery words</h1>
        <p className="mt-1 text-sm text-mute">Use the 24 words from when you created the account.</p>
        <form onSubmit={onRecover} className="mt-8">
          <label className="block text-sm text-mute">
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className={field}
              required
            />
          </label>
          <label className="mt-4 block text-sm text-mute">
            Recovery words
            <textarea
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              rows={5}
              className={`${field} resize-none`}
              required
            />
          </label>
          <label className="mt-4 block text-sm text-mute">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className={field}
              required
            />
          </label>
          {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
          <button type="submit" disabled={busy} className={`${primary} mt-6`}>
            {busy ? "Please wait…" : "Continue"}
          </button>
          <button type="button" className={`${ghost} mt-4`} onClick={backToAuth}>
            Back
          </button>
        </form>
      </main>
    );
  }

  if (!session) {
    if (locked && stored) {
      return (
        <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-5">
          <h1 className="text-2xl font-semibold tracking-tight">Sealbook</h1>
          <p className="mt-1 text-sm text-mute">{stored.username}</p>
          <form onSubmit={onUnlock} className="mt-8">
            <label className="block text-sm text-mute">
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                autoFocus
                className={field}
                required
              />
            </label>
            {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
            <button type="submit" disabled={busy} className={`${primary} mt-6`}>
              {busy ? "Please wait…" : "Unlock"}
            </button>
          </form>
          <button
            type="button"
            className={`${ghost} mt-4`}
            onClick={() => {
              setSwitchAccount(true);
              setMode("signin");
              setUsername("");
              setPassword("");
              setError(null);
            }}
          >
            Sign in on this browser
          </button>
        </main>
      );
    }

    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-5">
        <h1 className="text-2xl font-semibold tracking-tight">Sealbook</h1>
        <p className="mt-1 text-sm text-mute">
          {mode === "signin" ? "Pair this browser with a signed-in device." : "Your private contacts."}
        </p>
        <div className="mt-8 mb-5 grid grid-cols-2 gap-1 rounded-lg bg-panel p-1 text-sm">
          <button
            type="button"
            onClick={() => {
              setMode("register");
              setError(null);
            }}
            className={`rounded-md py-1.5 ${mode === "register" ? "bg-bg text-text" : "text-mute"}`}
          >
            Create account
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("signin");
              setError(null);
            }}
            className={`rounded-md py-1.5 ${mode === "signin" ? "bg-bg text-text" : "text-mute"}`}
          >
            Sign in
          </button>
        </div>
        {mode === "register" ? (
          <form onSubmit={onRegister}>
            <label className="block text-sm text-mute">
              Username
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                className={field}
                required
              />
            </label>
            <label className="mt-4 block text-sm text-mute">
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className={field}
                required
              />
            </label>
            {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
            <button type="submit" disabled={busy} className={`${primary} mt-6`}>
              {busy ? "Please wait…" : "Continue"}
            </button>
          </form>
        ) : (
          <form onSubmit={onPairJoin}>
            <label className="block text-sm text-mute">
              Username
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                className={field}
                required
              />
            </label>
            {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
            <button type="submit" disabled={busy} className={`${primary} mt-6`}>
              {busy ? "Please wait…" : "Continue"}
            </button>
            <button
              type="button"
              className={`${ghost} mt-4`}
              onClick={() => {
                setScreen("recover");
                setError(null);
              }}
            >
              I have my recovery words
            </button>
          </form>
        )}
        {stored ? (
          <button
            type="button"
            className={`${ghost} mt-6`}
            onClick={() => {
              setSwitchAccount(false);
              setUsername(stored.username);
              setPassword("");
              setError(null);
            }}
          >
            Back to {stored.username}
          </button>
        ) : null}
      </main>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-lg items-center justify-between px-5 py-5">
        <div>
          <p className="font-semibold tracking-tight">Sealbook</p>
          <p className="text-sm text-mute">{session.state.username}</p>
        </div>
        <div className="flex gap-4">
          <button
            type="button"
            className={ghost}
            onClick={() => {
              setAdding((open) => !open);
              setAddConfirm(null);
              setError(null);
            }}
          >
            Add a device
          </button>
          <button
            type="button"
            className={ghost}
            onClick={() => {
              setSession(null);
              setContacts([]);
              setPassword("");
              setAdding(false);
              setAddConfirm(null);
              setSwitchAccount(false);
              setError(null);
            }}
          >
            Lock
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-5 pb-16">
        {adding ? (
          <form onSubmit={onAddDevice} className="mb-6 rounded-xl border border-line bg-panel p-4">
            <p className="text-sm text-mute">
              On the new browser, choose Sign in, then paste the code here.
            </p>
            <label className="mt-4 block text-sm text-mute">
              Code
              <input
                value={addCode}
                onChange={(e) => {
                  setAddCode(e.target.value);
                  setAddConfirm(null);
                }}
                className={field}
                required
              />
            </label>
            {addConfirm ? (
              <p className="mt-4 text-center font-mono text-3xl tracking-[0.35em]">{addConfirm}</p>
            ) : null}
            <button type="submit" disabled={busy} className={`${primary} mt-4`}>
              {busy ? "Please wait…" : addConfirm ? "Approve" : "Show confirm"}
            </button>
          </form>
        ) : null}
        <form onSubmit={onAdd} className="rounded-xl border border-line bg-panel p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              className={`${field} mt-0`}
              required
            />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className={`${field} mt-0`}
            />
            <button type="submit" disabled={busy} className={`${primary} sm:w-auto sm:px-5`}>
              Add
            </button>
          </div>
        </form>
        {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
        {contacts.length === 0 ? (
          <p className="mt-10 text-center text-sm text-mute">No contacts yet.</p>
        ) : (
          <ul className="mt-6 divide-y divide-line">
            {contacts.map((card) => (
              <li key={card.id} className="py-4">
                <p className="font-medium">{card.name}</p>
                {card.email ? <p className="mt-0.5 text-sm text-mute">{card.email}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
