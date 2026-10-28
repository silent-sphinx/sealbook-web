import { describe, expect, it } from "vitest";

import {
  ALL_COLLECTIONS,
  BOOKMARK_COLLECTION_CONTENT_TYPE,
  BOOKMARK_CONTENT_TYPE,
  DEFAULT_BOOKMARK_COLLECTION_ID,
  DEFAULT_BOOKMARK_COLLECTION_NAME,
  bookmarkDraft,
  collectionTone,
  normalizeTags,
  normalizeUrl,
  parseBookmark,
  parseBookmarkCollection,
  resolveCollectionId,
  serializeBookmark,
  serializeBookmarkCollection,
} from "./bookmark";
import {
  coreBookmarkCollectionKeys,
  coreBookmarkCollectionParse,
  coreBookmarkCollectionTone,
  coreBookmarkCollectionWrite,
  coreBookmarkKeys,
  coreBookmarkParse,
  coreBookmarkWrite,
  coreDefaultBookmarkCollectionId,
  coreErrorOf,
  coreNormalizeTags,
  coreNormalizeUrl,
  coreResolveCollectionId,
} from "./wasm";
import type {
  CoreBookmark,
  CoreBookmarkCollection,
  CoreBookmarkCollectionDraft,
  CoreBookmarkDraft,
} from "./wasm";
import { readFixture } from "../test/fixtures";

/**
 * The shared bookmark fixture, through the same core the CLI and Android run.
 * Held to the same document as `sealbook-core/tests/bookmarks.rs`: the payloads
 * are pinned byte for byte, and nothing but this test says so when a key or a
 * value differs here.
 */
type Fixture = {
  constants: {
    bookmark_content_type: string;
    collection_content_type: string;
    bookmark_keys: string[];
    collection_keys: string[];
    default_collection_id: string;
    default_collection_name: string;
    max_tags: number;
  };
  writes: { case: string; draft: CoreBookmarkDraft; payload: string }[];
  parses: { case: string; id: string; raw: string; bookmark: CoreBookmark }[];
  collection_writes: { case: string; draft: CoreBookmarkCollectionDraft; payload: string }[];
  collection_parses: {
    case: string;
    id: string;
    raw: string;
    collection: CoreBookmarkCollection;
  }[];
  tones: { case: string; collections: CoreBookmarkCollection[]; id: string; tone: string }[];
  refusals: { case: string; error: string }[];
};

const fixture = JSON.parse(readFixture("payloads/bookmarks.json")) as Fixture;

const NOW = "2026-10-28T12:00:00Z";

describe("the constants this client mirrors", () => {
  it("are core's", () => {
    expect(BOOKMARK_CONTENT_TYPE).toBe(fixture.constants.bookmark_content_type);
    expect(BOOKMARK_COLLECTION_CONTENT_TYPE).toBe(fixture.constants.collection_content_type);
    expect(DEFAULT_BOOKMARK_COLLECTION_ID).toBe(fixture.constants.default_collection_id);
    expect(DEFAULT_BOOKMARK_COLLECTION_ID).toBe(coreDefaultBookmarkCollectionId());
    expect(DEFAULT_BOOKMARK_COLLECTION_NAME).toBe(fixture.constants.default_collection_name);
    expect(ALL_COLLECTIONS).not.toBe(DEFAULT_BOOKMARK_COLLECTION_ID);
  });

  it("include the owned key sets", () => {
    expect(coreBookmarkKeys()).toEqual(fixture.constants.bookmark_keys);
    expect(coreBookmarkCollectionKeys()).toEqual(fixture.constants.collection_keys);
  });

  it("normalise an address, a collection id and tags the way core does", () => {
    for (const url of ["", "  ", "example.com", " http://a.b ", "mailto:a@b.c", "1abc:x", "a b:c"]) {
      expect(normalizeUrl(url)).toBe(coreNormalizeUrl(url));
    }
    for (const id of [undefined, "", "   ", "all", "c-7", " c-7 "]) {
      expect(resolveCollectionId(id)).toBe(coreResolveCollectionId(id));
    }
    const tags = ["  a ", "A", "", "b", ...Array.from({ length: 40 }, (_, n) => `t${n}`)];
    expect(normalizeTags(tags)).toEqual(coreNormalizeTags(tags));
    expect(coreNormalizeTags(tags)).toHaveLength(fixture.constants.max_tags);
  });
});

describe("every bookmark the fixture holds", () => {
  it.each(fixture.writes.map((write, index) => [write.case, index] as const))(
    "writes one spelling: %s",
    (_case, index) => {
      const write = fixture.writes[index];
      expect(coreBookmarkWrite(write.draft, NOW)).toBe(write.payload);
    },
  );

  it.each(fixture.parses.map((parse, index) => [parse.case, index] as const))(
    "reads back as one record: %s",
    (_case, index) => {
      const parse = fixture.parses[index];
      expect(coreBookmarkParse(parse.id, parse.raw)).toEqual(parse.bookmark);
    },
  );
});

describe("every collection the fixture holds", () => {
  it.each(fixture.collection_writes.map((write, index) => [write.case, index] as const))(
    "writes one spelling: %s",
    (_case, index) => {
      const write = fixture.collection_writes[index];
      expect(coreBookmarkCollectionWrite(write.draft)).toBe(write.payload);
    },
  );

  it.each(fixture.collection_parses.map((parse, index) => [parse.case, index] as const))(
    "reads back as one record: %s",
    (_case, index) => {
      const parse = fixture.collection_parses[index];
      expect(coreBookmarkCollectionParse(parse.id, parse.raw)).toEqual(parse.collection);
    },
  );

  it.each(fixture.tones.map((tone, index) => [tone.case, index] as const))(
    "resolves to one colour: %s",
    (_case, index) => {
      const tone = fixture.tones[index];
      expect(coreBookmarkCollectionTone(tone.collections, tone.id)).toBe(tone.tone);
      expect(
        collectionTone(
          tone.collections.map((item) => parseBookmarkCollection(item.id, item.raw)),
          tone.id,
        ),
      ).toBe(tone.tone);
    },
  );
});

describe("a bookmark an editor opens and saves without changing", () => {
  it("keeps what the editor cannot show", () => {
    const stored = fixture.parses[0].raw;
    const written = JSON.parse(serializeBookmark(bookmarkDraft(parseBookmark("b1", stored)))) as Record<
      string,
      unknown
    >;
    expect(written.somethingNewer).toEqual({ from: "a later build" });
    expect(written.tags).toEqual(["rust", "web"]);
  });

  it("does not title a bookmark by saving it", () => {
    const bookmark = parseBookmark("b2", '{"@type":"Bookmark","url":"https://example.com"}');
    expect(bookmark.title).toBe("https://example.com");
    const written = JSON.parse(serializeBookmark(bookmarkDraft(bookmark))) as { title: string };
    expect(written.title).toBe("");
  });

  it("keeps a collection's colour and parent through a rename", () => {
    const stored = '{"@type":"BookmarkCollection","name":"Work","parentId":"p","color":"#112233","x":1}';
    const collection = parseBookmarkCollection("c1", stored);
    const written = JSON.parse(
      serializeBookmarkCollection("Renamed", collection.parentId, collection.raw, collection.color),
    ) as Record<string, unknown>;
    expect(written).toMatchObject({ name: "Renamed", parentId: "p", color: "#112233", x: 1 });
  });
});

describe("a payload from a newer schema major", () => {
  it("is read, and never written over", () => {
    const future = '{"@type":"Bookmark","version":"2.0","url":"https://example.com"}';
    expect(parseBookmark("b1", future).readable).toBe(false);
    let caught: unknown;
    try {
      serializeBookmark({ ...bookmarkDraft(parseBookmark("b1", future)), title: "edited" });
    } catch (err) {
      caught = err;
    }
    expect(coreErrorOf(caught)?.kind).toBe(fixture.refusals[0].error);

    caught = undefined;
    try {
      serializeBookmarkCollection("edited", undefined, '{"version":"3.1","name":"future"}');
    } catch (err) {
      caught = err;
    }
    expect(coreErrorOf(caught)?.kind).toBe(fixture.refusals[1].error);
  });
});
