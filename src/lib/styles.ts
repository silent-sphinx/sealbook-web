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
  `box-border w-full min-w-0 rounded-lg bg-accent py-2.5 text-sm font-semibold text-bg transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:hover:brightness-100 disabled:active:scale-100 ${focusRing}`;
export const secondary =
  `box-border w-full min-w-0 rounded-lg border border-line bg-surface py-2.5 text-sm text-mute transition-all duration-150 hover:border-line-light hover:text-text disabled:opacity-50 ${focusRing}`;
export const btnBase =
  `box-border inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-all duration-150 active:scale-[0.98] disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0 ${focusRing}`;
export const btnPrimary =
  `${btnBase} bg-accent px-4 py-2 text-bg hover:brightness-110`;
export const btnSecondary =
  `${btnBase} border border-line bg-surface px-4 py-2 text-mute font-medium hover:border-line-light hover:text-text`;
export const btnDanger =
  `${btnBase} bg-danger px-4 py-2 text-bg hover:brightness-110`;
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
  `flex h-6 w-6 items-center justify-center rounded-md text-mute transition-colors hover:bg-elevated ${focusRing}`;
export const sidebarRowState = (active: boolean) =>
  active ? "bg-surface text-text" : "text-mute hover:bg-surface/40 hover:text-text";
/** A row's leading mark: checkbox, swatch, dot or icon. */
export const sidebarMark = "flex h-4 w-4 shrink-0 items-center justify-center";
/** A tree row's disclosure column, ahead of its mark. */
export const sidebarGutter = "flex h-7 w-4 shrink-0 items-center justify-center";
/** Nested rows, hung off a guide line under the parent's leading column. */
export const sidebarChildren = "ml-2 mt-0.5 space-y-0.5 border-l border-line pl-2";
/** A secondary group at the foot of a section, such as an archive. */
export const sidebarSubgroup = "mt-2.5 border-t border-line pt-2.5";
export const sidebarCount = "pr-1 text-[10px] tabular-nums text-mute/70";
export const sidebarNameInput =
  "h-8 w-full min-w-0 rounded-lg border border-accent-dim bg-bg px-2 text-xs text-text outline-none ring-1 ring-accent-ring placeholder:text-mute/60";
