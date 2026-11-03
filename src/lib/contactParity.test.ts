import { describe, expect, it } from "vitest";

import {
  DEFAULT_ADDRESS_BOOK_ID,
  DEFAULT_ADDRESS_BOOK_NAME,
  ADDRESS_BOOK_CONTENT_TYPE,
  JSCONTACT_CONTENT_TYPE,
  ADDRESS_BOOK_ID_PROP,
  UNTITLED_ADDRESS_BOOK_NAME,
  parseAddressBook,
  resolveAddressBookId,
  serializeAddressBook,
} from "./addressBook";
import { CONTACT_ARCHIVED_PROP, CONTACT_ATTACHMENTS_PROP, parseContact, serializeCard } from "./contact";
import {
  CONTACT_PROFILE_PROP,
  MAX_PROFILE_ENTRIES,
  MAX_PROFILE_TEXT_CHARS,
} from "./contactProfile";
import {
  coreAddressBookKeys,
  coreContactKeys,
  coreContactProfileKeys,
  coreDefaultAddressBookId,
  coreErrorOf,
  coreResolveAddressBookId,
} from "./wasm";
import type { CoreAddressBook, CoreAddressBookDraft, CoreContact, CoreContactDraft } from "./wasm";
import { readFixture } from "../test/fixtures";

/**
 * The shared contact fixture, through the same core the CLI and Android run.
 *
 * Held to the same document as `sealbook-core/tests/contacts.rs` and Android's
 * `ContactPayloadTest`. The payloads are pinned byte for byte, which they can be
 * because core writes them for every host and the clock is the caller's, fixed
 * here: this is the only layer with no server check behind it, so a key or a
 * value that differs here differs in the plaintext and nothing but this test
 * would say so.
 */
type Fixture = {
  constants: {
    contact_content_type: string;
    address_book_content_type: string;
    contact_keys: string[];
    address_book_keys: string[];
    profile_keys: string[];
    default_address_book_id: string;
    default_address_book_name: string;
    untitled_address_book_name: string;
    unnamed_contact_name: string;
    max_profile_text_chars: number;
    max_profile_entries: number;
    address_book_id_prop: string;
    archived_prop: string;
    attachments_prop: string;
    profile_prop: string;
  };
  contact_writes: { case: string; draft: CoreContactDraft; payload: string }[];
  contact_parses: { case: string; id: string; raw: string; contact: CoreContact }[];
  address_book_writes: { case: string; draft: CoreAddressBookDraft; payload: string }[];
  address_book_parses: { case: string; id: string; raw: string; address_book: CoreAddressBook }[];
  refusals: { case: string; error: string }[];
};

const fixture = JSON.parse(readFixture("payloads/contacts.json")) as Fixture;


describe("the constants this client mirrors", () => {
  /**
   * `addressBook.ts` and `contact.ts` keep these as literals because module
   * scope runs before the wasm module is instantiated. That is what makes drift
   * possible, and this is what catches it.
   */
  it("are core's", () => {
    expect(JSCONTACT_CONTENT_TYPE).toBe(fixture.constants.contact_content_type);
    expect(ADDRESS_BOOK_CONTENT_TYPE).toBe(fixture.constants.address_book_content_type);
    expect(DEFAULT_ADDRESS_BOOK_ID).toBe(fixture.constants.default_address_book_id);
    expect(DEFAULT_ADDRESS_BOOK_ID).toBe(coreDefaultAddressBookId());
    expect(DEFAULT_ADDRESS_BOOK_NAME).toBe(fixture.constants.default_address_book_name);
    expect(UNTITLED_ADDRESS_BOOK_NAME).toBe(fixture.constants.untitled_address_book_name);
    expect(ADDRESS_BOOK_ID_PROP).toBe(fixture.constants.address_book_id_prop);
    expect(CONTACT_ARCHIVED_PROP).toBe(fixture.constants.archived_prop);
    expect(CONTACT_ATTACHMENTS_PROP).toBe(fixture.constants.attachments_prop);
    expect(CONTACT_PROFILE_PROP).toBe(fixture.constants.profile_prop);
    expect(MAX_PROFILE_TEXT_CHARS).toBe(fixture.constants.max_profile_text_chars);
    expect(MAX_PROFILE_ENTRIES).toBe(fixture.constants.max_profile_entries);
  });

  it("include the owned key sets, which are the union across every client", () => {
    expect(coreContactKeys()).toEqual(fixture.constants.contact_keys);
    expect(coreAddressBookKeys()).toEqual(fixture.constants.address_book_keys);
    expect(coreContactProfileKeys()).toEqual(fixture.constants.profile_keys);
  });

  it("resolve an address book id the way core does", () => {
    for (const id of [undefined, "", "   ", "all", "book-7", " book-7 "]) {
      expect(resolveAddressBookId(id)).toBe(coreResolveAddressBookId(id));
    }
  });
});

describe("a card an editor opens and saves without changing", () => {
  /**
   * The entries this client cannot show are what the fixture's unreadable third
   * address, second note, later-build keys and `colleagues` stand for: they ride
   * in `raw` through the view model, and the write puts them back.
   */
  it("keeps what the editor cannot show", () => {
    const stored = fixture.contact_parses[0].raw;
    const contact = parseContact("c1", stored, "", 0);
    expect(contact.addresses.map((a) => a.locality)).toEqual(["London", "Paris"]);
    const written = JSON.parse(serializeCard(contact)) as Record<string, unknown>;
    expect(written.ranking).toBe(9);
    const addresses = written.addresses as Record<string, unknown>;
    expect(addresses.a2).toEqual({ locality: "Paris", contexts: { work: true } });
    expect(addresses.a3).toEqual({ components: [{ kind: "locality", value: "Oslo" }] });
    expect((written.notes as Record<string, unknown>).n2).toEqual({ note: "Second note." });
    const profile = written[CONTACT_PROFILE_PROP] as Record<string, unknown>;
    expect(profile.hobbies).toEqual(["looms"]);
    expect(profile.colleagues).toHaveLength(1);
  });

  it("does not name a nameless card by saving it", () => {
    const contact = parseContact(
      "c2",
      '{"@type":"Card","emails":{"e1":{"address":"ada.lovelace@example.com"}}}',
      "",
      0,
    );
    expect(contact.name).toBe("ada lovelace");
    const written = JSON.parse(serializeCard(contact)) as { name: { full: string } };
    expect(written.name.full).toBe("");
    const renamed = JSON.parse(serializeCard({ ...contact, name: "Ada" })) as {
      name: { full: string };
    };
    expect(renamed.name.full).toBe("Ada");
  });
});

describe("a payload from a newer schema major", () => {
  it("is read, because a lenient read beats a blank row", () => {
    const card = parseContact("c1", '{"@type":"Card","version":"2.0","name":{"full":"future"}}', "", 0);
    expect(card.name).toBe("future");
    expect(card.readable).toBe(false);
    expect(parseAddressBook("b1", '{"version":"2.0","name":"future"}').name).toBe("future");
  });

  it("is never written over", () => {
    const future = parseContact("c1", '{"@type":"Card","version":"2.0","name":{"full":"future"}}', "", 0);
    let caught: unknown;
    try {
      serializeCard({ ...future, name: "edited" });
    } catch (err) {
      caught = err;
    }
    expect(coreErrorOf(caught)?.kind).toBe(fixture.refusals[0].error);

    caught = undefined;
    try {
      serializeAddressBook("edited", '{"version":"2.0","name":"future"}');
    } catch (err) {
      caught = err;
    }
    expect(coreErrorOf(caught)?.kind).toBe(fixture.refusals[1].error);
  });
});
