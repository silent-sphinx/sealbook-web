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
