/**
 * The colours a collection can be given, one row per shade and one column per
 * hue. The middle row holds the tones core falls back to (`COLLECTION_TONES`
 * in `sealbook-core/src/bookmarks.rs`), so an uncoloured collection's tone is
 * always one of the swatches.
 */
export type Swatch = { name: string; hex: string };

const HUES: { name: string; light: string; base: string; deep: string }[] = [
  { name: "red", light: "#f7a8b8", base: "#f7768e", deep: "#c95a6e" },
  { name: "orange", light: "#ffc199", base: "#ff9e64", deep: "#d27b45" },
  { name: "amber", light: "#f2d29b", base: "#e0af68", deep: "#b4884b" },
  { name: "green", light: "#c3e88d", base: "#9ece6a", deep: "#78a44e" },
  { name: "teal", light: "#a8eadb", base: "#73daca", deep: "#4fae9f" },
  { name: "cyan", light: "#b4e5ff", base: "#7dcfff", deep: "#58a3d4" },
  { name: "blue", light: "#b4c8fb", base: "#7aa2f7", deep: "#5a7fcf" },
  { name: "indigo", light: "#c8c7fb", base: "#9d9cf7", deep: "#7473cf" },
  { name: "purple", light: "#d7c4fb", base: "#bb9af7", deep: "#9377cf" },
  { name: "pink", light: "#f5b8e6", base: "#f08fcf", deep: "#c06aa6" },
  { name: "slate", light: "#c0caf5", base: "#a9b1d6", deep: "#787c99" },
];

export const COLLECTION_PALETTE: Swatch[][] = [
  HUES.map((hue) => ({ name: `Light ${hue.name}`, hex: hue.light })),
  HUES.map((hue) => ({ name: capitalise(hue.name), hex: hue.base })),
  HUES.map((hue) => ({ name: `Deep ${hue.name}`, hex: hue.deep })),
];

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
