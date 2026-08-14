import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  appOrigin,
  expectNoSeriousAccessibilityViolations,
  mockOrigin,
  selectIdentity,
  signIn,
} from "../support/test-helpers.js";

function challenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

test.beforeEach(async ({ request }) => {
  await selectIdentity(request, "owner-1");
});

test("keeps unauthenticated visitors at the Pocket ID boundary", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await page.goto(appOrigin);

  await expect(page.getByRole("button", { name: /Pocket ID/i })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
  expect((await context.request.get(`${appOrigin}/api/session`)).status()).toBe(
    401,
  );
  await context.close();
});

test("mock issuer rejects an invalid PKCE verifier", async ({ request }) => {
  const verifier = "correct-e2e-verifier-with-enough-entropy-1234567890";
  const authorize = new URL(`${mockOrigin}/authorize`);
  authorize.searchParams.set("client_id", "pi-agent-e2e");
  authorize.searchParams.set("redirect_uri", `${appOrigin}/auth/callback`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "openid");
  authorize.searchParams.set("state", "pkce-state");
  authorize.searchParams.set("nonce", "pkce-nonce");
  authorize.searchParams.set("code_challenge", challenge(verifier));
  authorize.searchParams.set("code_challenge_method", "S256");

  const authorization = await request.get(authorize.href, { maxRedirects: 0 });
  expect(authorization.status()).toBe(302);
  const callback = new URL(authorization.headers().location as string);
  const token = await request.post(`${mockOrigin}/token`, {
    form: {
      grant_type: "authorization_code",
      code: callback.searchParams.get("code") as string,
      redirect_uri: `${appOrigin}/auth/callback`,
      client_id: "pi-agent-e2e",
      client_secret: "e2e-client-secret",
      code_verifier: "wrong-verifier",
    },
  });
  expect(token.status()).toBe(400);
  await expect(token.json()).resolves.toEqual({ error: "invalid_grant" });
});

test("rejects a second identity without invalidating the owner", async ({
  browser,
  page,
  request,
}) => {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const visitor = await context.newPage();
  try {
    await selectIdentity(request, "other-user");
    await visitor.goto(appOrigin);
    const callback = visitor.waitForResponse((response) =>
      response.url().startsWith(`${appOrigin}/auth/callback`),
    );
    await visitor.getByRole("button", { name: /Pocket ID/i }).click();
    expect((await callback).status()).toBe(401);
    await expect(visitor.getByText(/unauthorized/i)).toBeVisible();
  } finally {
    await selectIdentity(request, "owner-1");
    await context.close();
  }

  const ownerSession = await page.request.get("/api/session");
  expect(ownerSession.status()).toBe(200);
  await expect(ownerSession.json()).resolves.toMatchObject({
    owner: "owner-1",
  });
});

test("logs out only the current owner session", async ({
  browser,
  page,
  request,
}) => {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const owner = await context.newPage();
  await selectIdentity(request, "owner-1");
  await signIn(owner);
  await owner.getByRole("button", { name: "Settings" }).click();
  await owner.getByRole("button", { name: "Sign out" }).click();
  await expect(owner.getByRole("button", { name: /Pocket ID/i })).toBeVisible();
  expect((await context.request.get(`${appOrigin}/api/session`)).status()).toBe(
    401,
  );
  await context.close();

  expect((await page.request.get("/api/session")).status()).toBe(200);
});
