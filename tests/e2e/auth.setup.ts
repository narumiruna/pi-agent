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
    await expect(session.json()).resolves.toMatchObject({
      authenticated: true,
      owner: "owner-1",
    });

    await mkdir(dirname(authState), { recursive: true });
    await page.context().storageState({ path: authState });
  },
);
