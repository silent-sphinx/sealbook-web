/*
 * Shared class strings. The scales they draw on are fixed here and in the
 * `@theme` block of index.css, and nothing else should invent its own:
 *
 *   type      text-2xs 11 · text-xs 12 · text-sm 13 (UI base) · text-base 15
 *             · text-lg 17 · text-xl 20 · text-display 28
 *   radius    rounded-md in-row controls, chips, ticks · rounded-lg buttons,
 *             fields, rows, menu items · rounded-xl floating surfaces, dialogs,
 *             cards · rounded-full avatars, dots, switches
 *   height    24 in-row actions · 28 toolbars and pane headers · 32 form fields
 *             and dialog buttons · 40 signed-out screens
 *   layers    the `--z-*` variables declared on `html`
 *
 * There is no class merger, so a token never holds two utilities from the same
 * group and a caller only appends layout (`w-full`, `flex-1`, `ml-auto`). A
 * caller that needs another size takes the size variant instead.
 */

// ---------------------------------------------------------------- Foundations

// Keyboard-only focus ring. `focus-visible` rather than `focus` so it does not
// fire on mouse clicks, and applied via the shared tokens so every control gets
// the same indicator instead of the browser default.
export const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

/** A small uppercase section label. */
export const eyebrow = "text-2xs font-semibold uppercase tracking-[0.08em] text-mute";

// ---------------------------------------------------------------- Controls

const control = `box-border inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap transition-[color,background-color,border-color,box-shadow,filter] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${focusRing}`;

const sizeSm = "h-7 rounded-lg px-2.5 text-xs";
const sizeMd = "h-8 rounded-lg px-3 text-sm pointer-coarse:h-10";

const solid =
  "bg-accent font-semibold text-on-accent hover:brightness-110 hover:shadow-lift disabled:hover:brightness-100 disabled:hover:shadow-none";
const outline =
  "border border-line bg-surface font-medium text-text hover:border-line-light hover:bg-elevated";
const quiet = "font-medium text-mute hover:bg-hover hover:text-text";
const destructive = "bg-danger font-semibold text-on-accent hover:brightness-110";
const destructiveQuiet = "font-medium text-danger hover:bg-danger-soft";
const cautionary = "bg-warning font-semibold text-on-accent hover:brightness-110";

export const btnPrimary = `${control} ${sizeMd} ${solid}`;
export const btnSecondary = `${control} ${sizeMd} ${outline}`;
export const btnGhost = `${control} ${sizeMd} ${quiet}`;
export const btnDanger = `${control} ${sizeMd} ${destructive}`;
export const btnDangerGhost = `${control} ${sizeMd} ${destructiveQuiet}`;

/** Pane headers, toolbars and banners. */
export const btnPrimarySm = `${control} ${sizeSm} ${solid}`;
export const btnSecondarySm = `${control} ${sizeSm} ${outline}`;
export const btnGhostSm = `${control} ${sizeSm} ${quiet}`;
export const btnDangerGhostSm = `${control} ${sizeSm} ${destructiveQuiet}`;
export const btnWarningSm = `${control} ${sizeSm} ${cautionary}`;

/** A square icon-only control: pane headers, toolbars, dialog close. */
export const iconBtn = `${control} size-7 rounded-lg ${quiet}`;
/** `iconBtn` for a toggle that is on, such as a pinned or favourited state. */
export const iconBtnActive = `${control} size-7 rounded-lg font-medium text-accent hover:bg-hover`;
/** The danger form of `iconBtn`, for a delete that sits among other icons. */
export const iconBtnDanger = `${control} size-7 rounded-lg ${destructiveQuiet}`;
/** An icon inside a row, with its hit area widened past its drawn size. */
export const iconBtnXs = `hit-area relative ${control} size-6 rounded-md ${quiet}`;

/** An inline text action, such as "Show all" or "Copy". */
export const linkAction = `rounded-md text-xs font-medium text-accent underline-offset-2 transition-colors hover:underline disabled:opacity-50 ${focusRing}`;

/** A selection checkbox, in the accent colour. */
export const checkbox = "size-3.5 shrink-0 cursor-pointer accent-[var(--color-accent)]";

// ---------------------------------------------------------------- Fields

/** A field's surface with no height or padding, for the shapes below. */
export const fieldSurface =
  "box-border w-full min-w-0 rounded-lg border border-line bg-bg text-sm text-text outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-faint hover:border-line-light focus:border-accent-dim focus:ring-2 focus:ring-accent-ring disabled:cursor-not-allowed disabled:opacity-60";
export const fieldBase = `${fieldSurface} h-8 px-2.5 pointer-coarse:h-10`;
export const field = `mt-1.5 ${fieldBase}`;
/** A select at toolbar height, for a bar over a list. */
export const selectFieldSm = `${fieldSurface} h-7 shrink-0 cursor-pointer pl-2.5 pr-7 text-xs font-medium`;
export const selectField = `${fieldSurface} h-8 shrink-0 cursor-pointer pl-2.5 pr-7 pointer-coarse:h-10`;
export const textareaField = `${fieldSurface} min-h-22 px-2.5 py-2 leading-relaxed`;
export const fieldLabel = "block text-xs font-medium text-mute";

/** A search box with a leading icon at `left-2.5`. */
export const searchField =
  "h-7 w-full min-w-0 rounded-lg border border-line bg-surface/60 pl-8 pr-7 text-xs text-text outline-none transition-[border-color,box-shadow,background-color,width] duration-150 placeholder:text-faint hover:border-line-light focus:border-accent-dim focus:bg-bg focus:ring-2 focus:ring-accent-ring [&::-webkit-search-cancel-button]:appearance-none";
export const searchIcon =
  "pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-mute";
export const searchClear = `hit-area absolute right-0.5 top-1/2 -translate-y-1/2 ${control} size-6 rounded-md ${quiet}`;

// ---------------------------------------------------------------- Surfaces

/** The surface of every floating panel: menus, palettes, hover cards, suggestion lists. */
export const popoverSurface = "rounded-xl border border-line-light bg-elevated shadow-popover";
/** `popoverSurface` with the padding a list of rows wants. */
export const popover = `${popoverSurface} p-1`;
export const menuItem =
  "flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 text-left text-sm outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-40";
/** The colour half of a menu row, apart from `menuItem` so danger does not stack two text colours. */
export const menuItemTone = (danger = false) =>
  danger
    ? "text-danger hover:bg-danger-soft focus-visible:bg-danger-soft"
    : "text-text hover:bg-hover focus-visible:bg-hover disabled:hover:bg-transparent";
/** The dimmed backdrop behind a dialog or the drawer. */
export const scrim = "bg-black/60 backdrop-blur-sm";

export const badge =
  "inline-flex h-5 shrink-0 items-center gap-1 rounded-md border px-1.5 text-2xs font-medium leading-none";
export const badgeTone = {
  neutral: "border-line bg-surface text-mute",
  accent: "border-transparent bg-accent-soft text-accent",
  success: "border-transparent bg-success-soft text-success",
  warning: "border-transparent bg-warning-soft text-warning",
  danger: "border-transparent bg-danger-soft text-danger",
} as const;

/** A pill tinted in a container's colour. */
export const tonePill = (tone: string) => ({
  color: `color-mix(in srgb, ${tone} 55%, var(--color-mute))`,
  borderColor: `color-mix(in srgb, ${tone} 22%, transparent)`,
  backgroundColor: `color-mix(in srgb, ${tone} 6%, transparent)`,
});

// ---------------------------------------------------------------- Panes and lists

/**
 * A view's root. The shell is a full-height flex column, so a view takes what
 * the banners leave and scrolls inside itself; no view needs to know how tall
 * the chrome around it is.
 */
export const viewMain = "flex min-h-0 flex-1 flex-col overflow-hidden text-text";
/** The sidebar and content tracks inside a view; the columns come from `.sb-shell`. */
export const viewGrid = "sb-shell grid min-h-0 flex-1";

/** The bar above a view's list: title and count on the left, actions right. */
export const paneHeader =
  "flex flex-col gap-2 border-b border-line px-(--sb-gutter) py-2.5 sm:min-h-(--sb-bar-h) sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:py-2";
export const paneTitle = "truncate text-base font-semibold tracking-tight";
export const paneCount =
  "ml-1 shrink-0 rounded-md bg-surface px-1.5 text-2xs font-medium leading-5 tabular-nums text-mute";

/**
 * A full-bleed list row. The left edge is reserved in every state so the
 * current row's accent edge does not shift its content.
 */
export const listRow =
  "list-row relative flex min-w-0 items-center gap-3 border-b border-l-2 border-b-line/60 px-(--sb-gutter) transition-colors duration-150";
export const listRowState = ({ current, checked }: { current: boolean; checked?: boolean }) =>
  checked
    ? "border-l-transparent bg-accent-soft"
    : current
      ? "border-l-accent bg-surface/70"
      : "border-l-transparent hover:bg-hover";

/**
 * The trailing controls of a row that show on hover or focus where there is a
 * pointer, and always where there is not. They stay in the document and the tab
 * order either way; the row needs the `group` class. A touch screen has no hover
 * to reveal them, so it shows them.
 */
export const rowReveal =
  "transition-opacity [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100";

/** A side pane beside a list; full screen below `lg`. */
export const detailPane =
  "flex min-w-0 flex-col overflow-hidden bg-bg animate-fade-in max-lg:fixed max-lg:inset-0 max-lg:z-(--z-overlay) max-lg:h-dvh max-lg:w-screen lg:h-full lg:min-h-0";

/** A toolbar shown over a list while items are selected. */
export const bulkBar =
  "flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b border-line bg-accent-faint px-(--sb-gutter) py-1.5";

export const segmented = "inline-flex h-7 shrink-0 items-stretch rounded-lg bg-surface p-0.5";
export const segment = (active: boolean) =>
  `inline-flex min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2.5 text-xs transition-colors ${focusRing} ${
    active ? "bg-elevated font-medium text-text shadow-raised" : "text-mute hover:text-text"
  }`;

// ---------------------------------------------------------------- Sidebar

// Shared by every view's `SidebarDrawer` content. Rows bleed `-mx-2` past the
// column's padding so a mark sits on the section label's edge.
export const sidebarRow =
  "-mx-2 flex h-8 w-[calc(100%+1rem)] items-center gap-2.5 rounded-lg px-2 text-left text-sm font-medium transition-colors";
/** `quiet` marks the ancestor of the selection rather than the selection itself. */
export const sidebarRowState = (active: boolean, quiet = false) =>
  active
    ? quiet
      ? "bg-surface text-text"
      : "bg-accent-soft text-text"
    : "text-mute hover:bg-hover hover:text-text";
/** A row's leading mark: checkbox, swatch, dot or icon. */
export const sidebarMark = "flex size-4 shrink-0 items-center justify-center";
/** A tree row's disclosure column, ahead of its mark. */
export const sidebarGutter = "flex h-7 w-4 shrink-0 items-center justify-center";
/** Nested rows, hung off a guide line under the parent's leading column. */
export const sidebarChildren = "ml-2 mt-0.5 space-y-0.5 border-l border-line pl-2";
/** A secondary group at the foot of a section, such as an archive. */
export const sidebarSubgroup = "mt-2.5 border-t border-line pt-2.5";
export const sidebarCount = "pr-1 text-2xs tabular-nums text-faint";
export const sidebarNameInput =
  "h-8 w-full min-w-0 rounded-lg border border-accent-dim bg-bg px-2 text-sm text-text outline-none ring-2 ring-accent-ring placeholder:text-faint";

// ---------------------------------------------------------------- Signed-out

// Signed-out screens sit on a frameless column, so their controls are taller and
// carry their own translucent surface rather than relying on a panel behind them.
export const authLabel = "block text-sm font-medium text-mute";
export const authField =
  "mt-1.5 box-border h-10 w-full min-w-0 rounded-lg border border-line-light/70 bg-surface/70 px-3 text-sm text-text outline-none shadow-[inset_0_1px_0_rgb(255_255_255/0.03)] transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-faint hover:border-line-light focus:border-accent-dim focus:bg-surface focus:ring-2 focus:ring-accent-ring disabled:opacity-60";
export const authPrimary = `${control} h-10 w-full min-w-0 rounded-lg bg-gradient-to-r from-accent-dim to-accent px-4 text-sm font-semibold text-on-accent shadow-[0_10px_28px_-12px_var(--color-accent),inset_0_1px_0_rgb(255_255_255/0.22)] hover:brightness-110 disabled:hover:brightness-100`;
export const authSecondary = `${control} h-10 w-full min-w-0 rounded-lg border border-line-light/70 bg-surface/70 px-4 text-sm font-medium text-text hover:border-line-light hover:bg-elevated`;

// ---------------------------------------------------------------- Retiring


/** The "+" at the end of a sidebar section label. */
export const sidebarSectionAction = iconBtnXs;
/**
 * A row's own action. Without the quiet tone's hover colour, so a caller can
 * add its own (`hover:text-danger` for a delete) without two colours competing.
 */
export const sidebarRowAction = `hit-area relative ${control} size-6 rounded-md font-medium text-mute hover:bg-hover`;
/** A muted text-style action: "Clear search", "Add another". */
export const ghost = `rounded-md text-sm text-mute transition-colors hover:text-text ${focusRing}`;
/** `ghost` as a grid item that keeps to its own width. */
export const addLink = `${ghost} justify-self-start`;
