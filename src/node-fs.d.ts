/**
 * The node APIs the test suite uses.
 *
 * The suites run in node, where the wasm module and the shared fixtures are
 * read from files rather than fetched. Declaring them here keeps `@types/node`
 * out of the app's type graph, which has no use for it: the app runs in a
 * browser.
 */
declare module "node:fs" {
  export function readFileSync(path: URL | string): Uint8Array;
  export function readFileSync(path: URL | string, encoding: "utf8"): string;
  export function writeFileSync(path: URL | string, data: string): void;
}

declare module "node:path" {
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
}

declare const process: {
  env: Record<string, string | undefined>;
  cwd(): string;
};
