import { useEffect, useMemo, useState, type FormEvent } from "react";
import logo from "./assets/sealbook-white.png";
import { ContactCard } from "./components/ContactCard";
import { ContactForm } from "./components/ContactForm";
import { Modal } from "./components/Modal";
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
import { clearDevice, loadDevice, saveDevice } from "./lib/storage";
import { field, ghost, primary, searchField } from "./lib/styles";
import type { Contact, ContactDraft, DeviceState } from "./lib/types";

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
    return "This browser isn't signed in yet. Pair it, or use your recovery words.";
  }
  if (text.includes("expired") || text.includes("not found")) {
    return "That request expired. Start again.";
  }
  if (text.includes("phrase") || text.includes("unwrap") || text.includes("aead")) {
    return "Those words didn't match.";
  }
  return "Something went wrong. Try again.";
}

function Logo({ className }: { className: string }) {
  return <img src={logo} alt="" className={className} />;
}

function Brand({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3">
      <Logo className="h-12 w-12 shrink-0" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-0.5 text-sm text-mute">{subtitle}</p>
      </div>
    </div>
  );
}

function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-5">
      <div className="animate-fade-in-up rounded-2xl border border-line bg-panel/60 backdrop-blur-sm p-6 sm:p-8">
        {children}
      </div>
    </main>
  );
}

// Search icon
function SearchIcon() {
  return (
    <svg
      className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mute pointer-events-none"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// Plus icon for FAB
function PlusIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
      <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
    </svg>
  );
}

// Empty state illustration
function EmptyContacts({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 animate-fade-in-up">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-surface border border-line">
        <svg
          className="h-9 w-9 text-mute/50"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
        </svg>
      </div>
      <p className="mt-5 text-[15px] font-medium text-text">No contacts yet</p>
      <p className="mt-1 text-sm text-mute">
        Add your first contact to get started.
      </p>
      <button
        type="button"
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-bg transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
        onClick={onAdd}
      >
        <PlusIcon />
        Add contact
      </button>
    </div>
  );
}

export default function App() {
  const initial = loadDevice();
  const [stored, setStored] = useState<DeviceState | null>(initial);
  const [mode, setMode] = useState<Mode>(initial ? "signin" : "register");
  const [screen, setScreen] = useState<Screen>("auth");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [formKey, setFormKey] = useState(0);
  const [composing, setComposing] = useState(false);
  const [pairId, setPairId] = useState("");
  const [pairConfirm, setPairConfirm] = useState("");
  const [pairState, setPairState] = useState<DeviceState | null>(null);
  const [pairApproved, setPairApproved] = useState(false);
  const [addCode, setAddCode] = useState("");
  const [addConfirm, setAddConfirm] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");

  const locked = Boolean(stored);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return contacts;
    }
    return contacts.filter((contact) => {
      const haystack = [
        contact.name,
        contact.nickname,
        contact.email,
        ...contact.emails.map((e) => e.value),
        ...contact.phones.map((p) => p.value),
        ...contact.work.map((w) => `${w.organization} ${w.title ?? ""}`),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [contacts, search]);

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
      setUsername(stored.username);
    }
  }

  function signOut() {
    clearDevice();
    setStored(null);
    setSession(null);
    setContacts([]);
    setUsername("");
    setPassword("");
    setPhrase("");
    setPairId("");
    setPairConfirm("");
    setPairState(null);
    setPairApproved(false);
    setAdding(false);
    setAddConfirm(null);
    setAddCode("");
    setComposing(false);
    setError(null);
    setSearch("");
    setMode("register");
    setScreen("auth");
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

  async function onAdd(draft: ContactDraft) {
    if (!session || !draft.name.trim()) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await putContact(session, draft);
      setFormKey((key) => key + 1);
      setComposing(false);
      await refresh(session);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  function closeComposer() {
    if (busy) {
      return;
    }
    setComposing(false);
    setError(null);
    setFormKey((key) => key + 1);
  }

  // ---------- PHRASE SCREEN ----------
  if (screen === "phrase" && session) {
    const words = phrase.split(/\s+/u).filter(Boolean);
    return (
      <AuthCard>
        <Brand
          title="Write these down"
          subtitle="They are shown once. You will need them on a new browser."
        />
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
          I've written them down
        </button>
      </AuthCard>
    );
  }

  // ---------- PAIR SCREEN ----------
  if (screen === "pair") {
    return (
      <AuthCard>
        <Brand title="Pair this browser" subtitle="Confirm this matches the other screen." />
        <p className="mt-8 text-center font-mono text-3xl tracking-[0.35em]">{pairConfirm}</p>
        <p className="mt-8 text-sm text-mute">Type this on the signed-in device.</p>
        <p className="mt-2 break-all rounded-lg bg-bg/60 px-3 py-2 font-mono text-sm">{pairId}</p>
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
          <div className="mt-8 flex items-center gap-3 text-sm text-mute">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
            Waiting for the other device…
          </div>
        )}
        <button type="button" className={`${ghost} mt-6`} onClick={backToAuth}>
          Cancel
        </button>
      </AuthCard>
    );
  }

  // ---------- RECOVER SCREEN ----------
  if (screen === "recover") {
    return (
      <AuthCard>
        <Brand
          title="Recovery words"
          subtitle="Use the 24 words from when you created the account."
        />
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
      </AuthCard>
    );
  }

  // ---------- UNLOCK SCREEN ----------
  if (!session) {
    if (locked && stored) {
      return (
        <AuthCard>
          <Brand title="Sealbook" subtitle={stored.username} />
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
          <button type="button" className={`${ghost} mt-4`} onClick={signOut}>
            Sign out
          </button>
        </AuthCard>
      );
    }

    // ---------- REGISTER / SIGN IN SCREEN ----------
    return (
      <AuthCard>
        <Brand
          title="Sealbook"
          subtitle={
            mode === "signin" ? "Pair this browser with a signed-in device." : "Your private contacts."
          }
        />
        <div className="mt-8 mb-5 grid grid-cols-2 gap-1 rounded-lg bg-bg/60 p-1 text-sm">
          <button
            type="button"
            onClick={() => {
              setMode("register");
              setError(null);
            }}
            className={`rounded-md py-1.5 transition-colors duration-150 ${mode === "register" ? "bg-surface text-text" : "text-mute hover:text-text"}`}
          >
            Create account
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("signin");
              setError(null);
            }}
            className={`rounded-md py-1.5 transition-colors duration-150 ${mode === "signin" ? "bg-surface text-text" : "text-mute hover:text-text"}`}
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
      </AuthCard>
    );
  }

  // ---------- MAIN CONTACTS SCREEN ----------
  return (
    <div className="min-h-screen">
      {/* Sticky header with accent top line */}
      <div className="sticky top-0 z-40">
        <div className="h-[2px] bg-gradient-to-r from-accent/60 via-accent to-accent/60" />
        <header className="border-b border-line bg-bg/80 backdrop-blur-lg">
          <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4">
            <div className="flex items-center gap-2.5">
              <Logo className="h-8 w-8" />
              <div>
                <p className="font-semibold tracking-tight">Sealbook</p>
                <p className="text-xs text-mute">{session.state.username}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-sm text-mute transition-colors duration-150 hover:bg-surface hover:text-text"
                onClick={() => {
                  setAdding((open) => !open);
                  setAddConfirm(null);
                  setError(null);
                }}
              >
                Devices
              </button>
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-sm text-mute transition-colors duration-150 hover:bg-surface hover:text-text"
                onClick={() => {
                  setSession(null);
                  setContacts([]);
                  setPassword("");
                  setAdding(false);
                  setAddConfirm(null);
                  setComposing(false);
                  setError(null);
                  setSearch("");
                }}
              >
                Lock
              </button>
            </div>
          </div>
        </header>
      </div>

      <main className="mx-auto max-w-2xl px-5 pb-24 pt-6">
        {/* Add device panel */}
        {adding ? (
          <form
            onSubmit={onAddDevice}
            className="mb-6 animate-fade-in-up rounded-2xl border border-line bg-panel/80 backdrop-blur-sm p-5"
          >
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
              <p className="mt-4 text-center font-mono text-3xl tracking-[0.35em]">
                {addConfirm}
              </p>
            ) : null}
            <button type="submit" disabled={busy} className={`${primary} mt-4`}>
              {busy ? "Please wait…" : addConfirm ? "Approve" : "Show confirm"}
            </button>
          </form>
        ) : null}

        {/* Search + Add */}
        {contacts.length > 0 ? (
          <div className="mb-6 flex items-center gap-3 animate-fade-in-up">
            <div className="relative flex-1">
              <SearchIcon />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search contacts…"
                className={`${searchField} pl-10`}
              />
            </div>
            <button
              type="button"
              className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-accent text-bg transition-all duration-150 hover:brightness-110 active:scale-95"
              onClick={() => {
                setError(null);
                setComposing(true);
              }}
              aria-label="Add contact"
            >
              <PlusIcon />
            </button>
          </div>
        ) : null}

        {error && !composing ? (
          <p className="mt-4 text-sm text-danger">{error}</p>
        ) : null}

        {contacts.length === 0 ? (
          <EmptyContacts
            onAdd={() => {
              setError(null);
              setComposing(true);
            }}
          />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 animate-fade-in-up">
            <p className="text-sm text-mute">
              No contacts matching "{search}"
            </p>
          </div>
        ) : (
          <>
            <p className="mb-1 text-xs font-medium uppercase tracking-[0.14em] text-mute/60">
              {filtered.length} {filtered.length === 1 ? "contact" : "contacts"}
              {search.trim() ? ` found` : ""}
            </p>
            <ul className="divide-y divide-line">
              {filtered.map((card) => (
                <ContactCard key={card.id} contact={card} />
              ))}
            </ul>
          </>
        )}
      </main>

      {/* Compose modal */}
      {composing ? (
        <Modal title="New contact" onClose={closeComposer}>
          <ContactForm
            key={formKey}
            busy={busy}
            error={error}
            onSubmit={onAdd}
            onCancel={closeComposer}
          />
        </Modal>
      ) : null}
    </div>
  );
}
