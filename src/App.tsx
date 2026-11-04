import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSidebar } from "./components/SidebarDrawer";
import { useSplitPane } from "./components/SplitPane";
import { AddDeviceModal } from "./components/AddDeviceModal";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ContactForm } from "./components/ContactForm";
import { CalendarView } from "./components/CalendarView";
import { DeleteContactModal } from "./components/DeleteContactModal";
import { DeleteAddressBookModal } from "./components/DeleteAddressBookModal";
import { Modal } from "./components/Modal";
import { NotesView } from "./components/NotesView";
import { BookmarksView } from "./components/BookmarksView";
import { TasksView } from "./components/TasksView";
import { SettingsView, type SettingsSection } from "./components/SettingsView";
import { PasswordField } from "./components/PasswordField";
import { WelcomeModal } from "./components/WelcomeModal";
import { Logo } from "./components/AuthLayout";
import { PhraseScreen } from "./components/PhraseScreen";
import { PairScreen } from "./components/PairScreen";
import { RecoverScreen } from "./components/RecoverScreen";
import { AuthScreen, type Mode } from "./components/AuthScreen";
import { ContactsTab } from "./components/ContactsTab";
import { DecryptingScreen } from "./components/DecryptingScreen";
import {
  ContactsIcon,
  CalendarIcon,
  NotesIcon,
  BookmarksIcon,
  TasksIcon,
  SettingsIcon,
  DevicePlusIcon,
  RefreshIcon,
  LockIcon,
} from "./components/AppIcons";
import {
  completeRecoveryRotation,
  deleteAddressBook,
  deleteContact,
  ensureDefaultAddressBook,
  flushOutbox,
  listVault,
  listingFrom,
  loginAccount,
  normalizeServer,
  pairApprove,
  pairJoin,
  pairPreview,
  pairPoll,
  putAccountSettings,
  putAddressBook,
  putCalendar,
  putNotebook,
  putBookmarkCollection,
  putTaskList,
  putContact,
  recoverAccount,
  registerAccount,
  revokeSession,
  type Session,
  type VaultListing,
  type VaultProgress,
} from "./lib/client";
import {
  closeLocalStore,
  openLocalStore,
  rekeyLocalStore,
} from "./lib/localStore";
import {
  closeOutbox,
  currentOutbox,
  currentVault,
  localObjects,
  openOutbox,
  subscribeNotices,
  subscribeOutbox,
  subscribeRemoteChanges,
  type OutboxState,
} from "./lib/outbox";
import { sweepIfDue } from "./lib/attachmentSweep";
import { failedStatus } from "./lib/transport";
import { OutboxPanel } from "./components/OutboxPanel";
import {
  DEFAULT_ACCOUNT_SETTINGS,
  accentVariables,
  isDetailedContacts,
  isFeatureEnabled,
} from "./lib/accountSettings";
import { type OnboardingPlan } from "./lib/onboarding";
import { LINKABLE_SECTIONS, profileOf, type LinkableSection } from "./lib/contactProfile";
import {
  ARCHIVE_VIEW_NAME,
  DEFAULT_ADDRESS_BOOK_ID,
  activeAddressBooks,
  effectiveHiddenBooks,
  loadHiddenAddressBooks,
  loadShownArchivedBooks,
  pruneHiddenAddressBooks,
  resolveAddressBookId,
  storeHiddenAddressBooks,
  storeShownArchivedBooks,
  visibleAddressBooks,
} from "./lib/addressBook";
import { emptyDraft, sortContacts } from "./lib/contact";
import { coreContactIndex, type ContactSearchIndex } from "./lib/wasm";
import { extractRecoveryWords } from "./lib/phrase";
import { findInvalidBip39Words } from "./lib/bip39Words";
import { closeAttachmentCache, primeAttachmentCache } from "./lib/attachmentCache";
import {
  clearDevice,
  loadConnectionDomain,
  loadDevice,
  loadDeviceMetadata,
  loadUnverifiedLegacyDevice,
  OfflineUnavailableError,
  saveConnectionDomain,
  saveDevice,
  type DeviceMetadata,
} from "./lib/storage";
import { friendlyError } from "./lib/errors";
import { describeError, log, serverHost } from "./lib/log";
import {
  IDLE_BURST_THROTTLE_MS,
  IDLE_TIMEOUT_MS,
  IDLE_WARNING_MS,
  loadLastTab,
  loadOnboarding,
  loadTimezone,
  rememberBrowserTimezone,
  saveLastTab,
  saveOnboarding,
  TIMEZONE_KEY,
  type MainTab,
} from "./lib/appState";
import {
  btnSecondary,
  focusRing,
  shell,
} from "./lib/styles";
import { mergeTaskLists, mergeTasks } from "./lib/task";
import { DEFAULT_CALENDAR_COLOR } from "./lib/types";
import type {
  AccountSettings,
  AddressBook,
  Calendar,
  CalendarEvent,
  Contact,
  ContactDraft,
  ContactProfile,
  DeviceState,
  FeatureKey,
  Note,
  Notebook,
  Bookmark,
  BookmarkCollection,
  Task,
  TaskList,
  TaskPatch,
} from "./lib/types";

type Screen = "auth" | "phrase" | "pair" | "recover";

// StrictMode runs a mount effect twice in development, and two startup lines
// read as two loads.
let startupLogged = false;

const TABS: { id: MainTab; label: string; icon: React.ReactNode }[] = [
  { id: "contacts", label: "Contacts", icon: <ContactsIcon /> },
  { id: "calendar", label: "Calendar", icon: <CalendarIcon /> },
  { id: "notes", label: "Notes", icon: <NotesIcon /> },
  { id: "bookmarks", label: "Bookmarks", icon: <BookmarksIcon /> },
  { id: "tasks", label: "Tasks", icon: <TasksIcon /> },
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
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unopened, setUnopened] = useState(0);
  const [session, setSession] = useState<Session | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [addressBooks, setAddressBooks] = useState<AddressBook[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [bookmarkCollections, setBookmarkCollections] = useState<BookmarkCollection[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskFocusId, setTaskFocusId] = useState<string | undefined>();
  const [taskLists, setTaskLists] = useState<TaskList[]>([]);
  const [accountSettings, setAccountSettings] = useState<AccountSettings>(DEFAULT_ACCOUNT_SETTINGS);
  /** The settings payload last read, so a save merges onto it. */
  const accountSettingsRaw = useRef<string | undefined>(undefined);
  /**
   * The address books switched off in the sidebar, as `loadHiddenAddressBooks`
   * holds them. Loaded per collection once a vault is open, since the key is
   * the collection's, and `hiddenBooksCollection` records which one is loaded.
   */
  const [hiddenBooks, setHiddenBooks] = useState<Set<string>>(new Set());
  const [shownArchivedBooks, setShownArchivedBooks] = useState<Set<string>>(new Set());
  const [hiddenBooksCollection, setHiddenBooksCollection] = useState<string | null>(null);
  /**
   * Whether the list is showing the Archive instead of the address books. A
   * view rather than a book filter: an archived contact is out of every book
   * until it is restored, so the two cannot both be on.
   */
  const [viewingArchive, setViewingArchive] = useState(false);
  // Set by the sidebar's "+", read by the address book list to open its input.
  const [creatingBook, setCreatingBook] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [composing, setComposing] = useState(false);
  const [viewingContact, setViewingContact] = useState<Contact | null>(null);
  /**
   * Whether the detail pane has its edit form open. Owned here rather than in
   * the pane so that leaving the contact behind can be stopped first: the draft
   * lives in the form and is gone the moment it unmounts.
   */
  const [editingDetail, setEditingDetail] = useState(false);
  // The navigation an unsaved edit interrupted, replayed once it is discarded.
  const [pendingNav, setPendingNav] = useState<{ run: () => void } | null>(null);
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
  const [outboxState, setOutboxState] = useState<OutboxState>({ pending: 0, queued: [], failed: [], signIn: false });
  const [notices, setNotices] = useState<{ id: number; text: string }[]>([]);
  const [reviewingOutbox, setReviewingOutbox] = useState(false);
  const [loadingVault, setLoadingVault] = useState(false);
  /**
   * The stage the running vault read has reached, for the decrypting screen.
   * `vaultOpened` is what keeps that screen to the first read of a session: a
   * later refresh has data on screen already and uses the in-place indicators.
   */
  const [vaultProgress, setVaultProgress] = useState<VaultProgress | null>(null);
  const [vaultOpened, setVaultOpened] = useState(false);
  const [idleCountdown, setIdleCountdown] = useState<number | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [onboarding, setOnboardingState] = useState(loadOnboarding);
  // Set when the welcome hands the user off to an importer, so Settings opens on
  // that feature's section instead of the account one.
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  // An interrupted recovery leaves the vault key unrotated, so the phrase that
  // was used still opens it. The banner asks for the password to finish.
  const [finishingRecovery, setFinishingRecovery] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const headerRef = useRef<HTMLDivElement>(null);
  const unlockPasswordRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [tabPillRect, setTabPillRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  // One sidebar state for the whole shell, so contacts, calendar and notes
  // share the collapse rather than each reappearing on switching tabs. Below
  // `lg` the sidebar is a slide-over rather than a column.
  const sidebar = useSidebar();
  // Remembered for the session, not for good: see `useSplitPane`.
  const contactsSplit = useSplitPane("sealbook.contacts-split");

  useEffect(() => {
    if (startupLogged) return;
    startupLogged = true;
    log.info("app ready", {
      server: connectionDomain ? serverHost(connectionDomain) : "unset",
      enrolled: Boolean(initial),
      online: navigator.onLine,
      timezone,
    });
    if (!connectionDomain) {
      log.info("no server configured yet; showing the connection setup screen");
    }
    // Startup state only, so it is not repeated on every later change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  useEffect(() => {
    if (!viewingContact) setEditingDetail(false);
  }, [viewingContact]);

  // The in-app guards cannot see a reload or a closed tab, so the browser's own
  // prompt stands in for them while an edit is open.
  useEffect(() => {
    if (!editingDetail) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editingDetail]);

  function setActiveTab(tab: MainTab) {
    setActiveTabState(tab);
    saveLastTab(tab);
    if (tab !== "settings") {
      setSettingsSection(null);
    }
  }

  function setOnboarding(pending: boolean) {
    setOnboardingState(pending);
    saveOnboarding(pending);
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
      log.info("connection domain set", { server: serverHost(server) });
      setError(null);
      return true;
    } catch (err) {
      log.warn("rejected a connection domain", { reason: describeError(err) });
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

  // Tracks the active tab button so the pill behind it can slide to match,
  // rather than snapping. Also runs on resize: the label that widens a
  // button only shows above `sm`, and the nav itself wraps on narrow screens.
  useLayoutEffect(() => {
    const track = () => {
      const button = tabRefs.current[activeTab];
      if (!button) return;
      setTabPillRect({
        left: button.offsetLeft,
        top: button.offsetTop,
        width: button.offsetWidth,
        height: button.offsetHeight,
      });
    };
    track();
    window.addEventListener("resize", track);
    return () => window.removeEventListener("resize", track);
  }, [activeTab, visibleTabs]);

  const contactsEnabled = isFeatureEnabled(accountSettings, "contacts");
  const detailedContacts = isDetailedContacts(accountSettings);

  // The sidebar's switched-off books are stored per collection, so they can only
  // be read once a vault is open, and are dropped again when one is signed out.
  //
  // Adjusted during render rather than in an effect: the read is a synchronous
  // one from localStorage, and an effect would let the first render go out
  // with every book still showing, flashing the hidden contacts for a frame.
  const collectionId = session?.state.collection_id ?? null;
  if (hiddenBooksCollection !== collectionId) {
    setHiddenBooksCollection(collectionId);
    setHiddenBooks(collectionId ? loadHiddenAddressBooks(collectionId) : new Set());
    setShownArchivedBooks(collectionId ? loadShownArchivedBooks(collectionId) : new Set());
  }

  const listHiddenBooks = useMemo(
    () => effectiveHiddenBooks(addressBooks, hiddenBooks, shownArchivedBooks),
    [addressBooks, hiddenBooks, shownArchivedBooks],
  );

  const archivedContacts = useMemo(
    () => contacts.filter((contact) => contact.archived === true),
    [contacts],
  );

  // A full pass over every contact, so the typed value is deferred: the field
  // stays responsive on a vault the filter takes time over.
  const deferredSearch = useDeferredValue(search);

  // Core reads every card once into an index, so a keystroke is one lookup.
  // Built in an effect, because a memoised index is freed by the cleanup and
  // then reused when the effect re-runs, which StrictMode does on mount.
  const [searchIndex, setSearchIndex] = useState<ContactSearchIndex | null>(null);
  useEffect(() => {
    const index = coreContactIndex(
      [...contacts, ...archivedContacts],
      addressBooks.map(({ id, name }) => ({ id, name })),
    );
    setSearchIndex(index);
    return () => index.free();
  }, [addressBooks, archivedContacts, contacts]);

  const filtered = useMemo(() => {
    // Hidden rather than shown is what is matched, so a contact whose book was
    // deleted out from under it still appears instead of vanishing. The archive
    // ignores the book filter: an archived contact is in no book's view.
    const inBook = viewingArchive
      ? archivedContacts
      : contacts.filter(
        (contact) =>
          contact.archived !== true &&
          !listHiddenBooks.has(resolveAddressBookId(contact.addressBookId)),
      );
    if (!deferredSearch.trim()) return sortContacts(inBook);
    if (searchIndex === null) return [];
    const rank = new Map(searchIndex.search(deferredSearch).map((id, place) => [id, place]));
    return inBook
      .filter((contact) => rank.has(contact.id))
      .sort((a, b) => (rank.get(a.id) as number) - (rank.get(b.id) as number));
  }, [archivedContacts, contacts, deferredSearch, listHiddenBooks, searchIndex, viewingArchive]);

  const shownBooks = useMemo(
    () => visibleAddressBooks(addressBooks, listHiddenBooks),
    [addressBooks, listHiddenBooks],
  );
  /**
   * Where exactly one book is showing it stands in for the whole view: it
   * titles the list and is what a new contact lands in.
   */
  const soleShownBook = shownBooks.length === 1 ? shownBooks[0] : null;
  const contactsTitle = hiddenBooks.size === 0 && shownArchivedBooks.size === 0
    ? "All contacts"
    : soleShownBook
      ? soleShownBook.name
      : shownBooks.length === 0
        ? "No address books shown"
        : `${shownBooks.length} address books`;
  const listTitle = viewingArchive ? ARCHIVE_VIEW_NAME : contactsTitle;

  // The accent is a vault preference, so the shell can only be tinted once the
  // settings are open; until then it keeps the `--sb-accent*` defaults declared
  // in index.css, which the theme's accent tokens resolve through.
  // Every token is rewritten on each change, and signing out restores the
  // default settings, so the override needs no teardown of its own.
  useEffect(() => {
    const root = document.documentElement;
    for (const [token, value] of Object.entries(accentVariables(accountSettings.accent))) {
      root.style.setProperty(token, value);
    }
  }, [accountSettings.accent]);

  // Poll for pairing approval. Stops when the request expires.
  useEffect(() => {
    if (screen !== "pair" || !pairId || pairApproved) {
      return;
    }
    let cancelled = false;
    let timer = 0;

    const tick = async () => {
      const next = await pairPoll("", pairId);
      if (cancelled) return;
      if (next === "Ready") {
        setPairApproved(true);
      } else if (next === "Expired") {
        setError("That pairing request expired. Start again.");
      } else {
        timer = window.setTimeout(() => {
          void tick();
        }, next.Wait.after_ms);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
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
        log.info("locking the vault after an idle timeout", { minutes: IDLE_TIMEOUT_MS / 60000 });
        void lock();
      }, IDLE_TIMEOUT_MS);
    };

    // Reading a long note is activity, but a wheel fires none of the events
    // below, so the vault used to lock mid-read. These two reset on a throttle
    // rather than rescheduling three timers per event, and `scroll` is taken in
    // the capture phase because it does not bubble out of the app's own panes.
    let lastBurstReset = 0;
    const resetFromBurst = () => {
      const now = Date.now();
      if (now - lastBurstReset < IDLE_BURST_THROTTLE_MS) return;
      lastBurstReset = now;
      resetIdleTimer();
    };

    const events = ["pointerdown", "keydown", "touchstart"] as const;
    const burstEvents = ["wheel", "scroll"] as const;
    const burstOptions = { capture: true, passive: true } as const;
    events.forEach((event) => window.addEventListener(event, resetIdleTimer));
    burstEvents.forEach((event) => window.addEventListener(event, resetFromBurst, burstOptions));
    resetIdleTimer();
    return () => {
      clearTimers();
      setIdleCountdown(null);
      events.forEach((event) => window.removeEventListener(event, resetIdleTimer));
      burstEvents.forEach((event) =>
        window.removeEventListener(event, resetFromBurst, burstOptions),
      );
    };
    // `lock` is redeclared every render, so listing it here would tear down and
    // rebuild these timers on every render and the vault would never reach the
    // idle timeout. The only state it reads is `session`, which is already a
    // dependency, so the one it closes over is never stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const handleOffline = () => {
      log.info("the browser went offline");
      setOnline(false);
    };
    const handleOnline = () => {
      log.info("the browser came back online", { reconnecting: session?.offline === true });
      setOnline(true);
      if (!session) return;
      if (!session.offline) {
        void sync(session);
        return;
      }
      if (password) void reconnect(session);
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
    // As above: `refresh` is redeclared every render, and the only state it
    // reads is `password`, which is already a dependency. It takes the session
    // to load as an argument rather than closing over one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password, session]);

  /** Signs in again with the held password, then sends what is queued. */
  async function reconnect(current: Session) {
    try {
      const reconnected = await loginAccount(current.state, password);
      setSession(reconnected);
      await refresh(reconnected);
    } catch (err) {
      log.warn("could not reconnect; still showing this device's copy", {
        reason: describeError(err),
      });
    }
  }

  /** Sends what is queued, and re-lists if anything went. */
  async function sync(current: Session) {
    if (current.offline || currentOutbox().writes.length === 0) return;
    try {
      const report = await flushOutbox(current);
      if (report.stopped !== "retry") showLocal(current);
    } catch (err) {
      log.warn("queued changes could not be sent", { reason: describeError(err) });
    }
  }

  useEffect(() => subscribeOutbox(setOutboxState), []);

  useEffect(
    () =>
      subscribeNotices((text) =>
        setNotices((current) => [...current, { id: Date.now() + Math.random(), text }]),
      ),
    [],
  );

  useEffect(() => {
    if (!session) return;
    return subscribeRemoteChanges(() => showLocal(session));
    // `showLocal` reads only setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    if (!session || session.offline || outboxState.pending === 0) return;
    const timer = window.setInterval(() => void sync(session), 60_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, outboxState.pending]);

  useEffect(() => {
    if (!session || !outboxState.signIn || !password) return;
    void reconnect(session);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, outboxState.signIn]);

  async function openSession(next: Session, passwordForStorage: string) {
    await saveDevice(next.state, passwordForStorage);
    primeAttachmentCache(passwordForStorage);
    openLocalStore(passwordForStorage);
    setStored(next.state);
    setSession(next);
    await refresh(next);
  }

  async function persistSession(next: Session, passwordForStorage: string) {
    await saveDevice(next.state, passwordForStorage);
    primeAttachmentCache(passwordForStorage);
    await rekeyLocalStore(passwordForStorage);
    setPassword(passwordForStorage);
    setStored(next.state);
    setSession(next);
  }

  async function refresh(next: Session, selectContactId?: string) {
    setLoadingVault(true);
    let listed: VaultListing;
    let books;
    let fromServer = false;
    try {
      if (next.offline) {
        await openOutbox(next.state.collection_id);
        listed = listingFrom(localObjects(), 0);
      } else {
        await flushOutbox(next).catch((err: unknown) => {
          log.warn("queued changes could not be sent before listing", {
            reason: describeError(err),
          });
        });
        try {
          listed = await listVault(next, setVaultProgress);
          fromServer = true;
        } catch (err) {
          if (failedStatus(err) !== 0) throw err;
          log.warn("the server could not be reached; listing this device's copy", {
            reason: describeError(err),
          });
          listed = listingFrom(localObjects(), 0);
        }
      }
      books = await ensureDefaultAddressBook(next, listed.addressBooks);
    } finally {
      setLoadingVault(false);
      setVaultProgress(null);
      setVaultOpened(true);
    }
    applyListing(next, listed, books, selectContactId);
    if (fromServer) {
      void sweepIfDue(next, listed).catch((err: unknown) => {
        log.warn("the attachment sweep failed", { reason: describeError(err) });
      });
    }
  }

  /** Re-lists from this device's copy, without reading the server. */
  function showLocal(current: Session) {
    const listed = listingFrom(localObjects(), unopened);
    applyListing(current, listed, listed.addressBooks);
  }

  function applyListing(
    next: Session,
    listed: VaultListing,
    books: AddressBook[],
    selectContactId?: string,
  ) {
    setAddressBooks(books);
    setContacts(listed.contacts);
    // The pane holds a contact, not an id, so without this it keeps the copy it
    // opened with. `selectContactId` moves the pane to a different contact,
    // such as one just created.
    setViewingContact((current) => {
      const wanted = selectContactId ?? current?.id;
      return wanted
        ? listed.contacts.find((contact) => contact.id === wanted) ?? current
        : null;
    });
    setCalendarEvents(listed.calendarEvents);
    setCalendars(listed.calendars);
    setNotes(listed.notes);
    setNotebooks(listed.notebooks);
    setBookmarks(listed.bookmarks);
    setBookmarkCollections(listed.bookmarkCollections);
    setTasks(listed.tasks);
    setTaskLists(listed.taskLists);
    setAccountSettings(listed.accountSettings);
    accountSettingsRaw.current = listed.accountSettingsRaw;
    setUnopened(listed.unopened);
    setHiddenBooks((current) => {
      const pruned = pruneHiddenAddressBooks(books, current);
      if (pruned.size === current.size) return current;
      storeHiddenAddressBooks(next.state.collection_id, pruned);
      return pruned;
    });
    setShownArchivedBooks((current) => {
      const pruned = pruneHiddenAddressBooks(books, current);
      if (pruned.size === current.size) return current;
      storeShownArchivedBooks(next.state.collection_id, pruned);
      return pruned;
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

  /**
   * Folds one task action's writes into the lists. A full `refresh` per write
   * walks and decrypts the whole collection, which ticking a checkbox does not
   * warrant; `TasksView` re-reads once the writing has stopped.
   */
  function applyTaskPatch(patch: TaskPatch) {
    if (patch.tasks || patch.removedTaskIds) {
      setTasks((current) => mergeTasks(current, patch.tasks ?? [], patch.removedTaskIds));
    }
    if (patch.taskLists || patch.removedTaskListIds) {
      setTaskLists((current) =>
        mergeTaskLists(current, patch.taskLists ?? [], patch.removedTaskListIds),
      );
    }
  }

  async function onSaveAccountSettings(next: AccountSettings) {
    if (!session) return;
    await putAccountSettings(session, next, accountSettingsRaw.current);
    setAccountSettings(next);
  }

  /**
   * Applies the welcome's choices. The settings object goes first so a failure
   * there cannot leave containers behind for a feature the account did not keep.
   * Returns the message for the dialog to show, or null once everything is in.
   */
  async function onFinishOnboarding(
    plan: OnboardingPlan,
    jumpTo: FeatureKey | null,
  ): Promise<string | null> {
    if (!session) {
      return "This vault is locked. Sign in again to finish setting up.";
    }
    try {
      await putAccountSettings(session, plan.settings, accountSettingsRaw.current);
      setAccountSettings(plan.settings);
      for (const name of plan.addressBooks) {
        await putAddressBook(session, name);
      }
      for (const name of plan.calendars) {
        await putCalendar(session, { name, color: DEFAULT_CALENDAR_COLOR, favorite: false });
      }
      for (const name of plan.notebooks) {
        await putNotebook(session, name);
      }
      for (const name of plan.collections) {
        await putBookmarkCollection(session, name);
      }
      for (const name of plan.taskLists) {
        await putTaskList(session, name);
      }
      await refreshAfterSave(session);
      setOnboarding(false);
      // Only the features with a settings section of their own can be jumped
      // to; bookmarks has nothing to import, so the welcome just closes.
      if (jumpTo && jumpTo !== "bookmarks") {
        setSettingsSection(jumpTo);
        setActiveTab("settings");
      }
      return null;
    } catch (err) {
      return friendlyError(err);
    }
  }

  // Refresh after a successful write. A refresh failure is reported separately
  // so it isn't mistaken for a failed save. Returns whether the refresh worked.
  async function refreshAfterSave(next: Session, selectContactId?: string): Promise<boolean> {
    try {
      await refresh(next, selectContactId);
      return true;
    } catch (err) {
      log.error("the write succeeded but the vault could not be re-read", {
        reason: describeError(err),
      });
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
    setVaultOpened(false);
    setVaultProgress(null);
    setUnopened(0);
    setContacts([]);
    setCalendarEvents([]);
    setCalendars([]);
    setAddressBooks([]);
    setNotes([]);
    setNotebooks([]);
    setBookmarks([]);
    setBookmarkCollections([]);
    setTasks([]);
    setTaskLists([]);
    setAccountSettings(DEFAULT_ACCOUNT_SETTINGS);
    setHiddenBooks(new Set());
    setViewingArchive(false);
    setAdding(false);
    setAddConfirm(null);
    setAddCode("");
    setComposing(false);
    setViewingContact(null);
    setEditingDetail(false);
    setPendingNav(null);
    setDeletingContact(null);
    setDeletingAddressBook(null);
    setSearch("");
    setError(null);
  }

  // Re-reads the vault from the server on demand. `refresh` owns the loading
  // flag, so the button only has to report a failure.
  async function onRefreshVault() {
    if (!session) return;
    setError(null);
    try {
      await refresh(session);
    } catch (err) {
      log.warn("the manual refresh could not read the vault", {
        reason: describeError(err),
      });
      setError("Couldn't refresh the vault. Check your connection and try again.");
    }
  }

  async function lock() {
    const active = session;
    setSession(null);
    setPassword("");
    closeAttachmentCache();
    closeOutbox();
    closeLocalStore();
    resetVaultState();
    if (active) {
      try {
        await revokeSession(active);
      } catch (err) {
        // Local lock still protects the in-memory vault if the server is unavailable.
        log.warn("the server session could not be revoked on lock", {
          reason: describeError(err),
        });
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
    await clearDevice();
    setOnboarding(false);
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
    if (!stored || busy) {
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
          throw new OfflineUnavailableError(
            "Connect to the server once to finish securing this device's stored keys.",
          );
        }
        await openSession(await loginAccount(legacy, password), password);
        return;
      }
      openLocalStore(password);
      if (navigator.onLine) {
        try {
          await openSession(await loginAccount(unlocked, password), password);
          return;
        } catch (err) {
          if (failedStatus(err) !== 0) throw err;
          log.warn("the server could not be reached at unlock; opening this device's copy", {
            reason: describeError(err),
          });
        }
      }
      const offline: Session = {
        state: unlocked,
        collectionKey: "",
        token: "",
        latestRevision: 0,
        keyEpoch: 0,
        manifestSeq: 0,
        offline: true,
      };
      await openOutbox(unlocked.collection_id);
      if (currentVault().objects.length === 0 && currentOutbox().writes.length === 0) {
        throw new OfflineUnavailableError(
          "Connect to the server once before using the vault offline.",
        );
      }
      const listed = listingFrom(localObjects(), 0);
      log.info("opened this device's copy offline", {
        objects: currentVault().objects.length,
        queued: currentOutbox().writes.length,
      });
      primeAttachmentCache(password);
      applyListing(offline, listed, listed.addressBooks);
      setVaultOpened(true);
      setSession(offline);

    } catch (err) {
      setError(friendlyError(err));
      // Disabling the field while busy blurs it, so once it is re-enabled the
      // wrong attempt is handed straight back for the next try rather than
      // leaving the user to click back into it. Deferred past the next paint
      // so it runs after `busy` has actually cleared the `disabled` attribute.
      requestAnimationFrame(() => {
        unlockPasswordRef.current?.focus();
        unlockPasswordRef.current?.select();
      });
    } finally {
      setBusy(false);
    }
  }

  async function onRegister(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
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
      primeAttachmentCache(password);
      openLocalStore(password);
      setStored(next.state);
      setSession(next);
      setPhrase(words);
      setScreen("phrase");
      setOnboarding(true);
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
      const id = await putContact(session, draft);
      setFormKey((key) => key + 1);
      setComposing(false);
      await refreshAfterSave(session, id);
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

      // Sync bidirectional links: compare old vs new contactId sets in family/friends/colleagues.
      // Accumulated per target and written once, since a target linked in two
      // sections by one save would otherwise read its pre-save profile twice.
      const oldProfile = profileOf(viewingContact.profile);
      const newProfile = profileOf(draft.profile);
      const updates = new Map<string, { target: Contact; profile: ContactProfile }>();
      const profileFor = (target: Contact) =>
        updates.get(target.id)?.profile ?? profileOf(target.profile);
      for (const section of LINKABLE_SECTIONS) {
        const oldIds = new Set(oldProfile[section].map((p) => p.contactId).filter(Boolean) as string[]);
        const newIds = new Set(newProfile[section].map((p) => p.contactId).filter(Boolean) as string[]);
        for (const addedId of newIds) {
          if (oldIds.has(addedId)) continue;
          const target = contacts.find((c) => c.id === addedId);
          if (!target) continue;
          const targetProfile = profileFor(target);
          if (targetProfile[section].some((p) => p.contactId === viewingContact.id)) continue;
          const reverse = { id: crypto.randomUUID(), name: draft.name || viewingContact.name, contactId: viewingContact.id };
          updates.set(target.id, {
            target,
            profile: { ...targetProfile, [section]: [...targetProfile[section], reverse] },
          });
        }
        for (const removedId of oldIds) {
          if (newIds.has(removedId)) continue;
          const target = contacts.find((c) => c.id === removedId);
          if (!target) continue;
          const targetProfile = profileFor(target);
          const filtered = targetProfile[section].filter((p) => p.contactId !== viewingContact.id);
          if (filtered.length === targetProfile[section].length) continue;
          updates.set(target.id, { target, profile: { ...targetProfile, [section]: filtered } });
        }
      }
      for (const { target, profile } of updates.values()) {
        await putContact(session, { ...target, profile }, target.id);
      }

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

  async function onLinkInSection(section: LinkableSection, targetId: string): Promise<void> {
    if (!session || !viewingContact) return;
    const target = contacts.find((c) => c.id === targetId);
    if (!target) return;
    const currentProfile = profileOf(viewingContact.profile);
    if (currentProfile[section].some((p) => p.contactId === targetId)) return;
    const targetProfile = profileOf(target.profile);
    const newForCurrent = { id: crypto.randomUUID(), name: target.name, contactId: targetId };
    const newForTarget = { id: crypto.randomUUID(), name: viewingContact.name, contactId: viewingContact.id };
    const updatedCurrentProfile = { ...currentProfile, [section]: [...currentProfile[section], newForCurrent] };
    const updatedTargetProfile = { ...targetProfile, [section]: [...targetProfile[section], newForTarget] };
    setBusy(true);
    setError(null);
    try {
      await putContact(session, { ...viewingContact, profile: updatedCurrentProfile }, viewingContact.id);
      await putContact(session, { ...target, profile: updatedTargetProfile }, target.id);
      setViewingContact((current) =>
        current?.id === viewingContact.id ? { ...current, profile: updatedCurrentProfile } : current,
      );
      await refreshAfterSave(session);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onUnlinkFromSection(section: LinkableSection, contactId: string): Promise<void> {
    if (!session || !viewingContact) return;
    const target = contacts.find((c) => c.id === contactId);
    const currentProfile = profileOf(viewingContact.profile);
    const updatedCurrentProfile = {
      ...currentProfile,
      [section]: currentProfile[section].filter((p) => p.contactId !== contactId),
    };
    setBusy(true);
    setError(null);
    try {
      await putContact(session, { ...viewingContact, profile: updatedCurrentProfile }, viewingContact.id);
      if (target) {
        // Only the section being unlinked, so a pair linked in several keeps the rest.
        const targetProfile = profileOf(target.profile);
        const filtered = targetProfile[section].filter((p) => p.contactId !== viewingContact.id);
        if (filtered.length !== targetProfile[section].length) {
          await putContact(
            session,
            { ...target, profile: { ...targetProfile, [section]: filtered } },
            target.id,
          );
        }
      }
      setViewingContact((current) =>
        current?.id === viewingContact.id ? { ...current, profile: updatedCurrentProfile } : current,
      );
      await refreshAfterSave(session);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Moves one contact into the Archive, or back out of it. `archived` is
   * cleared rather than written false, so a restored card reads as one that was
   * never archived.
   */
  async function onToggleArchive(contact: Contact): Promise<void> {
    if (!session) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await putContact(
        session,
        { ...contact, archived: contact.archived ? undefined : true },
        contact.id,
      );
      if (viewingContact?.id === contact.id) {
        setViewingContact(null);
      }
      await refreshAfterSave(session);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
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

      // Every section, since the card the reverse link points at is now gone.
      for (const other of contacts) {
        if (other.id === deletingContact.id) continue;
        const profile = profileOf(other.profile);
        const cleaned = { ...profile };
        let changed = false;
        for (const section of LINKABLE_SECTIONS) {
          const filtered = profile[section].filter((p) => p.contactId !== deletingContact.id);
          if (filtered.length === profile[section].length) continue;
          cleaned[section] = filtered;
          changed = true;
        }
        if (changed) {
          await putContact(session, { ...other, profile: cleaned }, other.id);
        }
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

  async function onCreateBookmarkCollection(
    name: string,
    parentId?: string,
  ): Promise<string | undefined> {
    if (!session || !name.trim()) {
      return undefined;
    }
    setBusy(true);
    setError(null);
    try {
      const id = await putBookmarkCollection(session, name.trim(), parentId);
      await refreshAfterSave(session);
      return id;
    } catch (err) {
      setError(friendlyError(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  /**
   * Switches one address book on or off in the contact list.
   *
   * From the archive the click only leaves it, without taking the book it
   * landed on out of the list: these rows hide rather than show, so toggling
   * one on the way back would answer "show me my books again" with everything
   * except the book that was clicked.
   */
  function toggleBookVisibility(id: string) {
    if (viewingArchive) {
      setViewingArchive(false);
      return;
    }
    const archived = addressBooks.some((book) => book.id === id && book.archived === true);
    const update = archived ? setShownArchivedBooks : setHiddenBooks;
    const store = archived ? storeShownArchivedBooks : storeHiddenAddressBooks;
    update((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      if (session) store(session.state.collection_id, next);
      return next;
    });
  }

  function showAllBooks() {
    setViewingArchive(false);
    setHiddenBooks(new Set());
    if (session) storeHiddenAddressBooks(session.state.collection_id, new Set());
  }

  /**
   * Drops a book's recorded toggle, so a deleted book cannot be inherited by a
   * later one and an archived or restored one starts at its group's default.
   */
  function forgetBookVisibility(id: string) {
    for (const [update, store] of [
      [setHiddenBooks, storeHiddenAddressBooks],
      [setShownArchivedBooks, storeShownArchivedBooks],
    ] as const) {
      update((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        if (session) store(session.state.collection_id, next);
        return next;
      });
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
      await refreshAfterSave(session);
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
      const previous = addressBooks.find((book) => book.id === id);
      await putAddressBook(session, name, id, previous?.raw, previous?.archived === true);
      await refreshAfterSave(session);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onToggleBookArchived(book: AddressBook): Promise<void> {
    if (!session || book.id === DEFAULT_ADDRESS_BOOK_ID) return;
    setBusy(true);
    setError(null);
    try {
      await putAddressBook(session, book.name, book.id, book.raw, book.archived !== true);
      forgetBookVisibility(book.id);
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
      forgetBookVisibility(book.id);
      setDeletingAddressBook(null);
      await refreshAfterSave(session);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Runs `action` unless the detail pane is mid-edit, in which case it is held
   * until the user confirms losing the draft.
   */
  function guardEditing(action: () => void) {
    if (!editingDetail) {
      action();
      return;
    }
    setPendingNav({ run: action });
  }

  function openComposer() {
    setError(null);
    setFormKey((key) => key + 1);
    setViewingArchive(false);
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
    return (
      <PhraseScreen
        phrase={phrase}
        connectionDomain={connectionDomain}
        saveDomain={saveDomain}
        error={error}
        onDone={() => {
          setPhrase("");
          setScreen("auth");
        }}
      />
    );
  }

  // ---------- FIRST VAULT READ ----------
  // Below the phrase screen, which has to win: registration shows the recovery
  // words before awaiting its own read, and they must not be taken away. Above
  // pair and recover, whose reads are the first on a device and so the longest.
  if (loadingVault && !vaultOpened) {
    return <DecryptingScreen progress={vaultProgress} />;
  }

  // ---------- PAIR SCREEN ----------
  if (screen === "pair") {
    return (
      <PairScreen
        connectionDomain={connectionDomain}
        saveDomain={saveDomain}
        error={error}
        pairId={pairId}
        pairConfirm={pairConfirm}
        pairApproved={pairApproved}
        password={password}
        busy={busy}
        copied={copied}
        onPasswordChange={setPassword}
        onCopied={setCopied}
        onSubmit={onPairLogin}
        onBack={backToAuth}
        onGoToRecover={() => {
          setScreen("recover");
          setError(null);
        }}
      />
    );
  }

  // ---------- RECOVER SCREEN ----------
  if (screen === "recover") {
    return (
      <RecoverScreen
        connectionDomain={connectionDomain}
        saveDomain={saveDomain}
        error={error}
        username={username}
        phrase={phrase}
        password={password}
        busy={busy}
        onUsernameChange={setUsername}
        onPhraseChange={setPhrase}
        onPasswordChange={setPassword}
        onSubmit={onRecover}
        onBack={backToAuth}
      />
    );
  }

  // ---------- UNLOCK / REGISTER / SIGN-IN SCREEN ----------
  if (!session) {
    return (
      <AuthScreen
        connectionDomain={connectionDomain}
        saveDomain={saveDomain}
        error={error}
        mode={mode}
        stored={stored}
        locked={locked}
        username={username}
        password={password}
        confirmPassword={confirmPassword}
        busy={busy}
        signingOut={signingOut}
        unlockPasswordRef={unlockPasswordRef}
        onModeChange={(m) => {
          setMode(m);
          setError(null);
        }}
        onUsernameChange={setUsername}
        onPasswordChange={setPassword}
        onConfirmPasswordChange={setConfirmPassword}
        onUnlock={onUnlock}
        onRegister={onRegister}
        onPairJoin={onPairJoin}
        onConfirmSignOut={confirmSignOut}
        onSignOut={() => void signOut()}
        onCloseSignOut={() => setSigningOut(false)}
        onGoToRecover={() => {
          setScreen("recover");
          setError(null);
        }}
      />
    );
  }

  // ---------- MAIN SHELL ----------
  return (
    <div className="min-h-screen">
      {/* Sticky header with accent top line */}
      <div ref={headerRef} className="sticky top-0 z-40">
        {isOffline || outboxState.pending > 0 ? (
          <div
            className={`border-b px-5 py-2 text-center text-xs font-medium ${
              isOffline
                ? "border-red-400/20 bg-red-500/10 text-red-300"
                : "border-line bg-surface/60 text-mute"
            }`}
            role="status"
          >
            {isOffline ? "You're offline. Changes are kept on this device. " : null}
            {outboxState.pending > 0
              ? `${outboxState.pending} change${outboxState.pending === 1 ? "" : "s"} waiting to sync.`
              : isOffline
                ? "They will sync when you reconnect."
                : null}
          </div>
        ) : null}
        {outboxState.failed.length > 0 ? (
          <div className="border-b border-amber-400/25 bg-amber-500/10 px-5 py-2 text-center text-xs font-medium text-amber-200" role="alert">
            {outboxState.failed.length} change{outboxState.failed.length === 1 ? "" : "s"} couldn't
            sync.{" "}
            <button
              type="button"
              className="underline underline-offset-2 cursor-pointer"
              onClick={() => setReviewingOutbox(true)}
            >
              Review
            </button>
          </div>
        ) : null}
        {unopened > 0 ? (
          <div className="border-b border-amber-400/25 bg-amber-500/10 px-5 py-2 text-center text-xs font-medium text-amber-200" role="alert">
            {unopened} item{unopened === 1 ? "" : "s"} in this vault could not be opened by this
            device, so {unopened === 1 ? "it is" : "they are"} not shown. Nothing has been changed.
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
              className="relative order-3 flex w-full items-center justify-center rounded-xl border border-line bg-surface/80 p-1 sm:order-none sm:w-auto"
              aria-label="Main Navigation"
            >
              {/* Slides to the active tab's button instead of each button
                  owning its own background, so the highlight moves rather
                  than jumping. Hidden until a size is measured so it never
                  flashes at the top-left corner on first paint. */}
              <span
                aria-hidden="true"
                className="absolute rounded-lg bg-accent shadow-sm transition-[left,top,width,height] duration-200 ease-out"
                style={
                  tabPillRect
                    ? { left: tabPillRect.left, top: tabPillRect.top, width: tabPillRect.width, height: tabPillRect.height }
                    : { display: "none" }
                }
              />
              {visibleTabs.map((tab) => (
                <button
                  key={tab.id}
                  ref={(el) => {
                    tabRefs.current[tab.id] = el;
                  }}
                  type="button"
                  aria-current={activeTab === tab.id ? "page" : undefined}
                  aria-label={tab.label}
                  title={tab.label}
                  className={`relative z-10 inline-flex min-w-0 flex-none items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors duration-150 cursor-pointer sm:px-3 ${focusRing} ${activeTab === tab.id
                      ? "text-bg"
                      : "text-mute hover:text-text hover:bg-surface/50"
                    }`}
                  onClick={() => guardEditing(() => setActiveTab(tab.id))}
                >
                  {tab.icon}
                  {/* Five tabs of icon-and-label do not fit a phone, so below
                      `sm` only the current one is named. The rest keep their
                      icon, with the label on the button for a screen reader. */}
                  <span className={activeTab === tab.id ? "truncate" : "hidden sm:inline"}>
                    {tab.label}
                  </span>
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
              {!isOffline ? <button
                type="button"
                aria-label="Refresh vault"
                title="Refresh vault"
                disabled={loadingVault}
                className={`inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface/70 px-2.5 py-1.5 text-xs font-medium text-text transition-all duration-150 hover:bg-surface hover:border-line-light cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 sm:px-3 ${focusRing}`}
                onClick={() =>
                  guardEditing(() => {
                    void onRefreshVault();
                  })
                }
              >
                <span className={loadingVault ? "animate-spin" : undefined}>
                  <RefreshIcon />
                </span>
                <span className="hidden sm:inline">Refresh</span>
              </button> : null}
              <button
                type="button"
                className={`inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-bg shadow-sm transition-all duration-150 hover:brightness-110 active:scale-[0.98] cursor-pointer ${focusRing}`}
                onClick={lock}
              >
                <LockIcon />
                Lock
              </button>
            </div>
          </div>
        </header>
      </div>

      {activeTab === "settings" ? (
        <main className={`${shell} px-4 pb-24 pt-6 sm:px-5`}>
          <SettingsView
            session={session}
            contacts={contacts}
            addressBooks={addressBooks}
            calendars={calendars}
            calendarEvents={calendarEvents}
            notes={notes}
            notebooks={notebooks}
            bookmarks={bookmarks}
            bookmarkCollections={bookmarkCollections}
            tasks={tasks}
            taskLists={taskLists}
            onSessionUpdate={(updated) => setSession(updated)}
            onPersistSession={persistSession}
            onAccountDeleted={() => {
              signOut();
            }}
            onSignOut={() => {
              void signOut();
            }}
            onRefresh={() => refresh(session)}
            onCreateBook={onCreateBook}
            onCreateNotebook={onCreateNotebook}
            onCreateBookmarkCollection={(name) => onCreateBookmarkCollection(name)}
            offline={isOffline}
            pendingChanges={outboxState.pending + outboxState.failed.length}
            timezone={timezone}
            onTimezoneChange={setTimezone}
            accountSettings={accountSettings}
            onSaveAccountSettings={onSaveAccountSettings}
            initialSection={settingsSection ?? undefined}
          />
        </main>
      ) : activeTab === "calendar" ? (
        <div>
          <CalendarView session={session} calendars={calendars} events={calendarEvents} contacts={contacts} busy={busy} timezone={timezone} onRefresh={() => refresh(session)} sidebar={sidebar} dueTasks={isFeatureEnabled(accountSettings, "tasks") ? tasks : undefined} onOpenTask={(id) => guardEditing(() => { setTaskFocusId(id); setActiveTab("tasks"); })} />
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
            offline={isOffline}
            outbox={outboxState}
            sidebar={sidebar}
          />
        </div>
      ) : activeTab === "bookmarks" ? (
        <div>
          <BookmarksView
            session={session}
            bookmarks={bookmarks}
            collections={bookmarkCollections}
            busy={busy}
            onRefresh={() => refresh(session)}
            onCreateCollection={onCreateBookmarkCollection}
            sidebar={sidebar}
          />
        </div>
      ) : activeTab === "tasks" ? (
        <div>
          <TasksView
            session={session}
            tasks={tasks}
            taskLists={taskLists}
            busy={busy}
            timezone={timezone}
            onRefresh={() => refresh(session)}
            onApply={applyTaskPatch}
            sidebar={sidebar}
            focusTaskId={taskFocusId}
            onFocusHandled={() => setTaskFocusId(undefined)}
          />
        </div>
      ) : activeTab === "contacts" ? (
        <ContactsTab
          session={session!}
          isOffline={isOffline}
          sidebar={sidebar}
          contactsSplit={contactsSplit}
          contacts={contacts}
          filtered={filtered}
          addressBooks={addressBooks}
          hiddenBooks={listHiddenBooks}
          shownArchivedBooks={shownArchivedBooks}
          archivedContacts={archivedContacts}
          viewingContact={viewingContact}
          editingDetail={editingDetail}
          creatingBook={creatingBook}
          loadingVault={loadingVault}
          error={error}
          busy={busy}
          search={search}
          soleShownBook={soleShownBook}
          listTitle={listTitle}
          viewingArchive={viewingArchive}
          detailedContacts={detailedContacts}
          composing={composing}
          deletingContact={deletingContact}
          deletingAddressBook={deletingAddressBook}
          onSetCreatingBook={setCreatingBook}
          onOpenComposer={openComposer}
          onGuardEditing={guardEditing}
          onToggleBookVisibility={toggleBookVisibility}
          onShowAllBooks={showAllBooks}
          onCreateBook={onCreateBook}
          onRenameBook={onRenameBook}
          onToggleBookArchived={onToggleBookArchived}
          onDeleteBook={onDeleteBook}
          onSetSearch={setSearch}
          onSetViewingContact={(c) => setViewingContact(c)}
          onSetError={setError}
          onSetViewingArchive={(v) => setViewingArchive(v)}
          onSetEditingDetail={setEditingDetail}
          onPromptDelete={promptDelete}
          onToggleArchive={onToggleArchive}
          onSaveViewedContact={onSaveViewedContact}
          onLinkInSection={onLinkInSection}
          onUnlinkFromSection={onUnlinkFromSection}
          onNavigateToContact={(c) => { guardEditing(() => { setError(null); setViewingContact(c); }); }}
        />
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
              soleShownBook && soleShownBook.archived !== true
                ? soleShownBook.id
                : DEFAULT_ADDRESS_BOOK_ID,
            )}
            submitLabel="Add contact"
            detailed={detailedContacts}
            onSubmit={onAdd}
            onCancel={closeComposer}
          />
        </Modal>
      ) : null}

      {/* Leaving a contact mid-edit */}
      {pendingNav ? (
        <ConfirmDialog
          title="Unsaved changes"
          heading="Discard your changes to this contact?"
          body="The contact is still open for editing. Anything you have typed since you started is lost, and the saved contact is left as it was."
          confirmLabel="Discard changes"
          cancelLabel="Keep editing"
          onConfirm={() => {
            const next = pendingNav;
            setPendingNav(null);
            setEditingDetail(false);
            next.run();
          }}
          onClose={() => setPendingNav(null)}
        />
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
          destinationBooks={activeAddressBooks(addressBooks).filter((book) => book.id !== deletingAddressBook.id)}
          contactCount={contacts.filter(
            (contact) => resolveAddressBookId(contact.addressBookId) === deletingAddressBook.id,
          ).length}
          busy={busy}
          error={error}
          onConfirm={(destinationId) => void onConfirmDeleteBook(destinationId)}
          onClose={closeDeleteBook}
        />
      ) : null}

      {/* First-run welcome, shown over the normal UI after registration */}
      {onboarding ? (
        <WelcomeModal
          username={username}
          onComplete={onFinishOnboarding}
          onDismiss={() => setOnboarding(false)}
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
              Your vault locks in one minute due to inactivity. Choose "Stay
              signed in" to keep working.
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

      {notices.length > 0 ? (
        <div className="pointer-events-none fixed bottom-0 right-0 z-[65] flex w-full max-w-sm flex-col gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {notices.map((notice) => (
            <div
              key={notice.id}
              role="status"
              className="pointer-events-auto flex items-start gap-3 rounded-xl border border-line-light bg-elevated px-4 py-3 text-xs leading-relaxed text-text shadow-2xl shadow-black/50 animate-slide-up"
            >
              <p className="min-w-0 flex-1">{notice.text}</p>
              <button
                type="button"
                aria-label="Dismiss"
                className="shrink-0 text-mute hover:text-text cursor-pointer"
                onClick={() => setNotices((current) => current.filter((item) => item.id !== notice.id))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {reviewingOutbox && outboxState.failed.length > 0 ? (
        <OutboxPanel
          session={session}
          failed={outboxState.failed}
          onClose={() => setReviewingOutbox(false)}
          onRetry={() => {
            setReviewingOutbox(false);
            void sync(session);
          }}
        />
      ) : null}
    </div>
  );
}
