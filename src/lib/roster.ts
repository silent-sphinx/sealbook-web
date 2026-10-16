import type { Session } from "./client";
import { describeError, log } from "./log";
import { apiRoot, getJson } from "./transport";
import { rosterVerify } from "./wasm";
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

function rememberRosterPin(session: Session, seq: number, transcript: string): void {
  if (seq < (session.state.roster_seq ?? 0)) {
    throw new ManifestError("Refusing to pin an older device roster.");
  }
  session.state.roster_seq = seq;
  session.state.roster_transcript = transcript;
}

function rosterPin(state: DeviceState): { seq: number; transcript: string } {
  const seq = state.roster_seq ?? 0;
  const transcript = state.roster_transcript ?? "";
  return seq > 0 && transcript ? { seq, transcript } : { seq: 0, transcript: "" };
}

async function verifiedRosterChain(session: Session): Promise<RosterVerified> {
  const { state, token } = session;
  const pin = rosterPin(state);
  const base = `${apiRoot(state.server)}/v1/collections/${state.collection_id}/roster`;
  const url = pin.seq > 0 ? `${base}?from=${pin.seq}` : base;
  const response = await getJson<{ rosters: Roster[]; floor?: number }>(url, token);
  const floor = response.floor ?? 0;
  if (pin.seq > 0 && floor > pin.seq) {
    log.error("roster history no longer reaches this device's pin", {
      pinned_seq: pin.seq,
      server_floor: floor,
    });
    throw new RosterTooOldError(
      "This device is further behind than the server's device-list history reaches, so the " +
        "chain from the roster it pinned cannot be checked. Pair this device again to anchor " +
        "it on the current list.",
    );
  }
  try {
    const verified = rosterVerify(
      state.collection_id,
      pin.seq,
      pin.transcript,
      response.rosters,
      session.collectionKey,
      session.keyEpoch,
      state.device_id,
    );
    log.info("device roster verified", {
      from_seq: pin.seq,
      to_seq: verified.pin_seq,
      links: response.rosters.length,
      devices: verified.roster.devices.length,
      key_epoch: verified.roster.key_epoch,
    });
    return verified;
  } catch (err) {
    log.error("device roster failed to verify", {
      pinned_seq: pin.seq,
      links: response.rosters.length,
      reason: describeError(err),
    });
    throw new ManifestError(err instanceof Error ? err.message : String(err));
  }
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
  const verified = rosterVerify(
    session.state.collection_id,
    0,
    "",
    [roster],
    session.collectionKey,
    session.keyEpoch,
    session.state.device_id,
  );
  rememberRosterPin(session, verified.pin_seq, verified.pin_transcript);
  session.roster = roster;
}

export async function rosterDevices(
  session: Session,
  keyEpoch: number,
  signer: string,
): Promise<DevicePublic[]> {
  const cached = session.roster;
  if (
    cached &&
    cached.key_epoch === keyEpoch &&
    cached.devices.some((device) => device.device_id === signer)
  ) {
    return cached.devices;
  }
  return (await syncRoster(session)).devices;
}

export { verifiedRosterChain };
