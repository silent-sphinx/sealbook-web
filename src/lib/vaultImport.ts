import type { AccountImportObject } from "./accountExport";

const MAX_IMPORT_BATCH = 256;
const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

export function paddedLength(payloadBytes: number): number {
  const len = payloadBytes + 4;
  for (const bucket of [256, 512, 1024, 2048, 4096, 8192, 16384, 32768]) {
    if (bucket >= len) return bucket;
  }
  return 2 ** Math.ceil(Math.log2(len));
}

export function importBatches(objects: AccountImportObject[]): AccountImportObject[][] {
  const batches: AccountImportObject[][] = [];
  let batch: AccountImportObject[] = [];
  let bytes = 0;
  for (const object of objects) {
    const size = paddedLength(new TextEncoder().encode(object.payload).length);
    if (batch.length > 0 && (batch.length === MAX_IMPORT_BATCH || bytes + size > MAX_IMPORT_BYTES)) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(object);
    bytes += size;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}