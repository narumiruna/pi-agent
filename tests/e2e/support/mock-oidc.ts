import { createHash, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

interface AuthorizationCode {
  challenge: string;
  nonce: string;
  subject: string;
}

interface OidcMockOptions {
  appOrigin: string;
  clientId: string;
  clientSecret: string;
  issuer: string;
}

function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export async function createOidcMock(options: OidcMockOptions): Promise<Hono> {
  const app = new Hono();
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  const codes = new Map<string, AuthorizationCode>();
  let identity = "owner-1";

  app.get("/.well-known/openid-configuration", (context) =>
    context.json({
      issuer: options.issuer,
      authorization_endpoint: `${options.issuer}/authorize`,
      token_endpoint: `${options.issuer}/token`,
      jwks_uri: `${options.issuer}/jwks`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"],
    }),
  );

  app.get("/jwks", (context) =>
    context.json({
      keys: [
        {
          ...publicJwk,
          alg: "RS256",
          kid: "e2e-key",
          use: "sig",
        },
      ],
    }),
  );

  app.get("/authorize", (context) => {
    const query = context.req.query();
    const redirectUri = `${options.appOrigin}/auth/callback`;
    if (
      query.client_id !== options.clientId ||
      query.redirect_uri !== redirectUri ||
      query.response_type !== "code" ||
      query.code_challenge_method !== "S256" ||
      !query.state ||
      !query.nonce ||
      !query.code_challenge
    ) {
      return context.json({ error: "invalid_request" }, 400);
    }
    const code = randomUUID();
    codes.set(code, {
      challenge: query.code_challenge,
      nonce: query.nonce,
      subject: identity,
    });
    const callback = new URL(redirectUri);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", query.state);
    return context.redirect(callback.href);
  });

  app.post("/token", async (context) => {
    const body = new URLSearchParams(await context.req.text());
    const code = body.get("code") ?? "";
    const authorization = codes.get(code);
    codes.delete(code);
    if (
      !authorization ||
      body.get("grant_type") !== "authorization_code" ||
      body.get("redirect_uri") !== `${options.appOrigin}/auth/callback` ||
      body.get("client_id") !== options.clientId ||
      body.get("client_secret") !== options.clientSecret ||
      challengeFor(body.get("code_verifier") ?? "") !== authorization.challenge
    ) {
      return context.json({ error: "invalid_grant" }, 400);
    }
    const idToken = await new SignJWT({
      nonce: authorization.nonce,
      email: `${authorization.subject}@example.test`,
      email_verified: true,
    })
      .setProtectedHeader({ alg: "RS256", kid: "e2e-key" })
      .setIssuer(options.issuer)
      .setAudience(options.clientId)
      .setSubject(authorization.subject)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    return context.json({
      access_token: "e2e-access-token",
      token_type: "Bearer",
      id_token: idToken,
    });
  });

  app.post("/__control/identity", async (context) => {
    const body = (await context.req.json()) as { subject?: unknown };
    if (
      typeof body.subject !== "string" ||
      body.subject.length < 1 ||
      body.subject.length > 128
    ) {
      return context.json({ error: "invalid_subject" }, 400);
    }
    identity = body.subject;
    return context.json({ subject: identity });
  });

  return app;
}
