import { createHash } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, test } from "vitest";
import { createAuthService } from "../../src/server/auth/service.js";
import type { OidcAuthConfig } from "../../src/server/config.js";
import type {
  AppStore,
  WebSessionRecord,
} from "../../src/server/storage/types.js";

class MemorySessionStore
  implements
    Pick<
      AppStore,
      | "claimOwner"
      | "createWebSession"
      | "deleteExpiredWebSessions"
      | "deleteWebSession"
      | "findWebSession"
    >
{
  readonly sessions = new Map<string, WebSessionRecord>();
  owner?: {
    issuer: string;
    subject: string;
    email?: string;
    claimedAt: number;
  };

  async claimOwner(owner: {
    issuer: string;
    subject: string;
    email?: string;
    claimedAt: number;
  }) {
    this.owner ??= owner;
    return this.owner;
  }

  async createWebSession(session: WebSessionRecord) {
    this.sessions.set(session.tokenHash, session);
  }

  async findWebSession(tokenHash: string) {
    return this.sessions.get(tokenHash);
  }

  async deleteWebSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }

  async deleteExpiredWebSessions(now: number) {
    let count = 0;
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(key);
        count += 1;
      }
    }
    return count;
  }
}

const oidc: OidcAuthConfig = {
  mode: "oidc",
  issuerUrl: "https://id.example.com/",
  clientId: "client",
  clientSecret: "secret",
};

const discovery = {
  issuer: oidc.issuerUrl,
  authorization_endpoint: "https://id.example.com/authorize",
  token_endpoint: "https://id.example.com/token",
  jwks_uri: "https://id.example.com/jwks",
};

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

describe("authentication service", () => {
  test("creates a state, nonce, and PKCE authorization request", async () => {
    const store = new MemorySessionStore();
    const service = createAuthService({
      config: oidc,
      appOrigin: "https://agent.example.com",
      store,
      fetch: async () => new Response(JSON.stringify(discovery)),
      now: () => 1_000,
    });

    const result = await service.beginLogin();
    const url = new URL(result.authorizationUrl);

    expect(url.searchParams.get("state")).toBe(result.state);
    expect(url.searchParams.get("nonce")).toBe(result.nonce);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(result.codeVerifier.length).toBeGreaterThan(40);
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://agent.example.com/auth/callback",
    );
  });

  test("appends discovery metadata to issuer paths", async () => {
    let requested = "";
    const pathOidc = {
      ...oidc,
      issuerUrl: "https://id.example.com/realms/owner",
    };
    const service = createAuthService({
      config: pathOidc,
      appOrigin: "https://agent.example.com",
      store: new MemorySessionStore(),
      fetch: async (input) => {
        requested = String(input);
        return new Response(
          JSON.stringify({
            ...discovery,
            issuer: pathOidc.issuerUrl,
          }),
        );
      },
    });

    await service.discover();

    expect(requested).toBe(
      "https://id.example.com/realms/owner/.well-known/openid-configuration",
    );
  });

  test("stores only a hash and enforces fixed session expiry", async () => {
    const store = new MemorySessionStore();
    const service = createAuthService({
      config: oidc,
      appOrigin: "https://agent.example.com",
      store,
      fetch: async () => new Response(JSON.stringify(discovery)),
      now: () => 1_000,
    });

    const token = await service.createSession({ sub: "owner-1" });
    expect(store.sessions.has(token)).toBe(false);
    expect(store.sessions.get(hash(token))).toMatchObject({
      subject: "owner-1",
      createdAt: 1_000,
      expiresAt: 86_401_000,
    });

    expect(await service.authenticate(token, 86_400_999)).toMatchObject({
      subject: "owner-1",
    });
    expect(await service.authenticate(token, 86_401_000)).toBeUndefined();
  });

  test("claims the first verified identity and rejects later identities", async () => {
    const store = new MemorySessionStore();
    const service = createAuthService({
      config: oidc,
      appOrigin: "https://agent.example.com",
      store,
      fetch: async () => new Response(JSON.stringify(discovery)),
      now: () => 1_000,
    });

    await expect(
      service.createSession({ sub: "owner-1", email: "owner@example.com" }),
    ).resolves.toBeTypeOf("string");
    expect(store.owner).toMatchObject({
      issuer: oidc.issuerUrl,
      subject: "owner-1",
    });
    await expect(
      service.createSession({ sub: "someone-else" }),
    ).rejects.toThrow(/administrator/i);
  });

  test("verifies a signed ID token from a mock OIDC issuer", async () => {
    const store = new MemorySessionStore();
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    const service = createAuthService({
      config: oidc,
      appOrigin: "https://agent.example.com",
      store,
      fetch: async (input) => {
        const url = String(input);
        if (url.endsWith("/.well-known/openid-configuration")) {
          return new Response(JSON.stringify(discovery));
        }
        if (url === discovery.jwks_uri) {
          return new Response(
            JSON.stringify({
              keys: [{ ...jwk, kid: "one", use: "sig", alg: "RS256" }],
            }),
          );
        }
        const nonce = currentNonce;
        const idToken = await new SignJWT({
          nonce,
          email: "owner@example.com",
          email_verified: true,
        })
          .setProtectedHeader({ alg: "RS256", kid: "one" })
          .setIssuer(oidc.issuerUrl)
          .setAudience(oidc.clientId)
          .setSubject("owner-1")
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(privateKey);
        return new Response(
          JSON.stringify({
            access_token: "access",
            token_type: "Bearer",
            id_token: idToken,
          }),
        );
      },
      now: () => 1_000,
    });
    let currentNonce = "";
    const login = await service.beginLogin();
    currentNonce = login.nonce;

    await expect(
      service.completeLogin({
        code: "code",
        state: login.state,
        expectedState: login.state,
        expectedNonce: login.nonce,
        codeVerifier: login.codeVerifier,
      }),
    ).resolves.toBeTypeOf("string");
  });

  test("validates state and nonce when completing a callback", async () => {
    const store = new MemorySessionStore();
    const service = createAuthService({
      config: oidc,
      appOrigin: "https://agent.example.com",
      store,
      fetch: async (input) => {
        if (String(input).endsWith("/.well-known/openid-configuration")) {
          return new Response(JSON.stringify(discovery));
        }
        return new Response(
          JSON.stringify({
            access_token: "access",
            token_type: "Bearer",
            id_token: "id-token",
          }),
        );
      },
      verifyIdToken: async () => ({ sub: "owner-1", nonce: "expected-nonce" }),
      now: () => 1_000,
    });

    await expect(
      service.completeLogin({
        code: "code",
        state: "wrong",
        expectedState: "expected",
        expectedNonce: "expected-nonce",
        codeVerifier: "verifier",
      }),
    ).rejects.toThrow(/state/i);

    await expect(
      service.completeLogin({
        code: "code",
        state: "expected",
        expectedState: "expected",
        expectedNonce: "wrong-nonce",
        codeVerifier: "verifier",
      }),
    ).rejects.toThrow(/nonce/i);
  });
});
