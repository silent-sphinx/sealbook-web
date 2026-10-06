import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import logo from "./assets/sealbook-white.png";
import { AddressBookList } from "./components/AddressBookList";
import { SidebarDrawer, SidebarTrigger } from "./components/SidebarDrawer";
import { AddDeviceModal } from "./components/AddDeviceModal";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ContactCard, ContactListSkeleton } from "./components/ContactCard";
import { ContactDetailModal } from "./components/ContactDetailModal";
import { ContactForm } from "./components/ContactForm";
import { CalendarView } from "./components/CalendarView";
import { DeleteContactModal } from "./components/DeleteContactModal";
import { DeleteAddressBookModal } from "./components/DeleteAddressBookModal";
import { Modal } from "./components/Modal";
import { NotesView } from "./components/NotesView";
import { SettingsView } from "./components/SettingsView";
import { PasswordField } from "./components/PasswordField";
import {
  completeRecoveryRotation,
  deleteAddressBook,
  deleteContact,
  ensureDefaultAddressBook,
  listVault,
  loginAccount,
  normalizeServer,
  pairApprove,
  pairJoin,
  pairPreview,
  pairReady,
  putAccountSettings,
  putAddressBook,
  putNotebook,
  putContact,
  recoverAccount,
  registerAccount,
  revokeSession,
  type Session,
} from "./lib/client";
import {
  DEFAULT_ACCOUNT_SETTINGS,
  isFeatureEnabled,
} from "./lib/accountSettings";
import {
  ALL_ADDRESS_BOOKS,
  DEFAULT_ADDRESS_BOOK_ID,
  bookNameById,
  resolveAddressBookId,
} from "./lib/addressBook";
import { emptyDraft, sortContacts } from "./lib/contact";
import {
  extractRecoveryWords,
  formatRecoveryWordsFile,
} from "./lib/phrase";
import { findInvalidBip39Words } from "./lib/bip39Words";
import { confirmationGroups } from "./lib/pairing";
import {
  clearDevice,
  loadConnectionDomain,
  loadDevice,
  loadDeviceMetadata,
  loadUnverifiedLegacyDevice,
  loadVaultSnapshot,
  saveConnectionDomain,
  saveDevice,
  saveVaultSnapshot,
  type DeviceMetadata,
} from "./lib/storage";
import { browserTimezone } from "./lib/timezone";
import { friendlyError } from "./lib/errors";
import {
  btnPrimary,
  btnSecondary,
  field,
  ghost,
  primary,
  secondary,
  shell,
  focusRing,
} from "./lib/styles";
import type {
  AccountSettings,
  AddressBook,
  Calendar,
  CalendarEvent,
  Contact,
  ContactDraft,
  DeviceState,
  Note,
  Notebook,
} from "./lib/types";

type Mode = "register" | "signin";
type Screen = "auth" | "phrase" | "pair" | "recover";
type MainTab = "contacts" | "calendar" | "notes" | "settings";

const LAST_TAB_KEY = "sealbook.last-tab";
const TIMEZONE_KEY = "sealbook.timezone";
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const IDLE_WARNING_MS = IDLE_TIMEOUT_MS - 60 * 1000;

function passwordStrength(value: string): { score: number; label: string } {
  if (!value) return { score: 0, label: "" };
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value) || /[^A-Za-z0-9]/.test(value)) score += 1;
  return { score, label: ["Weak", "Fair", "Good", "Strong"][Math.max(0, score - 1)] };
}

function loadTimezone(): string {
  try {
    return localStorage.getItem(TIMEZONE_KEY) || browserTimezone();
  } catch {
    return browserTimezone();
  }
}

function rememberBrowserTimezone(): string {
  const timezone = browserTimezone();
  try {
    const stored = localStorage.getItem(TIMEZONE_KEY);
    if (stored) {
      return stored;
    }
    localStorage.setItem(TIMEZONE_KEY, timezone);
  } catch {
    // storage unavailable; use the browser timezone for this session
  }
  return timezone;
}

function loadLastTab(): MainTab {
  try {
    const stored = sessionStorage.getItem(LAST_TAB_KEY);
    // Checked against the list rather than one name, so adding a tab does not
    // silently stop it surviving a reload.
    return stored === "calendar" || stored === "notes" ? stored : "contacts";
  } catch {
    return "contacts";
  }
}

function saveLastTab(tab: MainTab): void {
  if (tab === "settings") return;
  try {
    sessionStorage.setItem(LAST_TAB_KEY, tab);
  } catch {
    // storage unavailable; ignore
  }
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

/** The server address, shown so it is obvious which instance is being used. */
function serverLabel(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

/**
 * First-run gate. Sealbook is self-hosted, so nothing else on the auth screens
 * can work until an instance is chosen — this is deliberately the only thing
 * on screen, rather than a dismissible dialog over an inert card.
 */
function ServerSetupScreen({
  onSave,
  error,
}: {
  onSave: (value: string) => boolean;
  error: string | null;
}) {
  const [draft, setDraft] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave(draft);
  }

  return (
    <>
      <Brand title="Connect to Sealbook" subtitle="Choose the server to use on this device." />

      <form onSubmit={submit} className="mt-7">
        <label htmlFor="setup-domain" className="block text-sm font-medium text-text">
          Server address
        </label>
        <input
          id="setup-domain"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="sealbook.example.com"
          className={field}
          autoComplete="url"
          inputMode="url"
          autoFocus
          spellCheck={false}
          required
        />
        <p className="mt-2 text-xs leading-relaxed text-mute">
          The address of your own Sealbook server. <code className="text-text/80">https://</code> is
          assumed if you leave it off.
        </p>

        {error ? (
          <p role="alert" className="mt-4 text-sm text-danger">
            {error}
          </p>
        ) : null}

        <button type="submit" className={`${primary} mt-6`}>
          Continue
        </button>
      </form>

      <p className="mt-6 border-t border-line pt-5 text-xs leading-relaxed text-mute">
        Sealbook has no central service. Your contacts, calendar and notes are encrypted on this
        device and stored only on the server you run.
      </p>
    </>
  );
}

/** Changes an already-configured server. */
function DomainSettings({
  value,
  onSave,
}: {
  value: string;
  onSave: (value: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saveError, setSaveError] = useState<string | null>(null);

  function openSettings() {
    setDraft(value);
    setSaveError(null);
    setOpen(true);
  }

  function save() {
    if (onSave(draft)) {
      setOpen(false);
      setSaveError(null);
    } else {
      setSaveError("Enter a valid server address.");
    }
  }

  return (
    <>
      <div className="mt-5 flex items-center justify-center gap-2 text-xs text-mute">
        <span className="min-w-0 truncate">
          Server <span className="text-text/80">{serverLabel(value)}</span>
        </span>
        <span aria-hidden="true" className="text-mute/50">
          ·
        </span>
        <button type="button" onClick={openSettings} className={ghost}>
          Change
        </button>
      </div>

      {open && (
        <Modal title="Change server" onClose={() => setOpen(false)}>
          <div className="space-y-4 p-6">
            <div>
              <label
                htmlFor="auth-connection-domain"
                className="block text-sm font-medium text-text"
              >
                Server address
              </label>
              <input
                id="auth-connection-domain"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="sealbook.example.com"
                className={field}
                autoComplete="url"
                inputMode="url"
                spellCheck={false}
                autoFocus
              />
              {saveError ? (
                <p role="alert" className="mt-2 text-xs text-danger">
                  {saveError}
                </p>
              ) : null}
              <p className="mt-1.5 text-xs text-mute">
                Signing in sends your credentials to this server, so check it carefully.
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" className={btnSecondary} onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" className={btnPrimary} onClick={save}>
                Save server
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function AuthCard({
  children,
  connectionDomain,
  onConnectionDomainSave,
  domainError,
  wide = false,
}: {
  children: React.ReactNode;
  connectionDomain?: string;
  onConnectionDomainSave?: (value: string) => boolean;
  domainError?: string | null;
  wide?: boolean;
}) {
  const managesDomain = connectionDomain !== undefined && onConnectionDomainSave !== undefined;
  const domainConfigured = connectionDomain === undefined || connectionDomain.trim() !== "";
  // The setup form is narrow even on screens that would otherwise go wide.
  const showWide = wide && domainConfigured;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-full flex-col justify-center px-5 py-8">
      <div
        className={`mx-auto w-full min-w-0 ${showWide ? "max-w-[900px]" : "max-w-[460px]"} animate-fade-in-up`}
      >
        <div className="rounded-2xl border border-line bg-panel/75 p-7 shadow-2xl shadow-black/40 backdrop-blur-md sm:p-9">
          {domainConfigured ? (
            children
          ) : managesDomain ? (
            <ServerSetupScreen
              onSave={onConnectionDomainSave!}
              error={domainError ?? null}
            />
          ) : null}
        </div>

        {managesDomain && domainConfigured ? (
          <DomainSettings value={connectionDomain!} onSave={onConnectionDomainSave!} />
        ) : null}
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

function ClearIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M5.22 4.16a.75.75 0 0 0-1.06 1.06L8.94 10l-4.78 4.78a.75.75 0 1 0 1.06 1.06L10 11.06l4.78 4.78a.75.75 0 0 0 1.06-1.06L11.06 10l4.78-4.78a.75.75 0 0 0-1.06-1.06L10 8.94 5.22 4.16Z" />
    </svg>
  );
}

function ContactsIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
      <path d="M10 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-7 9a7 7 0 1 1 14 0H3Z" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M5 2.75a.75.75 0 0 1 1.5 0V4h7V2.75a.75.75 0 0 1 1.5 0V4H16a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V2.75ZM3.5 8v7.5a.5.5 0 0 0 .5.5h12a.5.5 0 0 0 .5-.5V8h-13Z" clipRule="evenodd" />
    </svg>
  );
}

function NotesIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M4 3a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V3Zm3.25 2.5a.75.75 0 0 0 0 1.5h5.5a.75.75 0 0 0 0-1.5h-5.5Zm0 3.5a.75.75 0 0 0 0 1.5h5.5a.75.75 0 0 0 0-1.5h-5.5Zm0 3.5a.75.75 0 0 0 0 1.5h3a.75.75 0 0 0 0-1.5h-3Z" clipRule="evenodd" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M8.34 1.804A1 1 0 0 1 9.32 1h1.36a1 1 0 0 1 .98.804l.295 1.473c.497.144.971.342 1.416.587l1.25-.834a1 1 0 0 1 1.262.125l.962.962a1 1 0 0 1 .125 1.262l-.834 1.25c.245.445.443.919.587 1.416l1.473.294a1 1 0 0 1 .804.98v1.361a1 1 0 0 1-.804.98l-1.473.295a6.95 6.95 0 0 1-.587 1.416l.834 1.25a1 1 0 0 1-.125 1.262l-.962.962a1 1 0 0 1-1.262.125l-1.25-.834a6.953 6.953 0 0 1-1.416.587l-.294 1.473a1 1 0 0 1-.98.804H9.32a1 1 0 0 1-.98-.804l-.295-1.473a6.957 6.957 0 0 1-1.416-.587l-1.25.834a1 1 0 0 1-1.262-.125l-.962-.962a1 1 0 0 1-.125-1.262l.834-1.25a6.957 6.957 0 0 1-.587-1.416l-1.473-.294A1 1 0 0 1 1 10.68V9.32a1 1 0 0 1 .804-.98l1.473-.295c.144-.497.342-.971.587-1.416l-.834-1.25a1 1 0 0 1 .125-1.262l.962-.962A1 1 0 0 1 5.08 3.03l1.25.834c.445-.245.919-.443 1.416-.587l.294-1.473ZM13 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
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

function UploadIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M9.25 13.25a.75.75 0 0 0 1.5 0V4.56l2.22 2.22a.75.75 0 1 0 1.06-1.06l-3.5-3.5a.75.75 0 0 0-1.06 0l-3.5 3.5a.75.75 0 0 0 1.06 1.06l2.22-2.22v8.69ZM3.5 14.25a.75.75 0 0 1 .75.75v1.5c0 .414.336.75.75.75h10a.75.75 0 0 0 .75-.75V15a.75.75 0 0 1 1.5 0v1.5A2.25 2.25 0 0 1 15 18.75H5A2.25 2.25 0 0 1 2.75 16.5V15a.75.75 0 0 1 .75-.75Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

const TABS: { id: MainTab; label: string; icon: React.ReactNode }[] = [
  { id: "contacts", label: "Contacts", icon: <ContactsIcon /> },
  { id: "calendar", label: "Calendar", icon: <CalendarIcon /> },
  { id: "notes", label: "Notes", icon: <NotesIcon /> },
  { id: "settings", label: "Settings", icon: <SettingsIcon /> },
];

export default function App() {
  const initial = loadDeviceMetadata();
  const [stored, setStored] = useState<DeviceMetadata | null>(initial);
  const [mode, setMode] = useState<Mode>(initial ? "signin" : "register");
  const [screen, setScreen] = useState<Screen>("auth");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [connectionDomain, setConnectionDomain] = useState(() =>
    loadConnectionDomain() ?? initial?.server ?? "",
  );
  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [addressBooks, setAddressBooks] = useState<AddressBook[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [accountSettings, setAccountSettings] = useState<AccountSettings>(DEFAULT_ACCOUNT_SETTINGS);
  const [bookFilter, setBookFilter] = useState(ALL_ADDRESS_BOOKS);
  // Set by the sidebar's "+", read by the address book list to open its input.
  const [creatingBook, setCreatingBook] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [composing, setComposing] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [viewingContact, setViewingContact] = useState<Contact | null>(null);
  const [deletingContact, setDeletingContact] = useState<Contact | null>(null);
  const [deletingAddressBook, setDeletingAddressBook] = useState<AddressBook | null>(null);
  const [pairId, setPairId] = useState("");
  const [pairConfirm, setPairConfirm] = useState("");
  const [pairState, setPairState] = useState<DeviceState | null>(null);
  const [pairApproved, setPairApproved] = useState(false);
  const [addCode, setAddCode] = useState("");
  const [addConfirm, setAddConfirm] = useState<string | null>(null);
  const [addPreview, setAddPreview] = useState<Awaited<ReturnType<typeof pairPreview>> | null>(null);
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTabState, setActiveTabState] = useState<MainTab>(loadLastTab);
  const [timezone, setTimezoneState] = useState(loadTimezone);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [loadingVault, setLoadingVault] = useState(false);
  const [idleCountdown, setIdleCountdown] = useState<number | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  // An interrupted recovery leaves the vault key unrotated, so the phrase that
  // was used still opens it. The banner asks for the password to finish.
  const [finishingRecovery, setFinishingRecovery] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const headerRef = useRef<HTMLDivElement>(null);
  // Below `lg` the contacts sidebar is a slide-over rather than a column.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // The calendar fills the viewport below the header, so it needs the header's
  // real height. That height is not a constant: the nav wraps to its own row on
  // narrow screens and the offline banner adds another row, so a hardcoded value
  // pushed the calendar off the bottom of an `overflow-hidden` box.
  useEffect(() => {
    const node = headerRef.current;
    if (!node) return;
    const publish = () => {
      document.documentElement.style.setProperty(
        "--sb-header-h",
        `${node.getBoundingClientRect().height}px`,
      );
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => observer.disconnect();
  }, [session]);

  function setActiveTab(tab: MainTab) {
    setActiveTabState(tab);
    saveLastTab(tab);
  }

  function setTimezone(value: string) {
    setTimezoneState(value);
    try {
      localStorage.setItem(TIMEZONE_KEY, value);
    } catch {
      // storage unavailable; ignore
    }
  }

  function saveDomain(value: string): boolean {
    try {
      const server = normalizeServer(value);
      // normalizeServer returns "" for blank input rather than throwing, which
      // would otherwise report success and drop the user back on the gate.
      if (!server) {
        setError("Enter the address of your Sealbook server.");
        return false;
      }
      setConnectionDomain(server);
      saveConnectionDomain(server);
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  const locked = Boolean(stored);
  const isOffline = !online || session?.offline === true;

  // Settings is always present: it is where a feature gets turned back on.
  const visibleTabs = useMemo(
    () => TABS.filter((tab) => tab.id === "settings" || isFeatureEnabled(accountSettings, tab.id)),
    [accountSettings],
  );
  // Derived rather than corrected in an effect, so a tab disabled on another
  // device is never rendered for a frame before being swapped out. The stored
  // last tab is coerced the same way, so a disabled one does not survive reloads.
  const activeTab = visibleTabs.some((tab) => tab.id === activeTabState)
    ? activeTabState
    : visibleTabs[0].id;
  const contactsEnabled = isFeatureEnabled(accountSettings, "contacts");

  const filtered = useMemo(() => {
    const inBook =
      bookFilter === ALL_ADDRESS_BOOKS
        ? contacts
        : contacts.filter(
          (contact) => resolveAddressBookId(contact.addressBookId) === bookFilter,
        );
    const query = search.trim().toLowerCase();
    const matches = !query
      ? inBook
      : inBook.filter((contact) => {
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
    return sortContacts(matches);
  }, [addressBooks, bookFilter, contacts, search]);

  // Poll for pairing approval. Stops when the request expires.
  useEffect(() => {
    if (screen !== "pair" || !pairId || pairApproved) {
      return;
    }
    let cancelled = false;
    let intervalId = 0;

    const tick = async () => {
      try {
        const ready = await pairReady("", pairId);
        if (!cancelled && ready) {
          setPairApproved(true);
        }
      } catch (err) {
        if (cancelled) return;
        const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
        if (msg.includes("expired") || msg.includes("not found")) {
          window.clearInterval(intervalId);
          setError(friendlyError(err));
        }
        // other errors are treated as transient; keep polling
      }
    };

    intervalId = window.setInterval(() => {
      void tick();
    }, 2000);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [screen, pairId, pairApproved]);

  // Idle auto-lock. The warning is an in-app countdown, not window.confirm:
  // a native prompt suspends the event loop, so a user who walked away left the
  // vault unlocked behind an unanswered dialog forever. The lock timer now runs
  // to IDLE_TIMEOUT_MS whether or not the warning is acknowledged.
  useEffect(() => {
    if (!session) return;
    let warnTimeout = 0;
    let lockTimeout = 0;
    let tick = 0;

    const clearTimers = () => {
      window.clearTimeout(warnTimeout);
      window.clearTimeout(lockTimeout);
      window.clearInterval(tick);
    };

    const resetIdleTimer = () => {
      clearTimers();
      setIdleCountdown(null);
      warnTimeout = window.setTimeout(() => {
        let remaining = Math.round((IDLE_TIMEOUT_MS - IDLE_WARNING_MS) / 1000);
        setIdleCountdown(remaining);
        tick = window.setInterval(() => {
          remaining -= 1;
          setIdleCountdown(remaining > 0 ? remaining : 0);
        }, 1000);
      }, IDLE_WARNING_MS);
      lockTimeout = window.setTimeout(() => {
        clearTimers();
        setIdleCountdown(null);
        void lock();
      }, IDLE_TIMEOUT_MS);
    };

    const events = ["pointerdown", "keydown", "touchstart"] as const;
    events.forEach((event) => window.addEventListener(event, resetIdleTimer));
    resetIdleTimer();
    return () => {
      clearTimers();
      setIdleCountdown(null);
      events.forEach((event) => window.removeEventListener(event, resetIdleTimer));
    };
  }, [session]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("pair") !== "1" || stored || session) {
      return;
    }
    const linkedUsername = params.get("username")?.trim();
    if (!linkedUsername) {
      return;
    }
    setMode("signin");
    setUsername(linkedUsername);
    setError(null);
    setBusy(true);
    void pairJoin(normalizeServer(connectionDomain), linkedUsername)
      .then((joined) => {
        setPairId(joined.pairCode);
        setPairConfirm(joined.confirm);
        setPairState(joined.state);
        setPairApproved(false);
        setPassword("");
        setScreen("pair");
      })
      .catch((err) => setError(friendlyError(err)))
      .finally(() => setBusy(false));
  }, [connectionDomain, session, stored]);

  useEffect(() => {
    const handleOffline = () => setOnline(false);
    const handleOnline = () => {
      setOnline(true);
      if (!session?.offline || !password) return;
      void loginAccount(session.state, password)
        .then(async (reconnected) => {
          setSession(reconnected);
          await refresh(reconnected);
        })
        .catch(() => {
          // Keep showing the last local snapshot until the server is reachable.
        });
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [password, session]);

  async function openSession(next: Session, passwordForStorage: string) {
    await saveDevice(next.state, passwordForStorage);
    setStored(next.state);
    setSession(next);
    await refresh(next);
  }

  async function persistSession(next: Session, passwordForStorage: string) {
    await saveDevice(next.state, passwordForStorage);
    setPassword(passwordForStorage);
    setStored(next.state);
    setSession(next);
  }

  async function refresh(next: Session) {
    setLoadingVault(true);
    let listed;
    let books;
    try {
      listed = await listVault(next);
      books = await ensureDefaultAddressBook(next, listed.addressBooks);
    } finally {
      setLoadingVault(false);
    }
    setAddressBooks(books);
    setContacts(listed.contacts);
    setCalendarEvents(listed.calendarEvents);
    setCalendars(listed.calendars);
    setNotes(listed.notes);
    setNotebooks(listed.notebooks);
    setAccountSettings(listed.accountSettings);
    if (password) {
      await saveVaultSnapshot(
        {
          addressBooks: books,
          contacts: listed.contacts,
          calendars: listed.calendars,
          calendarEvents: listed.calendarEvents,
          notes: listed.notes,
          notebooks: listed.notebooks,
          accountSettings: listed.accountSettings,
        },
        password,
      );
    }
    setBookFilter((current) => {
      if (current === ALL_ADDRESS_BOOKS) {
        return current;
      }
      return books.some((book) => book.id === current) ? current : ALL_ADDRESS_BOOKS;
    });
  }

  /**
   * Folds one autosaved note into the list. The editor writes on a debounce, and
   * a full `refresh` per keystroke would re-list and re-seal the whole vault.
   */
  function applySavedNote(note: Note) {
    setNotes((current) => {
      const at = current.findIndex((item) => item.id === note.id);
      if (at === -1) return [note, ...current];
      const next = [...current];
      next[at] = note;
      return next;
    });
  }

  async function onSaveAccountSettings(next: AccountSettings) {
    if (!session) return;
    await putAccountSettings(session, next);
    setAccountSettings(next);
  }

  // Refresh after a successful write. A refresh failure is reported separately
  // so it isn't mistaken for a failed save. Returns whether the refresh worked.
  async function refreshAfterSave(next: Session): Promise<boolean> {
    try {
      await refresh(next);
      return true;
    } catch {
      setError("Saved, but the list couldn't refresh. Reload to see the change.");
      return false;
    }
  }

  function resetPair() {
    setPairId("");
    setPairConfirm("");
    setPairState(null);
    setPairApproved(false);
    setCopied(false);
  }

  function resetVaultState() {
    setContacts([]);
    setCalendarEvents([]);
    setCalendars([]);
    setAddressBooks([]);
    setNotes([]);
    setNotebooks([]);
    setAccountSettings(DEFAULT_ACCOUNT_SETTINGS);
    setBookFilter(ALL_ADDRESS_BOOKS);
    setAdding(false);
    setAddConfirm(null);
    setAddCode("");
    setComposing(false);
    setEditingContact(null);
    setViewingContact(null);
    setDeletingContact(null);
    setDeletingAddressBook(null);
    setSearch("");
    setError(null);
  }

  async function lock() {
    const active = session;
    setSession(null);
    setPassword("");
    resetVaultState();
    if (active) {
      try {
        await revokeSession(active);
      } catch {
        // Local lock still protects the in-memory vault if the server is unavailable.
      }
    }
  }

  function backToAuth() {
    setScreen("auth");
    resetPair();
    setPhrase("");
    setError(null);
    if (stored) {
      setUsername(stored.username);
      setConnectionDomain(loadConnectionDomain() ?? stored.server);
    }
  }

  async function signOut() {
    await lock();
    clearDevice();
    setStored(null);
    resetPair();
    setUsername("");
    setPassword("");
    setPhrase("");
    setMode("register");
    setScreen("auth");
  }

  function confirmSignOut() {
    setSigningOut(true);
  }

  async function onUnlock(event: FormEvent) {
    event.preventDefault();
    if (!stored) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const unlocked = await loadDevice(password);
      if (!unlocked) {
        // A device stored before storage was encrypted cannot have its password
        // checked locally, so the server checks it. A successful login re-saves
        // the state encrypted, replacing the plaintext blob for good.
        const legacy = loadUnverifiedLegacyDevice();
        if (!legacy) {
          throw new Error("Wrong password");
        }
        if (!navigator.onLine) {
          throw new Error("Connect to the server once to finish securing this device's stored keys.");
        }
        await openSession(await loginAccount(legacy, password), password);
        return;
      }
      if (!navigator.onLine) {
        const snapshot = await loadVaultSnapshot(password);
        if (!snapshot) {
          throw new Error("Connect to the server once before using the vault offline.");
        }
        setAddressBooks(snapshot.addressBooks);
        setContacts(snapshot.contacts);
        setCalendars(snapshot.calendars);
        setCalendarEvents(snapshot.calendarEvents);
        setNotes(snapshot.notes);
        setNotebooks(snapshot.notebooks);
        setAccountSettings(snapshot.accountSettings);
        setSession({ state: unlocked, collectionKey: "", token: "", latestRevision: 0, keyEpoch: 0, manifestSeq: 0, offline: true });
      } else {
        await openSession(await loginAccount(unlocked, password), password);
      }
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
        normalizeServer(connectionDomain),
        username.trim(),
        password,
      );
      const defaultTimezone = rememberBrowserTimezone();
      setTimezoneState(defaultTimezone);
      await saveDevice(next.state, password);
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
      const joined = await pairJoin(normalizeServer(connectionDomain), username.trim());
      setPairId(joined.pairCode);
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
      await openSession(await loginAccount(pairState, password), password);
      setScreen("auth");
      resetPair();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onRecover(event: FormEvent) {
    event.preventDefault();
    const words = extractRecoveryWords(phrase);
    if (words.length !== 24) {
      setError(`Please enter all 24 words (${words.length} entered so far).`);
      return;
    }
    const invalidWords = findInvalidBip39Words(words);
    if (invalidWords.length > 0) {
      setError(`"${invalidWords[0]}" is not a valid BIP-39 recovery word. Please check for typos.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Recovery rotates the vault key, which retires the phrase just used and
      // issues a new one. Show it the same way registration does, because the
      // user has to write it down or they lose their way back in.
      const { session: recovered, phrase: replacement } = await recoverAccount(
        normalizeServer(connectionDomain),
        username.trim(),
        words.join(" "),
        password,
      );
      await openSession(recovered, password);
      setPhrase(replacement);
      setScreen("phrase");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Finishes the rotation an interrupted recovery left owing.
   *
   * Until it runs, the phrase used to recover still opens the vault and so does
   * any copy of it, and the server refuses every write. It issues a replacement
   * phrase, which is shown the same way registration shows one.
   */
  async function onFinishRecovery(event: FormEvent) {
    event.preventDefault();
    if (!session) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { session: rotated, phrase: replacement } = await completeRecoveryRotation(
        session,
        recoveryPassword,
      );
      await persistSession(rotated, recoveryPassword);
      setRecoveryPassword("");
      setFinishingRecovery(false);
      setPhrase(replacement);
      setScreen("phrase");
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
        setAddPreview(preview);
        setAddConfirm(preview.confirm);
        return;
      }
      if (!addPreview) {
        throw new Error("Pairing preview expired");
      }
      await pairApprove(session, addCode.trim(), addPreview, addConfirm);
      setAddCode("");
      setAddConfirm(null);
      setAddPreview(null);
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
      await refreshAfterSave(session);
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
      await refreshAfterSave(session);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSaveViewedContact(draft: ContactDraft) {
    if (!session || !viewingContact || !draft.name.trim()) {
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      await putContact(session, draft, viewingContact.id);
      setViewingContact((current) =>
        current?.id === viewingContact.id ? { ...current, ...draft } : current,
      );
      await refreshAfterSave(session);
      return true;
    } catch (err) {
      setError(friendlyError(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function closeEditor() {
    if (busy) {
      return;
    }
    setEditingContact(null);
    setError(null);
  }

  function promptDelete(contact: Contact) {
    setError(null);
    setDeletingContact(contact);
  }

  function closeDelete() {
    if (busy) {
      return;
    }
    setDeletingContact(null);
    setError(null);
  }

  async function onConfirmDelete() {
    if (!session || !deletingContact) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteContact(session, deletingContact.id);
      if (editingContact?.id === deletingContact.id) {
        setEditingContact(null);
      }
      if (viewingContact?.id === deletingContact.id) {
        setViewingContact(null);
      }
      setDeletingContact(null);
      await refreshAfterSave(session);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onCreateNotebook(name: string): Promise<string | undefined> {
    if (!session || !name.trim()) {
      return undefined;
    }
    setBusy(true);
    setError(null);
    try {
      const id = await putNotebook(session, name.trim());
      await refreshAfterSave(session);
      return id;
    } catch (err) {
      setError(friendlyError(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function onCreateBook(name: string): Promise<string | undefined> {
    if (!session || !name.trim()) {
      return undefined;
    }
    setBusy(true);
    setError(null);
    try {
      const id = await putAddressBook(session, name.trim());
      if (await refreshAfterSave(session)) {
        setBookFilter(id);
      }
      return id;
    } catch (err) {
      setError(friendlyError(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function onRenameBook(id: string, name: string): Promise<void> {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      await putAddressBook(session, name, id);
      await refreshAfterSave(session);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  function onDeleteBook(book: AddressBook): void {
    if (!session || book.id === DEFAULT_ADDRESS_BOOK_ID) return;
    setError(null);
    setDeletingAddressBook(book);
  }

  function closeDeleteBook() {
    if (busy) return;
    setDeletingAddressBook(null);
    setError(null);
  }

  async function onConfirmDeleteBook(destinationId: string | null): Promise<void> {
    if (!session || !deletingAddressBook) return;
    const book = deletingAddressBook;
    const containedContacts = contacts.filter(
      (item) => resolveAddressBookId(item.addressBookId) === book.id,
    );
    setBusy(true);
    setError(null);
    try {
      for (const contact of containedContacts) {
        if (destinationId) {
          await putContact(session, { ...contact, addressBookId: destinationId }, contact.id);
        } else {
          await deleteContact(session, contact.id);
        }
      }
      await deleteAddressBook(session, book.id);
      if (bookFilter === book.id) setBookFilter(ALL_ADDRESS_BOOKS);
      setDeletingAddressBook(null);
      await refreshAfterSave(session);
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
      const text = formatRecoveryWordsFile(words);
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "sealbook-recovery-words.txt";
      a.click();
      URL.revokeObjectURL(url);
    }

    function printWords() {
      const win = window.open("", "_blank", "noopener,noreferrer");
      if (!win) return;
      const doc = win.document;
      doc.title = "Sealbook Recovery Words";
      doc.body.style.cssText =
        "font-family:system-ui,sans-serif;padding:40px;max-width:480px;margin:0 auto";

      const heading = doc.createElement("h2");
      heading.style.margin = "0 0 4px";
      heading.textContent = "Sealbook Recovery Words";

      const note = doc.createElement("p");
      note.style.cssText = "color:#666;margin:0 0 24px;font-size:14px";
      note.textContent = "Keep this document safe and secret.";

      const table = doc.createElement("table");
      table.style.cssText = "border-collapse:collapse;font-size:15px";
      words.forEach((word, index) => {
        const row = table.insertRow();
        const numCell = row.insertCell();
        numCell.style.cssText =
          "text-align:right;padding-right:12px;color:#888;font-variant-numeric:tabular-nums";
        numCell.textContent = String(index + 1);
        const wordCell = row.insertCell();
        wordCell.style.fontFamily = "monospace";
        wordCell.textContent = word;
      });

      doc.body.append(heading, note, table);
      win.focus();
      win.print();
    }

    return (
      <AuthCard
        connectionDomain={connectionDomain}
        onConnectionDomainSave={saveDomain}
        domainError={error}
      >
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
      <AuthCard
        connectionDomain={connectionDomain}
        onConnectionDomainSave={saveDomain}
        domainError={error}
        wide
      >
        <Brand
          title="Pair this device"
          subtitle="Connect with an active device to transfer encryption keys."
        />

        <div className="mt-7 grid gap-4 sm:grid-cols-2 sm:items-start">
          <div className="min-w-0 space-y-4">
          {/* Step 1 */}
          <div className="min-w-0 rounded-xl border border-line bg-surface/30 p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent font-semibold text-xs mt-0.5">
                1
              </span>
              <div>
                <p className="text-sm font-semibold text-text">Open your signed-in device</p>
                <p className="mt-1 text-sm leading-relaxed text-mute">
                  On your signed-in device, click <strong className="font-semibold text-text">Add device</strong> at the top.
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
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-text">Enter this pairing code</p>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(pairId);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-accent transition-colors hover:border-line-light cursor-pointer"
                    aria-label={copied ? "Pairing code copied" : "Copy pairing code"}
                    title={copied ? "Pairing code copied" : "Copy pairing code"}
                  >
                    {copied ? <CheckIcon /> : <CopyIcon />}
                  </button>
                </div>
                <p className="mt-2.5 max-w-full select-all whitespace-normal rounded-lg border border-line bg-bg/90 px-3.5 py-2.5 font-mono text-[10px] leading-relaxed text-accent [overflow-wrap:normal]">
                  {pairId}
                </p>
              </div>
            </div>
          </div>

          </div>

          {/* Step 3: Confirmation Code */}
          <div className="min-w-0 rounded-xl border border-line bg-surface/30 p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent font-semibold text-xs mt-0.5">
                3
              </span>
              <div className="flex-1 min-w-0 text-center">
                <p className="text-sm font-semibold text-left text-text">Verify code</p>
                <p className="mt-1 text-sm text-mute text-left leading-relaxed">
                  Confirm both devices show this code:
                </p>
                <div className="my-3 rounded-xl border border-accent/25 bg-bg/90 px-2 py-3">
                  <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 font-mono text-base font-bold leading-relaxed tracking-[0.05em] text-accent">
                    {confirmationGroups(pairConfirm).map((group, index) => (
                      <span key={`${index}-${group}`}>{group}</span>
                    ))}
                  </p>
                </div>
                <p className="text-xs leading-relaxed text-mute">
                  Check the other device, then approve the pairing there.
                </p>
              </div>
            </div>
          </div>
        </div>

        {error ? <p role="alert" className="mt-4 text-sm text-danger sm:col-span-2">{error}</p> : null}

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
              <label htmlFor="pair-password" className="block text-sm font-medium text-text">
                Password
              </label>
              <PasswordField
                id="pair-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Enter your password"
                autoFocus
                className={field}
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
    const enteredWords = extractRecoveryWords(phrase);
    const count = enteredWords.length;
    const invalidWords = findInvalidBip39Words(enteredWords);

    async function handlePastePhrase() {
      try {
        const text = await navigator.clipboard.readText();
        if (text.trim()) {
          const words = extractRecoveryWords(text);
          if (words.length > 0) {
            setPhrase(words.join(" "));
          } else {
            setPhrase(text.trim());
          }
        }
      } catch {
        // clipboard access not permitted
      }
    }

    function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result;
        if (typeof content === "string" && content.trim()) {
          const words = extractRecoveryWords(content);
          if (words.length > 0) {
            setPhrase(words.join(" "));
          }
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    }

    return (
      <AuthCard
        connectionDomain={connectionDomain}
        onConnectionDomainSave={saveDomain}
        domainError={error}
      >
        <Brand
          title="Restore with words"
          subtitle="Set up this device using your 24 secret recovery words."
        />
        <form onSubmit={onRecover} className="mt-7 space-y-4">
          <div>
            <label htmlFor="recover-username" className="block text-sm font-medium text-text">
              Username
            </label>
            <input
              id="recover-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="Enter your username"
              className={field}
              autoFocus
              spellCheck={false}
              required
            />
          </div>

          <div>
            <label htmlFor="recovery-phrase" className="block text-sm font-medium text-text mb-1.5">
              Recovery words
            </label>
            <div className="box-border w-full overflow-hidden rounded-lg border border-line bg-bg transition-all focus-within:border-accent-dim focus-within:ring-1 focus-within:ring-accent-ring">
              <textarea
                id="recovery-phrase"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                onPaste={(e) => {
                  const pastedText = e.clipboardData.getData("text");
                  if (pastedText) {
                    const words = extractRecoveryWords(pastedText);
                    if (
                      words.length === 24 ||
                      pastedText.includes("\n") ||
                      /(?:^|\s)\d+[-.:)]/.test(pastedText)
                    ) {
                      e.preventDefault();
                      setPhrase(words.join(" "));
                    }
                  }
                }}
                placeholder="Paste or type all 24 words separated by spaces…"
                rows={4}
                className="box-border block w-full bg-transparent px-3.5 py-2.5 font-mono text-sm leading-relaxed text-text outline-none placeholder:text-mute/50 resize-none"
                required
              />
              <div className="flex flex-wrap items-center justify-between gap-y-2 border-t border-line/60 bg-surface/30 px-3 py-2">
                <span
                  aria-live="polite"
                  className={`inline-flex min-w-0 items-center gap-1.5 font-mono text-xs whitespace-nowrap ${invalidWords.length > 0
                      ? "text-danger font-medium"
                      : count === 24
                        ? "text-accent font-semibold"
                        : count > 24
                          ? "text-danger font-medium"
                          : "text-mute"
                    }`}
                >
                  {invalidWords.length > 0 ? (
                    <span>
                      {count} / 24 words · <span className="underline">"{invalidWords[0]}"</span> invalid
                    </span>
                  ) : (
                    <>
                      {count === 24 ? (
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
                      ) : null}
                      {count} / 24 words
                    </>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePastePhrase}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-text hover:border-line-light hover:text-accent active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap"
                  >
                    <CopyIcon />
                    <span>Paste</span>
                  </button>
                  <label className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-text hover:border-line-light hover:text-accent active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap">
                    <UploadIcon />
                    <span>Upload file</span>
                    <input
                      type="file"
                      accept=".txt,text/plain"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div>
            <label htmlFor="recover-password" className="block text-sm font-medium text-text">
              New password
            </label>
            {/* Recovery exists for the case where the password is what was lost,
                so the words set a new one rather than asking for the old. */}
            <p className="mt-1 text-xs text-mute">
              Your recovery words set a new password. The old one stops working.
            </p>
            <PasswordField
              id="recover-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="Choose a new password"
              className={field}
              required
            />
          </div>

          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}

          <button
            type="submit"
            disabled={busy}
            className={`${primary} mt-6`}
          >
            {busy ? "Restoring vault…" : "Restore vault on this device"}
          </button>

          <button
            type="button"
            className={`${ghost} mt-3 block w-full py-2 text-center`}
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
        <AuthCard
          connectionDomain={connectionDomain}
          onConnectionDomainSave={saveDomain}
          domainError={error}
        >
          <Brand title="Sealbook" subtitle={stored.username} />
          <form onSubmit={onUnlock} className="mt-8">
            <label className="block text-sm text-mute">
              Password
              <PasswordField
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                autoFocus
                className={field}
                required
              />
            </label>
            {error ? <p role="alert" className="mt-4 text-sm text-danger">{error}</p> : null}
            <button type="submit" disabled={busy} className={`${primary} mt-6`}>
              {busy ? "Please wait…" : "Unlock"}
            </button>
          </form>
          <button
            type="button"
            className={`${ghost} mt-4 block w-full py-2 text-center`}
            onClick={confirmSignOut}
          >
            Sign out
          </button>
          {signingOut ? (
            <ConfirmDialog
              title="Sign out"
              heading="Sign out of this device?"
              body="This device's keys are removed from this browser. To get back in you'll need to pair from another signed-in device, or use your 24 recovery words."
              confirmLabel="Sign out"
              busyLabel="Signing out…"
              onConfirm={() => {
                setSigningOut(false);
                void signOut();
              }}
              onClose={() => setSigningOut(false)}
            />
          ) : null}
        </AuthCard>
      );
    }

    // ---------- REGISTER / SIGN IN SCREEN ----------
    return (
      <AuthCard
        connectionDomain={connectionDomain}
        onConnectionDomainSave={saveDomain}
        domainError={error}
      >
        <Brand
          title="Sealbook"
          subtitle={
            mode === "signin"
              ? "Set up this device with your existing account."
              : "Your private, end-to-end encrypted contacts, calendar and notes."
          }
        />
        <div
          role="tablist"
          aria-label="Account setup method"
          className="mt-8 mb-5 grid grid-cols-2 gap-1 rounded-lg border border-line/60 bg-bg/60 p-1 text-sm"
        >
          {([
            { id: "register", label: "Create account" },
            { id: "signin", label: "Set up device" },
          ] as const).map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={mode === option.id}
              onClick={() => {
                setMode(option.id);
                setError(null);
              }}
              className={`rounded-md py-1.5 transition-colors duration-150 cursor-pointer ${focusRing} ${mode === option.id
                ? "bg-surface text-text font-medium"
                : "text-mute hover:text-text"
                }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {mode === "register" ? (
          <form onSubmit={onRegister} className="space-y-4">
            <div>
              <label htmlFor="register-username" className="block text-sm font-medium text-text">
                Username
              </label>
              <input
                id="register-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                placeholder="Choose a username"
                className={field}
                autoFocus
                spellCheck={false}
                required
              />
            </div>

            <div>
              <label htmlFor="register-password" className="block text-sm font-medium text-text">
                Password
              </label>
              <PasswordField
                id="register-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Choose a password"
                className={field}
                required
              />
              {password ? (() => {
                const strength = passwordStrength(password);
                return (
                  <div className="mt-2">
                    <div className="flex gap-1" aria-hidden="true">
                      {[1, 2, 3, 4].map((segment) => (
                        <span
                          key={segment}
                          className={`h-1 flex-1 rounded-full transition-colors ${segment <= strength.score ? "bg-accent" : "bg-surface"}`}
                        />
                      ))}
                    </div>
                    <p className="mt-1.5 text-[11px] text-mute" aria-live="polite">
                      Password strength: {strength.label}
                    </p>
                  </div>
                );
              })() : null}
              <p className="mt-2 text-xs leading-relaxed text-mute">
                This password encrypts your vault. Nobody can reset it for you — if you lose it,
                your 24 recovery words are the only way back in.
              </p>
            </div>

            {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}

            <button type="submit" disabled={busy} className={`${primary} mt-6`}>
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
                    <label htmlFor="pair-username" className="block text-xs font-medium text-text">
                      Username
                    </label>
                    <input
                      id="pair-username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="username"
                      placeholder="Enter your username"
                      className={field}
                      spellCheck={false}
                      required
                    />
                  </div>

                  {error ? <p role="alert" className="mt-3 text-xs text-danger">{error}</p> : null}

                  <button
                    type="submit"
                    disabled={busy}
                    className={`${btnPrimary} mt-4`}
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
                    className={`${btnSecondary} mt-3.5`}
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
      <div ref={headerRef} className="sticky top-0 z-40">
        {isOffline ? (
          <div className="border-b border-red-400/20 bg-red-500/10 px-5 py-2 text-center text-xs font-medium text-red-300" role="status">
            App is offline. Showing your last synced vault; editing is unavailable.
          </div>
        ) : null}
        {session.recoveryPending ? (
          <div className="border-b border-amber-400/25 bg-amber-500/10 px-5 py-2.5 text-center text-xs font-medium text-amber-200" role="alert">
            {finishingRecovery ? (
              <form onSubmit={onFinishRecovery} className="mx-auto flex max-w-md flex-wrap items-center justify-center gap-2">
                <label htmlFor="finish-recovery-password" className="sr-only">
                  Password
                </label>
                <PasswordField
                  id="finish-recovery-password"
                  value={recoveryPassword}
                  onChange={(e) => setRecoveryPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="Your password"
                  className="min-w-0 flex-1 rounded-lg border border-amber-400/30 bg-bg/80 px-3 py-1.5 text-xs text-text outline-none"
                  required
                />
                <button
                  type="submit"
                  disabled={busy || !recoveryPassword}
                  className="rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-50 cursor-pointer"
                >
                  {busy ? "Rotating…" : "Finish recovery"}
                </button>
                <button
                  type="button"
                  className="rounded-lg px-2 py-1.5 text-xs text-amber-200/80 hover:text-amber-100 cursor-pointer"
                  onClick={() => {
                    setFinishingRecovery(false);
                    setRecoveryPassword("");
                  }}
                  disabled={busy}
                >
                  Later
                </button>
              </form>
            ) : (
              <span className="inline-flex flex-wrap items-center justify-center gap-2">
                This vault was recovered but its key has not been replaced yet, so the recovery
                words you used still open it. Saving is disabled until that is finished.
                <button
                  type="button"
                  className="rounded-lg bg-amber-400 px-3 py-1 text-xs font-semibold text-bg cursor-pointer"
                  onClick={() => {
                    setError(null);
                    setFinishingRecovery(true);
                  }}
                >
                  Finish now
                </button>
              </span>
            )}
          </div>
        ) : null}
        <div className={isOffline ? "h-[2px] bg-red-500" : "h-[2px] bg-gradient-to-r from-accent/60 via-accent to-accent/60"} />
        <header className="border-b border-line bg-bg/80 backdrop-blur-lg">
          <div className={`${shell} flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5 px-4 py-3 sm:px-5 sm:py-4`}>
            <div className="flex items-center gap-2.5">
              <Logo className="h-8 w-8" />
              <div>
                <p className="font-semibold tracking-tight">Sealbook</p>
                <p className="text-xs text-mute">{session.state.username}</p>
              </div>
            </div>

            {/* Navigation Tabs */}
            <nav
              className="order-3 flex w-full items-center justify-center rounded-xl border border-line bg-surface/80 p-1 sm:order-none sm:w-auto"
              aria-label="Main Navigation"
            >
              {visibleTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  aria-current={activeTab === tab.id ? "page" : undefined}
                  className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150 cursor-pointer sm:flex-none ${focusRing} ${activeTab === tab.id
                      ? "bg-accent text-bg shadow-sm"
                      : "text-mute hover:text-text hover:bg-surface/50"
                    }`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </nav>

            <div className="flex items-center gap-2">
              {!isOffline ? <button
                type="button"
                aria-label="Add device"
                title="Add device"
                className={`inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface/70 px-2.5 py-1.5 text-xs font-medium text-text transition-all duration-150 hover:bg-surface hover:border-line-light cursor-pointer sm:px-3 ${focusRing}`}
                onClick={() => {
                  setAdding(true);
                  setAddConfirm(null);
                  setError(null);
                }}
              >
                <DevicePlusIcon />
                <span className="hidden sm:inline">Add device</span>
              </button> : null}
              <button
                type="button"
                className={`rounded-lg px-3 py-1.5 text-sm text-mute transition-colors duration-150 hover:bg-surface hover:text-text ${focusRing}`}
                onClick={lock}
              >
                Lock
              </button>
            </div>
          </div>
        </header>
      </div>

      {activeTab === "settings" && isOffline ? (
        <main className={`${shell} px-4 pb-24 pt-6 sm:px-5`}>
          <div className="rounded-xl border border-line bg-panel/25 p-6 text-sm text-mute">
            Settings are unavailable while offline.
          </div>
        </main>
      ) : activeTab === "settings" ? (
        <main className={`${shell} px-4 pb-24 pt-6 sm:px-5`}>
          <SettingsView
            session={session}
            contacts={contacts}
            addressBooks={addressBooks}
            calendars={calendars}
            calendarEvents={calendarEvents}
            notes={notes}
            notebooks={notebooks}
            onSessionUpdate={(updated) => setSession(updated)}
            onPersistSession={persistSession}
            onAccountDeleted={() => {
              signOut();
            }}
            onRefresh={() => refresh(session)}
            onCreateBook={isOffline ? undefined : onCreateBook}
            onCreateNotebook={isOffline ? undefined : onCreateNotebook}
            timezone={timezone}
            onTimezoneChange={setTimezone}
            accountSettings={accountSettings}
            onSaveAccountSettings={onSaveAccountSettings}
          />
        </main>
      ) : activeTab === "calendar" ? (
        <div>
          <CalendarView session={session} calendars={calendars} events={calendarEvents} busy={busy} timezone={timezone} onRefresh={() => refresh(session)} readOnly={isOffline} />
        </div>
      ) : activeTab === "notes" ? (
        <div>
          <NotesView
            session={session}
            notes={notes}
            notebooks={notebooks}
            busy={busy}
            onRefresh={() => refresh(session)}
            onSaved={applySavedNote}
            readOnly={isOffline}
          />
        </div>
      ) : activeTab === "contacts" ? (
        // Same shell as the calendar: full-bleed, a 244px sidebar holding the
        // section title and the address books, and a toolbar above the content.
        <main className="flex flex-col bg-bg pb-[env(safe-area-inset-bottom)] text-text lg:h-[calc(100dvh-var(--sb-header-h,74px))] lg:overflow-hidden lg:pb-0">
          <div className="grid min-h-0 flex-1 lg:h-full lg:grid-cols-[244px_minmax(0,1fr)]">
            <SidebarDrawer title="Contacts and address books" open={sidebarOpen} onClose={() => setSidebarOpen(false)}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">My contacts</p>
                  <h2 className="mt-1 text-lg font-semibold">Contacts</h2>
                </div>
                {!isOffline ? (
                  <button
                    type="button"
                    onClick={openComposer}
                    aria-label="Add contact"
                    className={`flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface text-text transition-colors hover:border-line-light hover:bg-elevated ${focusRing}`}
                  >
                    <PlusIcon />
                  </button>
                ) : null}
              </div>

              <div className="mt-8 border-t border-line pt-5">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">Address books</p>
                  {!isOffline ? (
                    <button
                      type="button"
                      onClick={() => setCreatingBook(true)}
                      aria-label="Add address book"
                      className={`flex h-7 w-7 items-center justify-center rounded-lg text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`}
                    >
                      <PlusIcon />
                    </button>
                  ) : null}
                </div>
                <AddressBookList
                  books={addressBooks}
                  selectedId={bookFilter}
                  creating={creatingBook}
                  onCreateHandled={() => setCreatingBook(false)}
                  onSelect={(id) => {
                    setBookFilter(id);
                    setSidebarOpen(false);
                  }}
                  onCreate={onCreateBook}
                  onRename={onRenameBook}
                  onDelete={onDeleteBook}
                  readOnly={isOffline}
                  busy={busy}
                />
              </div>
            </SidebarDrawer>

            <section className="order-1 flex min-w-0 flex-col overflow-hidden lg:order-none lg:min-h-0">
              <header className="flex flex-col gap-2.5 border-b border-line px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4 sm:px-5 sm:py-3.5 lg:px-6">
                <div className="flex min-w-0 items-center gap-2">
                  <SidebarTrigger label="Address books" onClick={() => setSidebarOpen(true)} />
                  <h1 className="truncate text-base font-semibold tracking-tight">
                    {bookFilter === ALL_ADDRESS_BOOKS ? "All contacts" : bookNameById(addressBooks, bookFilter)}
                  </h1>
                  <span
                    className="ml-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-mute"
                    title={`${filtered.length} contact${filtered.length === 1 ? "" : "s"} shown`}
                  >
                    {filtered.length}
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  {!isOffline ? (
                    <button
                      type="button"
                      onClick={openComposer}
                      className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-xs font-semibold text-bg transition-all duration-150 hover:brightness-110 active:scale-[0.98] ${focusRing}`}
                    >
                      <PlusIcon />
                      New contact
                    </button>
                  ) : null}
                  <div className="relative min-w-0 flex-1 sm:flex-none">
                    <SearchIcon />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search contacts"
                      aria-label="Search contacts"
                      className="h-8 w-full rounded-xl border border-line bg-panel pl-8 pr-7 text-xs text-text outline-none transition-colors duration-150 placeholder:text-mute/60 focus:border-accent-dim focus:ring-1 focus:ring-accent-ring sm:w-52"
                    />
                    {search ? (
                      <button
                        type="button"
                        onClick={() => setSearch("")}
                        className={`absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`}
                        aria-label="Clear search"
                        title="Clear search"
                      >
                        <ClearIcon />
                      </button>
                    ) : null}
                  </div>
                </div>
              </header>

              <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(26rem,36rem)]">
                <div className={`min-w-0 overflow-y-auto px-4 py-4 sm:px-5 lg:border-r lg:border-line lg:px-6 ${viewingContact ? "hidden lg:block" : ""}`}>
                  {error && !composing && !editingContact && !deletingContact && !deletingAddressBook ? (
                    <p className="mb-4 text-sm text-danger" role="alert">{error}</p>
                  ) : null}

                  {loadingVault && contacts.length === 0 ? (
                    <ContactListSkeleton />
                  ) : filtered.length === 0 && search.trim() ? (
                    <div className="flex flex-col items-center py-16 animate-fade-in-up">
                      <p className="text-sm text-mute">No contacts matching "{search}"</p>
                      <button type="button" className={`${ghost} mt-3`} onClick={() => setSearch("")}>
                        Clear search
                      </button>
                    </div>
                  ) : contacts.length === 0 ? (
                    <div className="flex flex-col items-center rounded-xl border border-dashed border-line px-6 py-12 text-center animate-fade-in-up sm:py-16">
                      <p className="text-sm font-medium text-text">No contacts yet</p>
                      <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-mute">
                        Everything you add here is encrypted on this device before it
                        reaches the server.
                      </p>
                      {!isOffline ? (
                        <button type="button" className={`${btnPrimary} mt-5`} onClick={openComposer}>
                          <PlusIcon />
                          Add your first contact
                        </button>
                      ) : null}
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center rounded-xl border border-dashed border-line px-6 py-12 text-center animate-fade-in-up sm:py-16">
                      <p className="text-sm text-mute">
                        {bookNameById(addressBooks, bookFilter)} has no contacts yet.
                      </p>
                      <button type="button" className={`${ghost} mt-3`} onClick={() => setBookFilter(ALL_ADDRESS_BOOKS)}>
                        Show all address books
                      </button>
                    </div>
                  ) : (
                    <ul className="min-w-0 overflow-hidden rounded-xl border border-line/80 bg-panel/25">
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
                        />
                      ))}
                    </ul>
                  )}
                </div>

                <div className={`min-w-0 flex-col overflow-hidden px-4 py-4 sm:px-5 lg:flex lg:px-6 ${viewingContact ? "flex" : "hidden"}`}>
                  {viewingContact ? (
                    <ContactDetailModal
                      contact={viewingContact}
                      bookName={bookNameById(addressBooks, viewingContact.addressBookId)}
                      onDelete={() => promptDelete(viewingContact)}
                      onClose={() => setViewingContact(null)}
                      addressBooks={addressBooks}
                      busy={busy}
                      error={error}
                      onSave={onSaveViewedContact}
                      readOnly={isOffline}
                    />
                  ) : (
                    <div className="hidden min-h-56 items-center justify-center rounded-xl border border-dashed border-line bg-panel/20 px-6 text-center lg:flex">
                      <p className="max-w-xs text-sm leading-relaxed text-mute">
                        Select a contact to view their details.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>
        </main>
      ) : null}

      {/* Compose modal */}
      {contactsEnabled && composing ? (
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
      {contactsEnabled && editingContact ? (
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
            onDelete={() => promptDelete(editingContact)}
          />
        </Modal>
      ) : null}

      {/* Delete confirmation modal */}
      {contactsEnabled && deletingContact ? (
        <DeleteContactModal
          contact={deletingContact}
          busy={busy}
          error={error}
          onConfirm={onConfirmDelete}
          onClose={closeDelete}
        />
      ) : null}

      {/* Delete address book modal */}
      {contactsEnabled && deletingAddressBook ? (
        <DeleteAddressBookModal
          book={deletingAddressBook}
          destinationBooks={addressBooks.filter((book) => book.id !== deletingAddressBook.id)}
          contactCount={contacts.filter(
            (contact) => resolveAddressBookId(contact.addressBookId) === deletingAddressBook.id,
          ).length}
          busy={busy}
          error={error}
          onConfirm={(destinationId) => void onConfirmDeleteBook(destinationId)}
          onClose={closeDeleteBook}
        />
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

      {/* Idle lock warning. Any pointer/key activity also resets the timer. */}
      {idleCountdown !== null ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="pointer-events-auto flex w-full max-w-md items-center gap-4 rounded-xl border border-line-light bg-elevated px-4 py-3 shadow-2xl shadow-black/50 animate-slide-up">
            {/* Announced once on mount. The visible seconds sit outside this
                live region so assistive tech is not re-interrupted every tick. */}
            <p role="alert" className="sr-only">
              Your vault locks in one minute due to inactivity. Choose “Stay
              signed in” to keep working.
            </p>
            <div className="min-w-0 flex-1" aria-hidden="true">
              <p className="text-sm font-semibold text-text">Locking soon</p>
              <p className="mt-0.5 text-xs text-mute">
                Your vault locks in{" "}
                <span className="tabular-nums text-text">{idleCountdown}s</span> due to
                inactivity.
              </p>
            </div>
            <button
              type="button"
              className={btnSecondary}
              onClick={() => setIdleCountdown(null)}
            >
              Stay signed in
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}