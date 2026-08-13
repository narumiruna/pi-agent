import { describe, expect, test } from "vitest";
import { parseConfig } from "../../src/server/config.js";

const baseEnv = {
  APP_ORIGIN: "https://agent.example.com",
  OIDC_ISSUER_URL: "https://id.example.com",
  OIDC_CLIENT_ID: "pi-agent",
  OIDC_CLIENT_SECRET: "secret",
  OIDC_OWNER_SUB: "owner-1",
};

describe("parseConfig", () => {
  test("fails closed when OIDC configuration is absent", () => {
    expect(() => parseConfig({})).toThrow(/OIDC configuration is required/);
  });

  test("allows an explicitly disabled authentication mode", () => {
    const config = parseConfig({ AUTH_MODE: "disabled" });

    expect(config.auth.mode).toBe("disabled");
    expect(config.agentDir).toBe("/app/.pi/agent");
    expect(config.dataDir).toBe("/app/data");
    expect(config.workspace).toBe("/workspace");
    expect(config.agentTools).toEqual(["read", "grep", "find", "ls"]);
  });

  test("normalizes an OIDC origin and requires an owner", () => {
    const config = parseConfig(baseEnv);

    expect(config.appOrigin).toBe("https://agent.example.com");
    expect(config.auth).toMatchObject({
      mode: "oidc",
      ownerSub: "owner-1",
      issuerUrl: "https://id.example.com/",
    });
  });

  test("rejects unsafe host, port, or tool settings", () => {
    expect(() =>
      parseConfig({ AUTH_MODE: "disabled", HOST: "bad/host" }),
    ).toThrow(/HOST/);
    expect(() => parseConfig({ AUTH_MODE: "disabled", PORT: "70000" })).toThrow(
      /PORT/,
    );
    expect(() =>
      parseConfig({ AUTH_MODE: "disabled", AGENT_TOOLS: "read,curl" }),
    ).toThrow(/AGENT_TOOLS/);
  });

  test("rejects an origin with a path", () => {
    expect(() =>
      parseConfig({ ...baseEnv, APP_ORIGIN: "https://agent.example.com/app" }),
    ).toThrow(/APP_ORIGIN/);
  });

  test("rejects OIDC issuer credentials and fragments", () => {
    expect(() =>
      parseConfig({
        ...baseEnv,
        OIDC_ISSUER_URL: "https://user@id.example.com",
      }),
    ).toThrow(/OIDC_ISSUER_URL/);
    expect(() =>
      parseConfig({
        ...baseEnv,
        OIDC_ISSUER_URL: "https://id.example.com/#fragment",
      }),
    ).toThrow(/OIDC_ISSUER_URL/);
  });

  test("requires HTTPS for non-local OIDC deployments", () => {
    expect(() =>
      parseConfig({ ...baseEnv, APP_ORIGIN: "http://agent.example.com" }),
    ).toThrow(/HTTPS/);
    expect(() =>
      parseConfig({ ...baseEnv, OIDC_ISSUER_URL: "http://id.example.com" }),
    ).toThrow(/HTTPS/);
    expect(() =>
      parseConfig({
        ...baseEnv,
        APP_ORIGIN: "http://localhost:3000",
        OIDC_ISSUER_URL: "http://localhost:1411",
      }),
    ).not.toThrow();
  });
});
