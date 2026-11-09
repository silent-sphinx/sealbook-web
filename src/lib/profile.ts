// The server's self-described crypto posture, and the check a client runs before
// it authenticates or sends anything identifying. Mirrors `profile.rs` in
// sealbook-protocol; there is no codegen between the two, so the pairing is kept
// by the tests in profile.test.ts rather than by the compiler. The profile is
// self-reported over TLS, so a dishonest server can lie about every field; what
// makes the check bite is an honestly misconfigured server, and the pinned
// posture that catches a server weakening itself between visits.

import { PROTOCOL_VERSION, speaksProtocol } from "./protocol";

export const OBJECT_AEAD = "XChaCha20-Poly1305-256";
export const TLS_VERSION = "TLS1.3";
export const TLS_KX = "X25519MLKEM768";
export const SIGNATURE_ALGORITHMS = ["ML-DSA-65", "Ed25519"] as const;
export const HPKE_CIPHERSUITE = "hpke-xwing-sha256-chacha20poly1305";
export const OPAQUE_KSF = "argon2id-m65536-t3-p1";
export const PHRASE_SCHEME = "hybrid-mldsa65-ed25519-v1";
export const RECOVERY_CIPHERSUITE = "aead-recovery-argon2id-m65536-t3-p1";

export interface CryptoProfile {
  protocol?: string;
  tls_version?: string;
  tls_kx_preferred?: string;
  tls_kx_pq_required?: boolean;
  hpke_ciphersuite?: string;
  signature_algorithms?: string[];
  object_aead?: string;
  phrase_recovery_scheme?: string;
  recovery_ciphersuite?: string;
  opaque_ksf?: string;
  opaque_requires_device_proof?: boolean;
}

export type Severity = "fatal" | "warn";

/**
 * How much of the transport a client controls. The web and the Firefox
 * extension hand TLS to the browser, so they cannot require the post-quantum
 * key exchange; a server that reports it does not require it is a warning there,
 * and a hard stop on the native clients.
 */
export type Transport = "native" | "browser";

export interface ProfileFinding {
  field: string;
  severity: Severity;
  expected: string;
  reported: string;
  message: string;
}

export interface PinnedPosture {
  tls_kx_pq_required: boolean;
  opaque_requires_device_proof: boolean;
}

export function pinnedPostureFromProfile(p: CryptoProfile): PinnedPosture {
  return {
    tls_kx_pq_required: p.tls_kx_pq_required ?? false,
    opaque_requires_device_proof: p.opaque_requires_device_proof ?? false,
  };
}

export function hasFatal(findings: readonly ProfileFinding[]): boolean {
  return findings.some((f) => f.severity === "fatal");
}

function absent(field: string, expected: string): ProfileFinding {
  return {
    field,
    severity: "warn",
    expected,
    reported: "absent",
    message:
      `This server's health profile left out ${field}, or it could not be read. ` +
      "The server may be older or not a standard Sealbook build.",
  };
}

/**
 * Compares the server's advertised crypto posture against what this build
 * requires, before anything identifying is sent. `transport` decides the one
 * field whose severity depends on the client; `pinned` is the posture accepted
 * for this server before, if any, so a flag that was required then and is not
 * now is fatal whatever the transport.
 */
export function evaluateCryptoProfile(
  reported: CryptoProfile,
  transport: Transport,
  pinned?: PinnedPosture,
): ProfileFinding[] {
  const findings: ProfileFinding[] = [];

  const exact = (
    field: string,
    expected: string,
    got: string | undefined,
    message: (got: string) => string,
  ): void => {
    if (got === undefined) {
      findings.push(absent(field, expected));
    } else if (got !== expected) {
      findings.push({ field, severity: "fatal", expected, reported: got, message: message(got) });
    }
  };

  if (reported.protocol === undefined) {
    findings.push(absent("protocol", PROTOCOL_VERSION));
  } else if (!speaksProtocol(reported.protocol)) {
    findings.push({
      field: "protocol",
      severity: "fatal",
      expected: PROTOCOL_VERSION,
      reported: reported.protocol,
      message:
        `This server speaks ${reported.protocol}. This app speaks ${PROTOCOL_VERSION}. ` +
        "Update whichever is older, then connect again.",
    });
  }

  exact(
    "object_aead",
    OBJECT_AEAD,
    reported.object_aead,
    (got) =>
      `This server seals objects with ${got}. This app only reads ${OBJECT_AEAD}. ` +
      "They cannot exchange data, so nothing was sent.",
  );

  const sigs = reported.signature_algorithms;
  if (sigs === undefined) {
    findings.push(absent("signature_algorithms", SIGNATURE_ALGORITHMS.join(", ")));
  } else if (
    sigs.length !== SIGNATURE_ALGORITHMS.length ||
    !sigs.every((s, i) => s === SIGNATURE_ALGORITHMS[i])
  ) {
    findings.push({
      field: "signature_algorithms",
      severity: "fatal",
      expected: SIGNATURE_ALGORITHMS.join(", "),
      reported: sigs.join(", "),
      message:
        `This server signs with ${sigs.join(" and ")}. This app verifies ${SIGNATURE_ALGORITHMS.join(" and ")}. ` +
        "Without both, it cannot trust what the server serves.",
    });
  }

  exact(
    "hpke_ciphersuite",
    HPKE_CIPHERSUITE,
    reported.hpke_ciphersuite,
    (got) =>
      `This server wraps keys with ${got}. This app only uses ${HPKE_CIPHERSUITE}, ` +
      "so it cannot share a key with this server.",
  );

  exact(
    "opaque_ksf",
    OPAQUE_KSF,
    reported.opaque_ksf,
    (got) =>
      `This server stretches passwords with ${got} instead of ${OPAQUE_KSF}. ` +
      "A weaker setting makes guessing your password from stolen server data easier. " +
      "Sealbook will not register or sign in here.",
  );

  if (reported.tls_kx_pq_required === undefined) {
    findings.push(absent("pq_required", "true"));
  } else if (reported.tls_kx_pq_required === false) {
    if (pinned?.tls_kx_pq_required) {
      findings.push({
        field: "pq_required",
        severity: "fatal",
        expected: "true (pinned)",
        reported: "false",
        message:
          "When you first connected to this server it required post-quantum TLS. It now " +
          "reports that it does not. A server that weakens its own security between visits is " +
          "a warning sign. Sealbook will not continue unless you accept the change.",
      });
    } else if (transport === "native") {
      findings.push({
        field: "pq_required",
        severity: "fatal",
        expected: "true",
        reported: "false",
        message:
          "This server reports that it does not require the post-quantum key exchange. " +
          "Sealbook treats that as unsafe and will not connect.",
      });
    } else {
      findings.push({
        field: "pq_required",
        severity: "warn",
        expected: "true",
        reported: "false",
        message:
          "This server reports that it does not require the post-quantum key exchange. Your " +
          "browser cannot verify the key exchange, so it cannot rule out a downgrade. Continue " +
          "only if you trust this server and your network.",
      });
    }
  }

  if (reported.opaque_requires_device_proof === false) {
    if (pinned?.opaque_requires_device_proof) {
      findings.push({
        field: "device_proof",
        severity: "fatal",
        expected: "true (pinned)",
        reported: "false",
        message:
          "This server previously required devices to prove they hold their keys before a " +
          "sign-in and now does not. Sealbook will not continue unless you accept the change.",
      });
    } else {
      findings.push({
        field: "device_proof",
        severity: "warn",
        expected: "true",
        reported: "false",
        message:
          "This server does not require devices to prove they hold their keys before it answers " +
          "a sign-in. Your own device still proves it, so your account is not directly weaker, " +
          "but the policy is looser than Sealbook recommends.",
      });
    }
  }

  if (reported.tls_version !== undefined && reported.tls_version !== TLS_VERSION) {
    findings.push({
      field: "tls_version",
      severity: "warn",
      expected: TLS_VERSION,
      reported: reported.tls_version,
      message: `This server reports TLS ${reported.tls_version}. Sealbook expects ${TLS_VERSION}.`,
    });
  }

  if (
    reported.phrase_recovery_scheme !== undefined &&
    reported.phrase_recovery_scheme !== PHRASE_SCHEME
  ) {
    findings.push({
      field: "phrase_recovery_scheme",
      severity: "warn",
      expected: PHRASE_SCHEME,
      reported: reported.phrase_recovery_scheme,
      message:
        `This server advertises a recovery method (${reported.phrase_recovery_scheme}) this app ` +
        "does not recognize. You can sign in, but restoring this account from your phrase might fail.",
    });
  }

  if (
    reported.recovery_ciphersuite !== undefined &&
    reported.recovery_ciphersuite !== RECOVERY_CIPHERSUITE
  ) {
    findings.push({
      field: "recovery_ciphersuite",
      severity: "warn",
      expected: RECOVERY_CIPHERSUITE,
      reported: reported.recovery_ciphersuite,
      message:
        "This server advertises a recovery encryption this app does not recognize. " +
        "Recovery from your phrase might fail.",
    });
  }

  return findings;
}
