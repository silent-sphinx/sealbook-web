// Compares an older release's reader dump with this tree's.
// A field the older reader has must read the same in both; fields only this tree
// knows are ignored, since an older client cannot be expected to show them.
import { readFileSync } from "node:fs";

const [olderPath, newerPath, release, acceptedPath] = process.argv.slice(2);
const older = JSON.parse(readFileSync(olderPath, "utf8"));
const newer = JSON.parse(readFileSync(newerPath, "utf8"));

const accepted = new Set(
  readFileSync(acceptedPath, "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"))
    .filter((line) => line.split("\t")[0] === release)
    .map((line) => line.split("\t").slice(1).join("\t")),
);

function caseName(key) {
  return key
    .slice(key.indexOf("] ") + 2)
    .replace(/ \(mutant \d+\)$/, "")
    .replace(/^"(.*)"$/, "$1");
}

// Whether `now` reads every field `was` has, at every depth. Row ids below the
// top level are made up by each reader and are not compared.
function covers(was, now) {
  if (Array.isArray(was)) {
    return Array.isArray(now) && was.length === now.length && was.every((item, i) => covers(item, now[i]));
  }
  if (was && typeof was === "object") {
    return (
      now !== null &&
      typeof now === "object" &&
      Object.keys(was).every((key) => key === "id" || covers(was[key], now[key]))
    );
  }
  return was === now;
}

let failures = 0;
for (const [key, { view: was }] of Object.entries(older)) {
  const now = newer[key]?.view;
  const problems = [];
  if (was && typeof was === "object" && "threw" in was) {
    problems.push(`older reader threw: ${was.threw}`);
  } else if (now === undefined) {
    problems.push("missing from this tree's dump");
  } else {
    for (const field of Object.keys(was ?? {})) {
      if (accepted.has(`${field}\t${caseName(key)}`)) continue;
      if (!covers(was[field], now?.[field])) {
        problems.push(`${field}: older ${JSON.stringify(was[field])}, now ${JSON.stringify(now?.[field])}`);
      }
    }
  }
  if (problems.length) {
    failures += 1;
    console.log(`${key}\n  ${problems.join("\n  ")}`);
  }
}

const total = Object.keys(older).length;
console.log(`${failures} of ${total} payloads read differently by the older release`);
process.exit(failures ? 1 : 0);
