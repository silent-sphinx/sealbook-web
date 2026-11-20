import { passwordProblem } from "./appState";

export interface PasswordStrength {
  score: number;
  acceptable: boolean;
  warning?: string;
  suggestions: string[];
}

type StrengthModule = {
  default: (input?: { module_or_path: unknown }) => Promise<unknown>;
  password_strength: (password: string, username: string) => PasswordStrength;
};

let loading: Promise<StrengthModule> | null = null;

/**
 * Loads zxcvbn's module on first use. Its dictionaries are about as large as the
 * whole crypto module, so only the screens that set a password pay for them.
 * Tests replace the loader.
 */
let load = async (): Promise<StrengthModule> => {
  const module = (await import("../pkg-strength/sealbook_strength.js")) as unknown as StrengthModule;
  await module.default();
  return module;
};

/** Test seam: swaps how the module is loaded. */
export function setStrengthLoader(loader: () => Promise<StrengthModule>): void {
  load = loader;
  loading = null;
}

export async function passwordStrength(password: string, username: string): Promise<PasswordStrength> {
  loading ??= load().catch((err) => {
    loading = null;
    throw err;
  });
  const module = await loading;
  return module.password_strength(password, username);
}

/**
 * Why a new password is refused, or null. The length and common-password floor
 * runs first because it needs no module. The server cannot make this check:
 * under OPAQUE it never sees the password, so this is the only place it sits.
 */
export async function newPasswordProblem(password: string, username: string): Promise<string | null> {
  const floor = passwordProblem(password);
  if (floor) return floor;
  let strength: PasswordStrength;
  try {
    strength = await passwordStrength(password, username);
  } catch {
    // Failing closed: a password nobody could check is not one to set.
    return "Couldn't check the password's strength. Reload the page and try again.";
  }
  if (strength.acceptable) return null;
  return ["That password is too easy to guess.", strength.warning, ...strength.suggestions]
    .filter(Boolean)
    .join(" ");
}
