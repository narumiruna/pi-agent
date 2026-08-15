import { describe, expect, test } from "vitest";
import { resourceProvenanceLabel } from "../../src/shared/contracts.js";

describe("resource provenance labels", () => {
  test.each([
    [{ scope: "user", origin: "top-level" }, "user"],
    [{ scope: "project", origin: "top-level" }, "project"],
    [{ scope: "temporary", origin: "top-level" }, "temporary"],
    [{ scope: "user", origin: "package" }, "user package"],
    [{ scope: "project", origin: "package" }, "project package"],
    [{ scope: "temporary", origin: "package" }, "temporary package"],
  ] as const)("labels %o as %s", (provenance, expected) => {
    expect(resourceProvenanceLabel(provenance)).toBe(expected);
  });
});
