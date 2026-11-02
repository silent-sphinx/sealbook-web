import type { AccountImportObject } from "./accountExport";
import { coreWriteBatches } from "./wasm";

/** The objects in the batches core sizes for every client's batch writes. */
export function importBatches(objects: AccountImportObject[]): AccountImportObject[][] {
  const encoder = new TextEncoder();
  const counts = coreWriteBatches(objects.map((object) => encoder.encode(object.payload).length));
  const batches: AccountImportObject[][] = [];
  let start = 0;
  for (const count of counts) {
    batches.push(objects.slice(start, start + count));
    start += count;
  }
  return batches;
}
