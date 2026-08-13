import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  createRemoteJWKSet,
  customFetch,
  type JWTPayload,
  jwtVerify,
} from "jose";
import type { OidcAuthConfig } from "../config.js";
import type {
  AppStore,
  OwnerRecord,
  WebSessionRecord,
} from "../storage/types.js";
import type { OwnerClaims } from "./owner.js";

const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1_000;

interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export interface LoginState {
  authorizationUrl: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface CompleteLoginInput {
  code: string;
  state: string;
  expectedState: string;
  expectedNonce: string;
  codeVerifier: string;
}

type SessionStore = Pick<
  AppStore,
  | "claimOwner"
  | "createWebSession"
  | "deleteExpiredWebSessions"
  | "deleteWebSession"
  | "findWebSession"
>;

type VerifyIdToken = (
  token: string,
  discovery: OidcDiscovery,
  config: OidcAuthConfig,
) => Promise<OwnerClaims & { nonce?: unknown }>;

export interface AuthServiceOptions {
  config: OidcAuthConfig;
  appOrigin: string;
  store: SessionStore;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  verifyIdToken?: VerifyIdToken;
}

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export function createAuthService(options: AuthServiceOptions) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const redirectUri = `${options.appOrigin}/auth/callback`;
  let discoveryPromise: Promise<OidcDiscovery> | undefined;

  async function discover(): Promise<OidcDiscovery> {
    discoveryPromise ??= (async () => {
      const discoveryUrl = new URL(
        `${options.config.issuerUrl.replace(/\/$/, "")}/.well-known/openid-configuration`,
      );
      const response = await fetcher(discoveryUrl, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok)
        throw new Error(`OIDC discovery failed with ${response.status}`);
      const value = (await response.json()) as Partial<OidcDiscovery>;
      if (
        value.issuer !== options.config.issuerUrl ||
        typeof value.authorization_endpoint !== "string" ||
        typeof value.token_endpoint !== "string" ||
        typeof value.jwks_uri !== "string"
      ) {
        throw new Error(
          "OIDC discovery response is invalid or has an unexpected issuer",
        );
      }
      return value as OidcDiscovery;
    })().catch((error) => {
      discoveryPromise = undefined;
      throw error;
    });
    return discoveryPromise;
  }

  async function defaultVerifyIdToken(
    token: string,
    discovery: OidcDiscovery,
    config: OidcAuthConfig,
  ): Promise<JWTPayload> {
    const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri), {
      [customFetch]: fetcher,
    });
    const result = await jwtVerify(token, jwks, {
      issuer: config.issuerUrl,
      audience: config.clientId,
    });
    return result.payload;
  }

  async function beginLogin(): Promise<LoginState> {
    const metadata = await discover();
    const state = randomToken();
    const nonce = randomToken();
    const codeVerifier = randomToken(48);
    const challenge = hash(codeVerifier);
    const url = new URL(metadata.authorization_endpoint);
    url.searchParams.set("client_id", options.config.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set(
      "code_challenge",
      Buffer.from(challenge, "hex").toString("base64url"),
    );
    url.searchParams.set("code_challenge_method", "S256");
    return { authorizationUrl: url.href, state, nonce, codeVerifier };
  }

  async function createSession(claims: OwnerClaims): Promise<string> {
    if (typeof claims.sub !== "string" || claims.sub.length === 0) {
      throw new Error("OIDC token is missing a subject");
    }
    const createdAt = now();
    const candidate: OwnerRecord = {
      issuer: options.config.issuerUrl,
      subject: claims.sub,
      ...(typeof claims.email === "string" ? { email: claims.email } : {}),
      claimedAt: createdAt,
    };
    const owner = await options.store.claimOwner(candidate);
    if (
      owner.issuer !== candidate.issuer ||
      owner.subject !== candidate.subject
    ) {
      throw new Error("OIDC identity is not the Pi Agent administrator");
    }
    const token = randomToken();
    await options.store.deleteExpiredWebSessions(createdAt);
    const record: WebSessionRecord = {
      tokenHash: hash(token),
      subject: claims.sub,
      ...(typeof claims.email === "string" ? { email: claims.email } : {}),
      createdAt,
      expiresAt: createdAt + SESSION_LIFETIME_MS,
    };
    await options.store.createWebSession(record);
    return token;
  }

  async function completeLogin(input: CompleteLoginInput): Promise<string> {
    if (!constantTimeTextEqual(input.state, input.expectedState))
      throw new Error("OIDC state mismatch");
    const metadata = await discover();
    const response = await fetcher(metadata.token_endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: redirectUri,
        client_id: options.config.clientId,
        client_secret: options.config.clientSecret,
        code_verifier: input.codeVerifier,
      }),
    });
    if (!response.ok)
      throw new Error(`OIDC token exchange failed with ${response.status}`);
    const tokens = (await response.json()) as { id_token?: unknown };
    if (typeof tokens.id_token !== "string")
      throw new Error("OIDC token response has no id_token");
    const verify = options.verifyIdToken ?? defaultVerifyIdToken;
    const claims = await verify(tokens.id_token, metadata, options.config);
    if (
      typeof claims.nonce !== "string" ||
      !constantTimeTextEqual(claims.nonce, input.expectedNonce)
    ) {
      throw new Error("OIDC nonce mismatch");
    }
    return createSession(claims);
  }

  async function authenticate(
    token: string | undefined,
    currentTime = now(),
  ): Promise<WebSessionRecord | undefined> {
    if (!token) return undefined;
    const session = await options.store.findWebSession(hash(token));
    if (!session) return undefined;
    if (session.expiresAt <= currentTime) {
      await options.store.deleteWebSession(session.tokenHash);
      return undefined;
    }
    return session;
  }

  async function logout(token: string | undefined): Promise<void> {
    if (token) await options.store.deleteWebSession(hash(token));
  }

  return {
    authenticate,
    beginLogin,
    completeLogin,
    createSession,
    discover,
    logout,
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
