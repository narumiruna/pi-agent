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

  test("searches native ID, name, messages, and cwd with phrase and regex modes", () => {
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
      discoverConversations(records, {
        query: 'navigation "browser tests"',
      }).map((item) => item.id),
    ).toEqual(["session-alpha"]);
    expect(
      discoverConversations(records, { query: "re:release\\s+planning" }).map(
        (item) => item.id,
      ),
    ).toEqual(["session-alpha"]);
    expect(
      discoverConversations(records, { query: "otherproject" }).map(
        (item) => item.id,
      ),
    ).toEqual(["session-beta"]);
    expect(discoverConversations(records, { query: "re:[" })).toEqual([]);
  });

  test("filters only trimmed names and orders recent and fuzzy results deterministically", () => {
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
      discoverConversations(records, {
        nameFilter: "named",
        sort: "recent",
      }).map((item) => item.id),
    ).toEqual(["older"]);
    expect(
      discoverConversations(records, { sort: "recent" }).map((item) => item.id),
    ).toEqual(["newer", "blank", "older"]);
    expect(
      discoverConversations(records, {
        query: "navigation",
        sort: "relevance",
      }).map((item) => item.id),
    ).toEqual(["older", "newer"]);
  });

  test("threads parents before children by latest subtree activity", () => {
    const root = record("root", "2026-08-10T00:00:00.000Z");
    const child = record("child", "2026-08-15T00:00:00.000Z", {
      parentSessionPath: root.path,
    });
    const other = record("other", "2026-08-14T00:00:00.000Z");

    expect(
      discoverConversations([other, child, root], { sort: "threaded" }).map(
        (item) => item.id,
      ),
    ).toEqual(["root", "child", "other"]);
  });

  test("keeps cyclic or missing parents once as deterministic roots", () => {
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
      discoverConversations([second, missing, first], {
        sort: "threaded",
      }).map((item) => item.id),
    ).toEqual(["cycle-a", "cycle-b", "missing"]);
  });
});
