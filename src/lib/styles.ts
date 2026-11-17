// Keyboard-only focus ring. `focus-visible` rather than `focus` so it does not
// fire on mouse clicks, and applied via the shared button tokens so every
// control gets the same indicator instead of the browser default.
export const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

export const fieldBase =
  "box-border h-10 w-full min-w-0 rounded-lg border border-line bg-bg px-3 py-2 text-sm text-text outline-none transition-colors duration-150 placeholder:text-mute/70 focus:border-accent-dim focus:ring-1 focus:ring-accent-ring";
export const field = `mt-1.5 ${fieldBase}`;
export const selectField =
  `${fieldBase} w-full min-w-0 shrink-0 cursor-pointer px-2 pr-6`;
export const primary =
  `box-border w-full min-w-0 rounded-lg bg-accent py-2.5 text-sm font-semibold text-bg transition-all duration-150 hover:brightness-110 hover:shadow-[0_6px_18px_-6px_var(--color-accent-ring)] disabled:hover:shadow-none active:scale-[0.98] disabled:opacity-50 disabled:hover:brightness-100 disabled:active:scale-100 ${focusRing}`;
export const secondary =
  `box-border w-full min-w-0 rounded-lg border border-line bg-surface py-2.5 text-sm text-mute transition-all duration-150 hover:border-line-light hover:text-text disabled:opacity-50 ${focusRing}`;
export const btnBase =
  `box-border inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-all duration-150 active:scale-[0.98] disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0 ${focusRing}`;
export const btnPrimary =
  `${btnBase} bg-accent px-4 py-2 text-bg hover:brightness-110 hover:shadow-[0_6px_18px_-6px_var(--color-accent-ring)] disabled:hover:shadow-none`;
export const btnSecondary =
  `${btnBase} border border-line bg-surface px-4 py-2 text-mute font-medium hover:border-line-light hover:text-text`;
export const btnDanger =
  `${btnBase} bg-danger px-4 py-2 text-bg hover:brightness-110`;
// Signed-out screens sit on a frameless column, so their controls are taller and
// carry their own surface rather than relying on a panel behind them.
export const authLabel = "block text-[13px] font-medium text-mute";
export const authField =
  "mt-1.5 box-border h-11 w-full min-w-0 rounded-xl border border-line-light/70 bg-surface/70 px-3.5 text-sm text-text outline-none shadow-[inset_0_1px_0_rgb(255_255_255/0.03)] transition-colors duration-150 placeholder:text-mute/60 hover:border-line-light focus:border-accent-dim focus:bg-surface focus:ring-2 focus:ring-accent-ring disabled:opacity-60";
export const authPrimary =
  `box-border flex h-11 w-full min-w-0 cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-accent-dim to-accent text-sm font-semibold text-bg shadow-[0_10px_28px_-12px_var(--color-accent),inset_0_1px_0_rgb(255_255_255/0.22)] transition-all duration-150 hover:brightness-110 active:scale-[0.99] disabled:cursor-default disabled:opacity-50 disabled:hover:brightness-100 disabled:active:scale-100 ${focusRing}`;
export const authSecondary =
  `box-border flex h-11 w-full min-w-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line-light/70 bg-surface/70 text-sm font-medium text-text transition-all duration-150 hover:border-line-light hover:bg-elevated active:scale-[0.99] disabled:opacity-50 ${focusRing}`;
export const fieldLabel = "block text-xs font-medium text-mute";
export const textAction =
  `rounded text-[11px] font-medium text-accent transition-colors hover:underline disabled:opacity-50 ${focusRing}`;
export const ghost =
  `text-sm text-mute transition-colors duration-150 hover:text-accent ${focusRing}`;
export const addLink = `${ghost} justify-self-start`;
export const iconButton =
  `flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg leading-none text-mute transition-all duration-150 hover:bg-surface hover:text-text ${focusRing}`;
export const card =
  "rounded-2xl border border-line bg-panel/80 backdrop-blur-sm p-5 transition-all duration-200 hover:border-line-light hover:bg-panel";
export const sectionBar =
  "border-l-2 border-accent/40 pl-3";
export const dangerButton =
  `box-border w-full min-w-0 rounded-lg bg-danger py-2.5 text-sm font-semibold text-bg transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:hover:brightness-100 disabled:active:scale-100 whitespace-nowrap ${focusRing}`;
// Width cap for the signed-in shell. Without it `mx-auto` is a no-op and rows
// stretch the full viewport, leaving name and badge hundreds of pixels apart on
// a wide monitor. The header uses the same cap so it stays aligned with content.
export const shell = "mx-auto w-full max-w-6xl";

// Sidebar tokens shared by every view's `SidebarDrawer` content. Rows bleed
// `-mx-2` past the column's padding so a mark sits on the section label's edge.
export const sidebarHeaderAction =
  `flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-text transition-colors hover:border-line-light hover:bg-elevated ${focusRing}`;
export const sidebarSectionAction =
  `flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`;
export const sidebarRowAction =
  `hit-area relative flex h-6 w-6 items-center justify-center rounded-md text-mute transition-colors hover:bg-elevated ${focusRing}`;
export const sidebarRowState = (active: boolean) =>
  active ? "bg-surface text-text" : "text-mute hover:bg-surface/40 hover:text-text";
/** A selection checkbox, in the accent colour. */
export const checkbox = "h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--color-accent)]";
/** A row's leading mark: checkbox, swatch, dot or icon. */
export const sidebarMark = "flex h-4 w-4 shrink-0 items-center justify-center";
/** A tree row's disclosure column, ahead of its mark. */
export const sidebarGutter = "flex h-7 w-4 shrink-0 items-center justify-center";
/** Nested rows, hung off a guide line under the parent's leading column. */
export const sidebarChildren = "ml-2 mt-0.5 space-y-0.5 border-l border-line pl-2";
/** A secondary group at the foot of a section, such as an archive. */
export const sidebarSubgroup = "mt-2.5 border-t border-line pt-2.5";
/** A pill tinted in a container's colour. */
export const tonePill = (tone: string) => ({
  color: `color-mix(in srgb, ${tone} 55%, var(--color-mute))`,
  borderColor: `color-mix(in srgb, ${tone} 22%, transparent)`,
  backgroundColor: `color-mix(in srgb, ${tone} 6%, transparent)`,
});
export const sidebarCount = "pr-1 text-[10px] tabular-nums text-mute/70";
export const sidebarNameInput =
  "h-8 w-full min-w-0 rounded-lg border border-accent-dim bg-bg px-2 text-xs text-text outline-none ring-1 ring-accent-ring placeholder:text-mute/60";

/** The bar above a view's list: title and count on the left, actions right. */
export const paneHeader =
  "flex flex-col gap-2.5 border-b border-line px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4 sm:px-5 sm:py-3.5 lg:px-6";
export const paneTitle = "truncate text-base font-semibold tracking-tight";
export const paneCount =
  "ml-1 shrink-0 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium tabular-nums text-mute";
/** The one creating action in a pane header. */
export const btnHeader =
  `flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-accent px-3.5 text-xs font-semibold text-bg transition-all duration-150 hover:brightness-110 hover:shadow-[0_6px_18px_-6px_var(--color-accent-ring)] disabled:hover:shadow-none active:scale-[0.98] disabled:opacity-50 ${focusRing}`;
/** A search box with a leading icon at `left-2.5`. */
export const searchField =
  "h-8 w-full min-w-0 rounded-lg border border-line bg-panel pl-8 pr-7 text-xs text-text outline-none transition-all duration-150 placeholder:text-mute/70 focus:border-accent-dim focus:ring-1 focus:ring-accent-ring [&::-webkit-search-cancel-button]:appearance-none";
export const searchIcon =
  "pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mute";
export const searchClear =
  `hit-area absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`;
/** A small uppercase section label. */
export const eyebrow = "text-[11px] font-semibold uppercase tracking-[0.14em] text-mute";
export const btnHeaderSecondary =
  `flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-medium text-mute transition-colors hover:border-line-light hover:text-text disabled:opacity-50 ${focusRing}`;
/** A small inline helper action, such as Copy or Paste. */
export const chipButton =
  `inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-text transition-all hover:border-line-light hover:text-accent active:scale-[0.98] cursor-pointer ${focusRing}`;
