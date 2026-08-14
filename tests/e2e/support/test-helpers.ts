import { AxeBuilder } from "@axe-core/playwright";
import { type APIRequestContext, expect, type Page } from "@playwright/test";

export const appPort = Number(process.env.E2E_APP_PORT ?? "39110");
export const mockPort = Number(process.env.E2E_MOCK_PORT ?? "39111");
export const appOrigin = `http://127.0.0.1:${appPort}`;
export const mockOrigin = `http://127.0.0.1:${mockPort}`;

export async function selectIdentity(
  request: APIRequestContext,
  subject: string,
): Promise<void> {
  const response = await request.post(`${mockOrigin}/__control/identity`, {
    data: { subject },
  });
  expect(response.ok()).toBe(true);
}

export async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /Pocket ID/i }).click();
  await expect(page).toHaveURL(`${appOrigin}/`);
  await expect(page.getByRole("region", { name: "Chat" })).toBeVisible();
}

export async function expectNoSeriousAccessibilityViolations(
  page: Page,
): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const violations = result.violations
    .filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    )
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => ({
        html: node.html,
        summary: node.failureSummary,
        target: node.target,
      })),
    }));
  expect(violations).toEqual([]);
}
