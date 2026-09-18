import { useEffect, useMemo, useState, type FormEvent } from "react";
import logo from "./assets/sealbook-white.png";
import { AddressBookMenu } from "./components/AddressBookMenu";
import { AddDeviceModal } from "./components/AddDeviceModal";
import { ContactCard } from "./components/ContactCard";
import { ContactDetailModal } from "./components/ContactDetailModal";
import { ContactForm } from "./components/ContactForm";
import { Modal } from "./components/Modal";
import {
  ensureDefaultAddressBook,
  listVault,
  loginAccount,
  pairApprove,
  pairJoin,
  pairPreview,
  pairReady,
  putAddressBook,
  putContact,
  recoverAccount,
  registerAccount,
  type Session,
} from "./lib/client";
import {
  ALL_ADDRESS_BOOKS,
  DEFAULT_ADDRESS_BOOK_ID,
  bookNameById,
  resolveAddressBookId,
} from "./lib/addressBook";
import { emptyDraft } from "./lib/contact";
import { clearDevice, loadDevice, saveDevice } from "./lib/storage";
import { field, ghost, primary, secondary, searchField } from "./lib/styles";
import type { AddressBook, Contact, ContactDraft, DeviceState } from "./lib/types";

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
    <main className="mx-auto flex min-h-screen max-w-[500px] flex-col justify-center px-5 py-8">
      <div className="animate-fade-in-up rounded-2xl border border-line bg-panel/75 backdrop-blur-md p-7 sm:p-9 shadow-2xl shadow-black/40">
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

function DevicePlusIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 text-accent"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
      <path d="M7 3.5A1.5 1.5 0 0 1 8.5 2h3.879a1.5 1.5 0 0 1 1.06.44l3.122 3.12A1.5 1.5 0 0 1 17 6.622V12.5a1.5 1.5 0 0 1-1.5 1.5h-1v-3.379a3 3 0 0 0-.879-2.121L10.5 5.379A3 3 0 0 0 8.378 6H4.5Z" />
      <path d="M4.5 6A1.5 1.5 0 0 0 3 7.5v9A1.5 1.5 0 0 0 4.5 18h7a1.5 1.5 0 0 0 1.5-1.5v-5.879a1.5 1.5 0 0 0-.44-1.06L9.44 6.439A1.5 1.5 0 0 0 8.378 6H4.5Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// Empty state illustration
function EmptyContacts({
  onAdd,
  bookName,
}: {
  onAdd: () => void;
  bookName?: string;
}) {
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
      <p className="mt-5 text-[15px] font-medium text-text">
        {bookName ? `No contacts in ${bookName}` : "No contacts yet"}
      </p>
      <p className="mt-1 text-sm text-mute">
        {bookName
          ? "Add a contact to this address book."
          : "Add your first contact to get started."}
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
  const [addressBooks, setAddressBooks] = useState<AddressBook[]>([]);
  const [bookFilter, setBookFilter] = useState(ALL_ADDRESS_BOOKS);
  const [formKey, setFormKey] = useState(0);
  const [composing, setComposing] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [viewingContact, setViewingContact] = useState<Contact | null>(null);
  const [pairId, setPairId] = useState("");
  const [pairConfirm, setPairConfirm] = useState("");
  const [pairState, setPairState] = useState<DeviceState | null>(null);
  const [pairApproved, setPairApproved] = useState(false);
  const [addCode, setAddCode] = useState("");
  const [addConfirm, setAddConfirm] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [search, setSearch] = useState("");

  const locked = Boolean(stored);

  const filtered = useMemo(() => {
    const inBook =
      bookFilter === ALL_ADDRESS_BOOKS
        ? contacts
        : contacts.filter(
            (contact) => resolveAddressBookId(contact.addressBookId) === bookFilter,
          );
    const query = search.trim().toLowerCase();
    if (!query) {
      return inBook;
    }
    return inBook.filter((contact) => {
      const haystack = [
        contact.name,
        contact.nickname,
        contact.email,
        ...contact.emails.map((e) => e.value),
        ...contact.phones.map((p) => p.value),
        ...contact.work.map((w) => `${w.organization} ${w.title ?? ""}`),
        bookNameById(addressBooks, contact.addressBookId),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [addressBooks, bookFilter, contacts, search]);

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
    const listed = await listVault(next);
    const books = await ensureDefaultAddressBook(next, listed.addressBooks);
    setAddressBooks(books);
    setContacts(listed.contacts);
    setBookFilter((current) => {
      if (current === ALL_ADDRESS_BOOKS) {
        return current;
      }
      return books.some((book) => book.id === current) ? current : ALL_ADDRESS_BOOKS;
    });
  }

  function backToAuth() {
    setScreen("auth");
    setPairId("");
    setPairConfirm("");
    setPairState(null);
    setPairApproved(false);
    setCopied(false);
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
    setAddressBooks([]);
    setBookFilter(ALL_ADDRESS_BOOKS);
    setUsername("");
    setPassword("");
    setPhrase("");
    setPairId("");
    setPairConfirm("");
    setPairState(null);
    setPairApproved(false);
    setCopied(false);
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
    const words = phrase.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length !== 24) {
      setError(`Please enter all 24 words (${words.length} entered so far).`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await openSession(
        await recoverAccount("", username.trim(), words.join(" "), password),
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

  async function onEditContact(draft: ContactDraft) {
    if (!session || !editingContact || !draft.name.trim()) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await putContact(session, draft, editingContact.id);
      setEditingContact(null);
      setViewingContact(null);
      await refresh(session);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  function startEditing(contact: Contact) {
    setError(null);
    setViewingContact(null);
    setEditingContact(contact);
  }

  function closeEditor() {
    if (busy) {
      return;
    }
    setEditingContact(null);
    setError(null);
  }

  async function onCreateBook(name: string) {
    if (!session || !name.trim()) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = await putAddressBook(session, name.trim());
      await refresh(session);
      setBookFilter(id);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  function openComposer() {
    setError(null);
    setFormKey((key) => key + 1);
    setComposing(true);
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

    function downloadWords() {
      const lines = words.map((w, i) => `${String(i + 1).padStart(2, " ")}. ${w}`);
      const text = "Sealbook Recovery Words\n" + "=".repeat(24) + "\n\n" + lines.join("\n") + "\n\nKeep this file safe and secret.\n";
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "sealbook-recovery-words.txt";
      a.click();
      URL.revokeObjectURL(url);
    }

    function printWords() {
      const lines = words.map((w, i) => `<tr><td style="text-align:right;padding-right:12px;color:#888;font-variant-numeric:tabular-nums">${i + 1}</td><td style="font-family:monospace">${w}</td></tr>`);
      const html = `
        <html>
          <head><title>Sealbook Recovery Words</title></head>
          <body style="font-family:system-ui,sans-serif;padding:40px;max-width:480px;margin:0 auto">
            <h2 style="margin:0 0 4px">Sealbook Recovery Words</h2>
            <p style="color:#666;margin:0 0 24px;font-size:14px">Keep this document safe and secret.</p>
            <table style="border-collapse:collapse;font-size:15px">${lines.join("")}</table>
          </body>
        </html>`;
      const win = window.open("", "_blank");
      if (win) {
        win.document.write(html);
        win.document.close();
        win.focus();
        win.print();
      }
    }

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
        <div className="mt-6 flex gap-3">
          <button type="button" className={secondary} onClick={downloadWords}>
            ⬇ Download
          </button>
          <button type="button" className={secondary} onClick={printWords}>
            🖨 Print
          </button>
        </div>
        <button
          type="button"
          className={`${primary} mt-4`}
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
        <Brand
          title="Pair this device"
          subtitle="Connect with an active device to transfer encryption keys."
        />

        <div className="mt-7 space-y-4">
          {/* Step 1 */}
          <div className="rounded-xl border border-line bg-surface/30 p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent font-semibold text-xs mt-0.5">
                1
              </span>
              <div>
                <p className="text-sm font-semibold text-text">Open your signed-in device</p>
                <p className="mt-1 text-sm text-mute leading-relaxed">
                  On your phone, laptop, or browser where Sealbook is open, click <strong className="text-text font-semibold">Add device</strong> at the top.
                </p>
              </div>
            </div>
          </div>

          {/* Step 2: Pairing ID */}
          <div className="rounded-xl border border-line bg-surface/30 p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent font-semibold text-xs mt-0.5">
                2
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-text">Enter this pairing code</p>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(pairId);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-accent transition-colors hover:border-line-light cursor-pointer"
                  >
                    {copied ? (
                      <>
                        <CheckIcon />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <CopyIcon />
                        <span>Copy code</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="mt-2.5 break-all select-all rounded-lg border border-line bg-bg/90 px-3.5 py-2.5 font-mono text-xs text-accent">
                  {pairId}
                </p>
              </div>
            </div>
          </div>

          {/* Step 3: Confirmation Code */}
          <div className="rounded-xl border border-line bg-surface/30 p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent font-semibold text-xs mt-0.5">
                3
              </span>
              <div className="flex-1 min-w-0 text-center">
                <p className="text-sm font-semibold text-text text-left">Verify confirmation code</p>
                <p className="mt-1 text-sm text-mute text-left leading-relaxed">
                  Both devices must display this exact confirmation number:
                </p>
                <div className="my-3 rounded-xl border border-accent/25 bg-bg/90 py-3">
                  <p className="font-mono text-3xl font-bold tracking-[0.35em] text-accent">
                    {pairConfirm}
                  </p>
                </div>
                <p className="text-xs text-mute">
                  Check that your other device displays this code, then approve it there.
                </p>
              </div>
            </div>
          </div>
        </div>

        {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}

        {/* Step 4: Live status / Password completion */}
        {pairApproved ? (
          <form onSubmit={onPairLogin} className="mt-6 animate-fade-in-up">
            <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-300">
              <svg className="h-4 w-4 shrink-0 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
                  clipRule="evenodd"
                />
              </svg>
              <span>Pairing approved! Enter your password to finish unlocking your vault.</span>
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium text-text mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Enter your password"
                autoFocus
                className="box-border w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 text-sm text-text outline-none transition-all placeholder:text-mute/50 focus:border-accent-dim focus:ring-1 focus:ring-accent-ring"
                required
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="mt-5 w-full rounded-xl bg-accent py-3 text-sm font-semibold text-bg transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-50 cursor-pointer"
            >
              {busy ? "Unlocking vault…" : "Finish device setup"}
            </button>
          </form>
        ) : (
          <div className="mt-6 flex items-center justify-center gap-3 rounded-xl border border-line bg-surface/20 py-3.5 text-sm text-mute">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
            <span>Waiting for approval on your other device…</span>
          </div>
        )}

        <div className="mt-7 flex items-center justify-between border-t border-line pt-4 text-xs text-mute">
          <button type="button" className={ghost} onClick={backToAuth}>
            Cancel
          </button>
          <button
            type="button"
            className={ghost}
            onClick={() => {
              setScreen("recover");
              setError(null);
            }}
          >
            Use recovery words instead
          </button>
        </div>
      </AuthCard>
    );
  }

  // ---------- RECOVER SCREEN ----------
  if (screen === "recover") {
    const enteredWords = phrase.trim().split(/\s+/).filter(Boolean);
    const count = enteredWords.length;

    async function handlePastePhrase() {
      try {
        const text = await navigator.clipboard.readText();
        if (text.trim()) {
          setPhrase(text.trim());
        }
      } catch {
        // clipboard access not permitted
      }
    }

    return (
      <AuthCard>
        <Brand
          title="Restore with words"
          subtitle="Set up this device using your 24 secret recovery words."
        />
        <form onSubmit={onRecover} className="mt-7 space-y-4">
          <div>
            <label htmlFor="recover-username" className="block text-sm font-medium text-text mb-1.5">
              Username
            </label>
            <input
              id="recover-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="Enter your username"
              className="box-border w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 text-sm text-text outline-none transition-all placeholder:text-mute/50 focus:border-accent-dim focus:ring-1 focus:ring-accent-ring"
              required
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="recovery-phrase" className="text-sm font-medium text-text">
                Recovery words
              </label>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-xs ${
                    count === 24
                      ? "text-accent font-semibold border-accent/30"
                      : count > 24
                      ? "text-danger border-danger/30"
                      : "text-mute"
                  }`}
                >
                  {count} / 24 words
                </span>
                <button
                  type="button"
                  onClick={handlePastePhrase}
                  className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2.5 py-0.5 text-xs font-medium text-accent hover:border-line-light hover:text-accent-dim transition-colors cursor-pointer"
                >
                  <CopyIcon />
                  <span>Paste</span>
                </button>
              </div>
            </div>
            <textarea
              id="recovery-phrase"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="Paste or type all 24 words separated by spaces…"
              rows={4}
              className="box-border w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 font-mono text-sm leading-relaxed text-text outline-none transition-all placeholder:text-mute/50 focus:border-accent-dim focus:ring-1 focus:ring-accent-ring resize-none"
              required
            />
          </div>

          <div>
            <label htmlFor="recover-password" className="block text-sm font-medium text-text mb-1.5">
              Password
            </label>
            <input
              id="recover-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Enter your password"
              className="box-border w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 text-sm text-text outline-none transition-all placeholder:text-mute/50 focus:border-accent-dim focus:ring-1 focus:ring-accent-ring"
              required
            />
          </div>

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <button
            type="submit"
            disabled={busy}
            className="mt-6 w-full rounded-xl bg-accent py-3 text-sm font-semibold text-bg transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-50 cursor-pointer"
          >
            {busy ? "Restoring vault…" : "Restore vault on this device"}
          </button>

          <button
            type="button"
            className="mt-3 w-full py-2 text-center text-sm text-mute transition-colors hover:text-text cursor-pointer"
            onClick={backToAuth}
          >
            Back to setup options
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
            mode === "signin"
              ? "Set up this device with your existing account."
              : "Your private, end-to-end encrypted contacts."
          }
        />
        <div className="mt-8 mb-5 grid grid-cols-2 gap-1 rounded-lg bg-bg/60 p-1 text-sm">
          <button
            type="button"
            onClick={() => {
              setMode("register");
              setError(null);
            }}
            className={`rounded-md py-1.5 transition-colors duration-150 cursor-pointer ${
              mode === "register" ? "bg-surface text-text font-medium" : "text-mute hover:text-text"
            }`}
          >
            Create account
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("signin");
              setError(null);
            }}
            className={`rounded-md py-1.5 transition-colors duration-150 cursor-pointer ${
              mode === "signin" ? "bg-surface text-text font-medium" : "text-mute hover:text-text"
            }`}
          >
            Set up device
          </button>
        </div>
        {mode === "register" ? (
          <form onSubmit={onRegister} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text mb-1.5">
                Username
              </label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                placeholder="Choose a username"
                className="box-border w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 text-sm text-text outline-none transition-all placeholder:text-mute/50 focus:border-accent-dim focus:ring-1 focus:ring-accent-ring"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Choose a password"
                className="box-border w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 text-sm text-text outline-none transition-all placeholder:text-mute/50 focus:border-accent-dim focus:ring-1 focus:ring-accent-ring"
                required
              />
            </div>
            {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
            <button
              type="submit"
              disabled={busy}
              className="mt-6 w-full rounded-xl bg-accent py-3 text-sm font-semibold text-bg transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-50 cursor-pointer"
            >
              {busy ? "Creating account…" : "Create account"}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            {/* Method 1: Pair with active device */}
            <form
              onSubmit={onPairJoin}
              className="rounded-xl border border-line bg-surface/30 p-5 transition-colors hover:border-line-light"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent font-semibold text-xs mt-0.5">
                  1
                </span>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-text">Pair with an active device</h3>
                  <p className="mt-1 text-xs text-mute leading-relaxed">
                    Recommended if Sealbook is already signed in on your phone, laptop, or tablet.
                  </p>

                  <div className="mt-3.5">
                    <label className="block text-xs font-medium text-text mb-1.5">
                      Username
                    </label>
                    <input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="username"
                      placeholder="Enter your username"
                      className="box-border w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-text outline-none transition-all placeholder:text-mute/50 focus:border-accent-dim focus:ring-1 focus:ring-accent-ring"
                      required
                    />
                  </div>

                  {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}

                  <button
                    type="submit"
                    disabled={busy}
                    className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-bg transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                  >
                    {busy ? "Generating code…" : "Start pairing →"}
                  </button>
                </div>
              </div>
            </form>

            {/* Method 2: Recovery words */}
            <div className="rounded-xl border border-line bg-surface/30 p-5 transition-colors hover:border-line-light">
              <div className="flex items-start gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface text-mute font-semibold text-xs mt-0.5 border border-line">
                  2
                </span>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-text">Use 24 recovery words</h3>
                  <p className="mt-1 text-xs text-mute leading-relaxed">
                    Set up independently if you don't have another signed-in device handy.
                  </p>

                  <button
                    type="button"
                    className="mt-3.5 inline-flex items-center justify-center rounded-lg border border-line bg-surface px-4 py-2 text-xs font-medium text-mute transition-all duration-150 hover:border-line-light hover:text-text cursor-pointer"
                    onClick={() => {
                      setScreen("recover");
                      setError(null);
                    }}
                  >
                    Restore with recovery words →
                  </button>
                </div>
              </div>
            </div>
          </div>
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
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface/70 px-3 py-1.5 text-xs font-medium text-text transition-all duration-150 hover:bg-surface hover:border-line-light cursor-pointer"
                onClick={() => {
                  setAdding(true);
                  setAddConfirm(null);
                  setError(null);
                }}
              >
                <DevicePlusIcon />
                Add device
              </button>
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-sm text-mute transition-colors duration-150 hover:bg-surface hover:text-text"
                onClick={() => {
                  setSession(null);
                  setContacts([]);
                  setAddressBooks([]);
                  setBookFilter(ALL_ADDRESS_BOOKS);
                  setPassword("");
                  setAdding(false);
                  setAddConfirm(null);
                  setComposing(false);
                  setEditingContact(null);
                  setViewingContact(null);
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
        {/* Address books + search */}
        <div className="relative z-20 mb-6 animate-fade-in-up">
          <div className="flex items-center gap-3">
            <AddressBookMenu
              books={addressBooks}
              selectedId={bookFilter}
              onSelect={setBookFilter}
              onCreate={onCreateBook}
              busy={busy}
            />
            <button
              type="button"
              className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-accent text-bg transition-all duration-150 hover:brightness-110 active:scale-95"
              onClick={openComposer}
              aria-label="Add contact"
            >
              <PlusIcon />
            </button>
          </div>
          {contacts.length > 0 ? (
            <div className="relative mt-3">
              <SearchIcon />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search contacts…"
                className={`${searchField} pl-10`}
              />
            </div>
          ) : null}
        </div>

        {error && !composing && !editingContact ? (
          <p className="mt-4 text-sm text-danger">{error}</p>
        ) : null}

        {filtered.length === 0 && !search.trim() ? (
          <EmptyContacts
            bookName={
              bookFilter === ALL_ADDRESS_BOOKS
                ? undefined
                : bookNameById(addressBooks, bookFilter)
            }
            onAdd={openComposer}
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
              {search.trim() ? " found" : ""}
            </p>
            <ul className="divide-y divide-line">
              {filtered.map((card) => (
                <ContactCard
                  key={card.id}
                  contact={card}
                  bookName={
                    bookFilter === ALL_ADDRESS_BOOKS
                      ? bookNameById(addressBooks, card.addressBookId)
                      : undefined
                  }
                  onSelect={(contact) => {
                    setError(null);
                    setViewingContact(contact);
                  }}
                  onEdit={(contact) => {
                    startEditing(contact);
                  }}
                />
              ))}
            </ul>
          </>
        )}
      </main>

      {/* Contact detail modal */}
      {viewingContact ? (
        <ContactDetailModal
          contact={viewingContact}
          bookName={bookNameById(addressBooks, viewingContact.addressBookId)}
          onEdit={() => startEditing(viewingContact)}
          onClose={() => setViewingContact(null)}
        />
      ) : null}

      {/* Compose modal */}
      {composing ? (
        <Modal title="New contact" onClose={closeComposer}>
          <ContactForm
            key={`new-${formKey}`}
            busy={busy}
            error={error}
            addressBooks={addressBooks}
            initialDraft={emptyDraft(
              bookFilter === ALL_ADDRESS_BOOKS
                ? DEFAULT_ADDRESS_BOOK_ID
                : bookFilter,
            )}
            submitLabel="Add contact"
            onSubmit={onAdd}
            onCancel={closeComposer}
          />
        </Modal>
      ) : null}

      {/* Edit modal */}
      {editingContact ? (
        <Modal title="Edit contact" onClose={closeEditor}>
          <ContactForm
            key={`edit-${editingContact.id}`}
            busy={busy}
            error={error}
            addressBooks={addressBooks}
            initialDraft={editingContact}
            submitLabel="Save changes"
            onSubmit={onEditContact}
            onCancel={closeEditor}
          />
        </Modal>
      ) : null}

      {/* Add Device modal */}
      {adding ? (
        <AddDeviceModal
          busy={busy}
          error={error}
          addCode={addCode}
          addConfirm={addConfirm}
          onCodeChange={(code) => {
            setAddCode(code);
            setAddConfirm(null);
          }}
          onSubmit={onAddDevice}
          onBackToCode={() => {
            setAddConfirm(null);
            setError(null);
          }}
          onClose={() => {
            setAdding(false);
            setAddConfirm(null);
            setAddCode("");
            setError(null);
          }}
        />
      ) : null}
    </div>
  );
}
