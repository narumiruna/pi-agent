import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test as setup } from "@playwright/test";
import { authState } from "../../playwright.config.js";
import { selectIdentity, signIn } from "./support/test-helpers.js";

setup(
  "claims the first verified OIDC identity as owner",
  async ({ page, request }) => {
    await selectIdentity(request, "owner-1");
    await signIn(page);

    const session = await page.request.get("/api/session");
    expect(session.status()).toBe(200);
    const body = await session.json();
    expect(body).toMatchObject({ authenticated: true });
    expect(body).not.toHaveProperty("owner");

    await mkdir(dirname(authState), { recursive: true });
    await page.context().storageState({ path: authState });
  },
);
