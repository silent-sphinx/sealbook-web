import type { Session } from "./client";
import { describeError, log } from "./log";
import { apiRoot, getText } from "./transport";
import {
  coreErrorOf,
  corePinRoster,
  coreRosterAccept,
  coreRosterAcceptSealed,
  coreRosterAnswersFor,
  coreRosterRequest,
} from "./wasm";
import type {
  CoreError,
  CoreRoster,
  RosterContext,
  VerifiedRoster,
} from "../pkg/sealbook_wasm.js";
import type {
  DevicePublic,
  DeviceState,
  Roster,
  RosterVerified,
} from "./types";

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

export class RosterTooOldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RosterTooOldError";
  }
}

const ROSTER_TOO_OLD =
  "This device is further behind than the server's device-list history reaches, so the " +
  "chain from the roster it pinned cannot be checked. Pair this device again to anchor " +
  "it on the current list.";

/**
 * Core's verdict as the class the callers of this module already catch.
 *
 * Core states the condition and the sentence is this client's, so the three
 * clients can word it for their own user without the decision differing.
 */
function rosterFailure(err: unknown): Error {
  const core: CoreError | null = coreErrorOf(err);
  if (core === null) {
    return err instanceof Error ? err : new Error(describeError(err));
  }
  if (core.kind === "RosterTooOld") {
    return new RosterTooOldError(ROSTER_TOO_OLD);
  }
  return new ManifestError("detail" in core ? core.detail : core.kind);
}

function rosterContext(state: DeviceState): RosterContext {
  return {
    collection_id: state.collection_id,
    device_id: state.device_id,
    roster_seq: state.roster_seq ?? 0,
    roster_transcript: state.roster_transcript ?? "",
  };
}

/** The fields core reads out of a wire roster. */
function coreRosterOf(roster: Roster): CoreRoster {
  return {
    roster_seq: roster.roster_seq,
    key_epoch: roster.key_epoch,
    devices: roster.devices,
    phrase_mldsa_pk: roster.phrase_mldsa_pk,
    phrase_ed25519_pk: roster.phrase_ed25519_pk,
    signer: roster.signer,
  };
}

function rememberRosterPin(session: Session, seq: number, transcript: string): void {
  let next;
  try {
    next = corePinRoster(rosterContext(session.state), { roster_seq: seq, transcript });
  } catch (err) {
    throw rosterFailure(err);
  }
  session.state.roster_seq = next.roster_seq;
  session.state.roster_transcript = next.roster_transcript;
}

/**
 * The verified chain in core's own shape, for a caller that hands the same
 * value back to core rather than reading it.
 */
async function verifiedRosterCore(session: Session): Promise<VerifiedRoster> {
  const { state, token } = session;
  const context = rosterContext(state);
  const request = coreRosterRequest(context);
  const body = await getText(`${apiRoot(state.server)}${request.path}`, token);
  try {
    const verified = coreRosterAccept(context, session.collectionKey, session.keyEpoch, 200, body);
    const roster = JSON.parse(verified.roster_json) as Roster;
    log.info("device roster verified", {
      from_seq: context.roster_seq,
      to_seq: verified.pin.roster_seq,
      bytes: body.length,
      devices: roster.devices.length,
      key_epoch: roster.key_epoch,
    });
    return verified;
  } catch (err) {
    const failure = rosterFailure(err);
    log.error(
      failure instanceof RosterTooOldError
        ? "roster history no longer reaches this device's pin"
        : "device roster failed to verify",
      { pinned_seq: context.roster_seq, bytes: body.length, reason: failure.message },
    );
    throw failure;
  }
}

async function verifiedRosterChain(session: Session): Promise<RosterVerified> {
  const verified = await verifiedRosterCore(session);
  return {
    roster: JSON.parse(verified.roster_json) as Roster,
    pin_seq: verified.pin.roster_seq,
    pin_transcript: verified.pin.transcript,
  };
}

export async function verifiedRoster(session: Session): Promise<Roster> {
  return (await verifiedRosterChain(session)).roster;
}

export async function syncRoster(session: Session): Promise<Roster> {
  const verified = await verifiedRosterChain(session);
  rememberRosterPin(session, verified.pin_seq, verified.pin_transcript);
  session.roster = verified.roster;
  return verified.roster;
}

export function pinSealedRoster(session: Session, roster: Roster): void {
  let verified;
  try {
    verified = coreRosterAcceptSealed(
      rosterContext(session.state),
      session.collectionKey,
      JSON.stringify(roster),
    );
  } catch (err) {
    throw rosterFailure(err);
  }
  rememberRosterPin(session, verified.pin.roster_seq, verified.pin.transcript);
  session.roster = roster;
}

export async function rosterDevices(
  session: Session,
  keyEpoch: number,
  signer: string,
): Promise<DevicePublic[]> {
  const cached = session.roster;
  if (cached && coreRosterAnswersFor(coreRosterOf(cached), keyEpoch, signer)) {
    return cached.devices;
  }
  return (await syncRoster(session)).devices;
}

export { rememberRosterPin, verifiedRosterChain, verifiedRosterCore };
