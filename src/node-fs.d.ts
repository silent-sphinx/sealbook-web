/**
 * The one node API the test suite uses.
 *
 * `client.test.ts` runs in node, where the wasm module is read from a file
 * rather than fetched, and that is all it needs node for. Declaring it here
 * keeps `@types/node` out of the app's type graph, which has no use for it: the
 * app runs in a browser.
 */
declare module "node:fs" {
  export function readFileSync(path: URL | string): Uint8Array;
}
