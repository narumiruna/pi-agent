import { describe, expect, test } from "vitest";
import {
  type ConversationDiscoveryRecord,
  discoverConversations,
  fuzzyConversationMatch,
  parseConversationSearch,
} from "../../src/server/agent/conversation-discovery.js";

function record(
  id: string,
  modified: string,
  overrides: Partial<ConversationDiscoveryRecord> = {},
): ConversationDiscoveryRecord {
  return {
    id,
    created: new Date("2026-08-01T00:00:00.000Z"),
    modified: new Date(modified),
    messageCount: 1,
    active: false,
    cwd: "/workspace",
    allMessagesText: "",
    path: `/sessions/${id}.jsonl`,
    ...overrides,
  };
}

describe("native conversation discovery", () => {
  test("parses fuzzy terms, exact phrases, regex, and invalid input like Pi", () => {
    expect(parseConversationSearch('foo "node cve" bar')).toMatchObject({
      mode: "tokens",
      tokens: [
        { kind: "fuzzy", value: "foo" },
        { kind: "phrase", value: "node cve" },
        { kind: "fuzzy", value: "bar" },
      ],
    });
    expect(parseConversationSearch('foo "unfinished')).toMatchObject({
      mode: "tokens",
      tokens: [
        { kind: "fuzzy", value: "foo" },
        { kind: "fuzzy", value: '"unfinished' },
      ],
    });
    expect(parseConversationSearch("re:navigation\\s+race").regex).toEqual(
      /navigation\s+race/i,
    );
    expect(parseConversationSearch("re:[")).toMatchObject({
      mode: "regex",
      regex: null,
      error: expect.any(String),
    });
    expect(parseConversationSearch("re:")).toMatchObject({
      error: "Empty regex",
    });
  });

  test("uses Pi fuzzy scoring including ordered characters and swapped letter-number tokens", () => {
    expect(fuzzyConversationMatch("nvr", "navigation race").matches).toBe(true);
    expect(fuzzyConversationMatch("nvr", "unrelated").matches).toBe(false);
    expect(fuzzyConversationMatch("model2", "2model").matches).toBe(true);
    expect(
      fuzzyConversationMatch("navigation", "navigation race").score,
    ).toBeLessThan(fuzzyConversationMatch("nvr", "navigation race").score);
  });

  test("searches native ID, name, messages, and cwd with phrase and regex modes", async () => {
    const records = [
      record("session-alpha", "2026-08-15T00:00:00.000Z", {
        name: "Release planning",
        allMessagesText: "Fix the navigation race then run browser tests",
      }),
      record("session-beta", "2026-08-14T00:00:00.000Z", {
        cwd: "/other/project",
        allMessagesText: "Document storage",
      }),
    ];

    expect(
      (
        await discoverConversations(records, {
          query: 'navigation "browser tests"',
        })
      ).map((item) => item.id),
    ).toEqual(["session-alpha"]);
    expect(
      (
        await discoverConversations(records, {
          query: "re:release\\s+planning",
        })
      ).map((item) => item.id),
    ).toEqual(["session-alpha"]);
    expect(
      (await discoverConversations(records, { query: "otherproject" })).map(
        (item) => item.id,
      ),
    ).toEqual(["session-beta"]);
    await expect(
      discoverConversations(records, { query: "re:[" }),
    ).resolves.toEqual([]);
  });

  test("time-bounds pathological regex without blocking the event loop", async () => {
    const search = discoverConversations(
      [
        record("regex-target", "2026-08-15T00:00:00.000Z", {
          allMessagesText: `${"a".repeat(100_000)}!`,
        }),
      ],
      { query: "re:(a+)+$" },
    );
    const heartbeat = new Promise<string>((resolve) =>
      setTimeout(() => resolve("responsive"), 25),
    );

    await expect(
      Promise.race([search.then(() => "search"), heartbeat]),
    ).resolves.toBe("responsive");
    await expect(search).resolves.toEqual([]);
  });

  test("filters only trimmed names and orders recent and fuzzy results deterministically", async () => {
    const records = [
      record("older", "2026-08-12T00:00:00.000Z", {
        name: "Named session",
        allMessagesText: "navigation",
      }),
      record("newer", "2026-08-15T00:00:00.000Z", {
        allMessagesText: "n x a x v x i x g x a x t x i x o x n",
      }),
      record("blank", "2026-08-14T00:00:00.000Z", { name: "   " }),
    ];

    expect(
      (
        await discoverConversations(records, {
          nameFilter: "named",
          sort: "recent",
        })
      ).map((item) => item.id),
    ).toEqual(["older"]);
    expect(
      (await discoverConversations(records, { sort: "recent" })).map(
        (item) => item.id,
      ),
    ).toEqual(["newer", "blank", "older"]);
    expect(
      (
        await discoverConversations(records, {
          query: "navigation",
          sort: "relevance",
        })
      ).map((item) => item.id),
    ).toEqual(["older", "newer"]);
  });

  test("threads parents before children by latest subtree activity", async () => {
    const root = record("root", "2026-08-10T00:00:00.000Z");
    const child = record("child", "2026-08-15T00:00:00.000Z", {
      parentSessionPath: root.path,
    });
    const other = record("other", "2026-08-14T00:00:00.000Z");

    expect(
      (
        await discoverConversations([other, child, root], { sort: "threaded" })
      ).map((item) => item.id),
    ).toEqual(["root", "child", "other"]);
  });

  test("matches Pi by using relevance for Threaded while search is nonempty", async () => {
    const root = record("root", "2026-08-15T00:00:00.000Z", {
      allMessagesText: "n x a x v x i x g x a x t x i x o x n",
    });
    const child = record("child", "2026-08-14T00:00:00.000Z", {
      allMessagesText: "navigation",
      parentSessionPath: root.path,
    });

    expect(
      (
        await discoverConversations([root, child], {
          query: "navigation",
          sort: "threaded",
        })
      ).map((item) => item.id),
    ).toEqual(["child", "root"]);
  });

  test("keeps cyclic or missing parents once as deterministic roots", async () => {
    const first = record("cycle-a", "2026-08-15T00:00:00.000Z", {
      parentSessionPath: "/sessions/cycle-b.jsonl",
    });
    const second = record("cycle-b", "2026-08-14T00:00:00.000Z", {
      parentSessionPath: first.path,
    });
    const missing = record("missing", "2026-08-13T00:00:00.000Z", {
      parentSessionPath: "/sessions/not-found.jsonl",
    });

    expect(
      (
        await discoverConversations([second, missing, first], {
          sort: "threaded",
        })
      ).map((item) => item.id),
    ).toEqual(["cycle-a", "cycle-b", "missing"]);
  });
});
