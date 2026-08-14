// @vitest-environment jsdom

import { Theme } from "@radix-ui/themes";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../../src/web/App.js";
import { AuthNotification } from "../../src/web/components/AuthNotification.js";
import { DisconnectProviderDialog } from "../../src/web/components/DisconnectProviderDialog.js";
import { InteractionDialog } from "../../src/web/components/InteractionDialog.js";
import { ModelAccessDialog } from "../../src/web/components/ModelAccessDialog.js";
import { ProviderAuthDialog } from "../../src/web/components/ProviderAuthDialog.js";
import i18n, { setLanguage } from "../../src/web/i18n.js";
import { SettingsPage } from "../../src/web/pages/SettingsPage.js";

describe("web application", () => {
  beforeEach(async () => {
    await setLanguage("en");
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  test("shows a focused OIDC login state for unauthenticated visitors", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "unauthorized" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<App />);

    expect(
      await screen.findByRole("button", { name: /Pocket ID/i }),
    ).toBeVisible();
    expect(screen.queryByText("Heartbeat")).not.toBeInTheDocument();
  });

  test("switches between English and Traditional Chinese without a reload", async () => {
    await setLanguage("en");
    expect(i18n.t("newConversation")).toBe("New conversation");

    await setLanguage("zh-TW");
    expect(i18n.t("newConversation")).toBe("新增對話");
    expect(window.localStorage.getItem("pi-agent-language")).toBe("zh-TW");
  });

  test("adds an API key through a focused access flow", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === "/api/models") {
        return new Response(
          JSON.stringify({
            thinkingLevel: "off",
            thinkingLevels: ["off"],
            authPending: false,
            models: [],
            providers: [
              {
                id: "anthropic",
                name: "Anthropic",
                status: { configured: false, disconnectable: false },
                auth: {
                  apiKey: { name: "Anthropic API key" },
                  oauth: {
                    name: "Anthropic (Claude Pro/Max)",
                    subscription: true,
                  },
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (String(input) === "/api/providers/anthropic/login") {
        expect(init?.body).toBe(
          JSON.stringify({ type: "api_key", apiKey: "private-key" }),
        );
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    const user = userEvent.setup();

    render(
      <Theme>
        <SettingsPage
          session={{ authenticated: true, authDisabled: false, tools: [] }}
        />
      </Theme>,
    );

    expect(
      await screen.findByText(/no model access configured/i),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: /add access/i }));
    await user.click(screen.getByRole("tab", { name: /api key/i }));
    await user.click(screen.getByRole("button", { name: /Anthropic/i }));
    const secret = screen.getByLabelText("Anthropic API key");
    expect(secret).toHaveAttribute("type", "password");
    await user.type(secret, "private-key");
    await user.click(screen.getByRole("button", { name: /save api key/i }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/providers/anthropic/login",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(screen.queryByDisplayValue("private-key")).not.toBeInTheDocument();
  });

  test("separates subscriptions from API keys and searches each list", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          thinkingLevel: "off",
          thinkingLevels: ["off"],
          authPending: false,
          models: [],
          providers: [
            {
              id: "anthropic",
              name: "Anthropic",
              status: { configured: false, disconnectable: false },
              auth: {
                apiKey: { name: "Anthropic API key" },
                oauth: {
                  name: "Anthropic (Claude Pro/Max)",
                  subscription: true,
                },
              },
            },
            {
              id: "openai",
              name: "OpenAI",
              status: { configured: false, disconnectable: false },
              auth: { apiKey: { name: "OpenAI API key" } },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const user = userEvent.setup();

    render(
      <Theme>
        <SettingsPage
          session={{ authenticated: true, authDisabled: false, tools: [] }}
        />
      </Theme>,
    );
    await user.click(
      await screen.findByRole("button", { name: /add access/i }),
    );

    expect(screen.getByText("Anthropic (Claude Pro/Max)")).toBeVisible();
    expect(screen.queryByText("OpenAI API key")).not.toBeInTheDocument();
    await user.type(screen.getByRole("searchbox"), "missing");
    expect(screen.getByText(/no matching providers/i)).toBeVisible();
    await user.clear(screen.getByRole("searchbox"));
    await user.click(screen.getByRole("tab", { name: /api key/i }));
    expect(screen.getByText("OpenAI API key")).toBeVisible();
  });

  test("previews a model and applies it only after confirmation", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input) === "/api/model")
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      return new Response(
        JSON.stringify({
          thinkingLevel: "off",
          thinkingLevels: ["off"],
          authPending: false,
          models: [
            { provider: "anthropic", id: "old", name: "Old model" },
            { provider: "anthropic", id: "new", name: "New model" },
          ],
          providers: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const user = userEvent.setup();

    render(
      <Theme>
        <SettingsPage
          session={{ authenticated: true, authDisabled: false, tools: [] }}
        />
      </Theme>,
    );
    await user.click(
      await screen.findByRole("button", { name: /change model/i }),
    );
    const applyModel = screen.getByRole("button", {
      name: /use this model/i,
    });
    expect(applyModel).toBeDisabled();
    await user.click(screen.getByText("New model"));
    expect(applyModel).toBeEnabled();
    expect(fetch).not.toHaveBeenCalledWith(
      "/api/model",
      expect.objectContaining({ method: "PUT" }),
    );
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(fetch).not.toHaveBeenCalledWith(
      "/api/model",
      expect.objectContaining({ method: "PUT" }),
    );

    await user.click(screen.getByRole("button", { name: /change model/i }));
    await user.click(screen.getByText("New model"));
    await user.click(screen.getByRole("button", { name: /use this model/i }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/model",
        expect.objectContaining({
          body: JSON.stringify({ provider: "anthropic", modelId: "new" }),
          method: "PUT",
        }),
      ),
    );
  });

  test("shows a partial credential state when access exists but no model is available", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          thinkingLevel: "off",
          thinkingLevels: ["off"],
          authPending: false,
          models: [],
          providers: [
            {
              id: "anthropic",
              name: "Anthropic",
              status: {
                configured: true,
                source: "stored",
                credentialType: "api_key",
                disconnectable: true,
              },
              auth: { apiKey: { name: "Anthropic API key" } },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    render(
      <Theme>
        <SettingsPage
          session={{ authenticated: true, authDisabled: false, tools: [] }}
        />
      </Theme>,
    );

    expect(await screen.findByText(/api key stored by pi/i)).toBeVisible();
    expect(screen.getByText(/no models are available/i)).toBeVisible();
    expect(
      screen.getByRole("button", { name: /change model/i }),
    ).toBeDisabled();
  });

  test("shows managed credential sources without a disconnect action", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          current: { provider: "openai", id: "gpt", name: "GPT" },
          thinkingLevel: "off",
          thinkingLevels: ["off"],
          authPending: false,
          models: [{ provider: "openai", id: "gpt", name: "GPT" }],
          providers: [
            {
              id: "openai",
              name: "OpenAI",
              status: {
                configured: true,
                source: "environment",
                label: "OPENAI_API_KEY",
                credentialType: "api_key",
                disconnectable: false,
              },
              auth: { apiKey: { name: "OpenAI API key" } },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    render(
      <Theme>
        <SettingsPage
          session={{ authenticated: true, authDisabled: false, tools: [] }}
        />
      </Theme>,
    );

    expect(await screen.findByText("OPENAI_API_KEY")).toBeVisible();
    expect(screen.getByText(/managed outside pi agent/i)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /disconnect/i }),
    ).not.toBeInTheDocument();
  });

  test("offers reconnect for stored subscription access", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input) === "/api/models")
        return new Response(
          JSON.stringify({
            thinkingLevel: "off",
            thinkingLevels: ["off"],
            authPending: false,
            models: [],
            providers: [
              {
                id: "openai-codex",
                name: "OpenAI Codex",
                status: {
                  configured: true,
                  source: "stored",
                  credentialType: "oauth",
                  disconnectable: true,
                },
                auth: {
                  oauth: {
                    name: "OpenAI (ChatGPT Plus/Pro)",
                    subscription: true,
                  },
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      if (String(input) === "/api/providers/openai-codex/login")
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      throw new Error(`Unexpected request: ${String(input)}`);
    });

    render(
      <Theme>
        <SettingsPage
          session={{ authenticated: true, authDisabled: false, tools: [] }}
        />
      </Theme>,
    );
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: /reconnect/i }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/providers/openai-codex/login",
      expect.objectContaining({
        body: JSON.stringify({ type: "oauth" }),
        method: "POST",
      }),
    );
  });

  test("confirms stored credential removal and preserves it on cancel", async () => {
    vi.mocked(fetch).mockImplementation(
      async (input) =>
        new Response(
          JSON.stringify(
            String(input) === "/api/models"
              ? {
                  thinkingLevel: "off",
                  thinkingLevels: ["off"],
                  authPending: false,
                  models: [],
                  providers: [
                    {
                      id: "anthropic",
                      name: "Anthropic",
                      status: {
                        configured: true,
                        source: "stored",
                        credentialType: "api_key",
                        disconnectable: true,
                      },
                      auth: { apiKey: { name: "Anthropic API key" } },
                    },
                  ],
                }
              : { ok: true },
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const user = userEvent.setup();

    render(
      <Theme>
        <SettingsPage
          session={{ authenticated: true, authDisabled: false, tools: [] }}
        />
      </Theme>,
    );
    await user.click(
      await screen.findByRole("button", { name: /disconnect/i }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(/Anthropic/);
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(fetch).not.toHaveBeenCalledWith(
      "/api/providers/anthropic/logout",
      expect.anything(),
    );
  });

  test("restores a pending authentication flow through application bootstrap", async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    class FakeEventSource {
      onerror: (() => void) | null = null;
      onopen: (() => void) | null = null;

      addEventListener(): void {}
      close(): void {}
    }
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input) === "/api/session")
        return new Response(
          JSON.stringify({
            authenticated: true,
            authDisabled: false,
            tools: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      if (String(input) === "/api/conversations")
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (String(input) === "/api/provider-auth")
        return new Response(
          JSON.stringify({
            providerId: "openai-codex",
            providerName: "OpenAI Codex",
            phase: "waiting",
            method: "device_code",
            userCode: "BOOTSTRAP-1",
            verificationUri: "https://auth.openai.com/codex/device",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      throw new Error(`Unexpected request: ${String(input)}`);
    });

    render(<App />);

    expect(await screen.findByRole("dialog")).toHaveTextContent("BOOTSTRAP-1");
  });

  test("restores a pending authentication flow after page reload", () => {
    render(
      <Theme>
        <ProviderAuthDialog
          task={{
            providerId: "openai-codex",
            providerName: "OpenAI Codex",
            phase: "waiting",
            method: "device_code",
            userCode: "RESTORED-1",
            verificationUri: "https://auth.openai.com/codex/device",
          }}
          onChooseModel={() => undefined}
          onDismiss={() => undefined}
          onInteractionClose={() => undefined}
          onRetry={() => undefined}
        />
      </Theme>,
    );

    expect(screen.getByRole("dialog")).toHaveTextContent("RESTORED-1");
    expect(
      screen.getByRole("button", { name: /cancel sign-in/i }),
    ).toBeVisible();
  });

  test("closes the access dialog while OAuth continues so recovery stays reachable", async () => {
    let finish: ((value: boolean) => void) | undefined;
    const onOAuth = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const onOpenChange = vi.fn();

    render(
      <Theme>
        <ModelAccessDialog
          open
          pending={false}
          providers={[
            {
              id: "anthropic",
              name: "Anthropic",
              status: { configured: false, disconnectable: false },
              auth: {
                oauth: {
                  name: "Anthropic (Claude Pro/Max)",
                  subscription: true,
                },
              },
            },
          ]}
          onApiKey={async () => true}
          onCancelAuth={async () => undefined}
          onOAuth={onOAuth}
          onOpenChange={onOpenChange}
        />
      </Theme>,
    );

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Anthropic/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    finish?.(true);
  });

  test("disables access choices while authentication is pending and cancels safely", async () => {
    const onCancelAuth = vi.fn(async () => undefined);
    const onOpenChange = vi.fn();

    render(
      <Theme>
        <ModelAccessDialog
          open
          pending
          providers={[
            {
              id: "anthropic",
              name: "Anthropic",
              status: { configured: false, disconnectable: false },
              auth: {
                oauth: {
                  name: "Anthropic (Claude Pro/Max)",
                  subscription: true,
                },
              },
            },
          ]}
          onApiKey={async () => true}
          onCancelAuth={onCancelAuth}
          onOAuth={async () => true}
          onOpenChange={onOpenChange}
        />
      </Theme>,
    );

    expect(screen.getByRole("button", { name: /Anthropic/i })).toBeDisabled();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(onCancelAuth).toHaveBeenCalledOnce());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("warns when disconnecting the current model provider", () => {
    render(
      <Theme>
        <DisconnectProviderDialog
          open
          pending={false}
          provider={{
            id: "anthropic",
            name: "Anthropic",
            status: {
              configured: true,
              source: "stored",
              disconnectable: true,
            },
            auth: {},
          }}
          currentProvider="anthropic"
          onConfirm={async () => true}
          onOpenChange={() => undefined}
        />
      </Theme>,
    );

    expect(screen.getByRole("dialog")).toHaveTextContent(
      /current model provider/i,
    );
  });

  test("shows loading and actionable provider errors", async () => {
    let rejectRequest: ((reason: Error) => void) | undefined;
    vi.mocked(fetch).mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectRequest = reject;
      }),
    );

    render(
      <Theme>
        <SettingsPage
          session={{ authenticated: true, authDisabled: false, tools: [] }}
        />
      </Theme>,
    );

    expect(screen.getByText(/loading model access/i)).toBeVisible();
    rejectRequest?.(new Error("network_failed"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "network_failed",
    );
    expect(screen.getByRole("button", { name: /try again/i })).toBeVisible();
  });

  test("recommends Codex device code and submits the selected login method", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const onInteractionClose = vi.fn();

    render(
      <Theme>
        <ProviderAuthDialog
          task={{
            providerId: "openai-codex",
            providerName: "OpenAI Codex",
            phase: "waiting",
            method: "choose_method",
          }}
          interaction={{
            id: "method",
            kind: "select",
            scope: "provider_auth",
            title: "Select OpenAI Codex login method:",
            options: [
              { id: "browser", label: "Browser login (default)" },
              {
                id: "device_code",
                label: "Device code login (headless)",
              },
            ],
          }}
          onChooseModel={() => undefined}
          onDismiss={() => undefined}
          onInteractionClose={onInteractionClose}
          onRetry={() => undefined}
        />
      </Theme>,
    );

    const methods = screen.getAllByRole("radio");
    expect(methods[0]).toHaveAccessibleName(/^device code$/i);
    expect(methods[0]).toBeChecked();
    expect(screen.getByText(/recommended for Docker/i)).toBeVisible();
    const primaryAction = screen.getByRole("button", {
      name: /continue with device code/i,
    });
    expect(primaryAction).toBeVisible();
    await userEvent.setup().click(primaryAction);
    expect(fetch).toHaveBeenCalledWith(
      "/api/interactions/method",
      expect.objectContaining({
        body: JSON.stringify({ value: "device_code" }),
        method: "POST",
      }),
    );
    expect(onInteractionClose).toHaveBeenCalledOnce();
  });

  test("keeps non-Codex subscription device codes provider neutral", () => {
    render(
      <Theme>
        <ProviderAuthDialog
          task={{
            providerId: "radius",
            providerName: "Radius",
            phase: "waiting",
            method: "device_code",
            userCode: "RADIUS-1",
            verificationUri: "https://radius.example/device",
          }}
          onChooseModel={() => undefined}
          onDismiss={() => undefined}
          onInteractionClose={() => undefined}
          onRetry={() => undefined}
        />
      </Theme>,
    );

    expect(
      screen.getByRole("link", { name: /open provider/i }),
    ).toHaveAttribute("href", "https://radius.example/device");
    expect(screen.queryByText(/ChatGPT/i)).not.toBeInTheDocument();
  });

  test("shows a Codex device code without requiring notification text", async () => {
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);

    render(
      <Theme>
        <ProviderAuthDialog
          task={{
            providerId: "openai-codex",
            providerName: "OpenAI Codex",
            phase: "waiting",
            method: "device_code",
            userCode: "ABCD-1234",
            verificationUri: "https://auth.openai.com/codex/device",
            expiresAt: Date.now() + 900_000,
          }}
          onChooseModel={() => undefined}
          onDismiss={() => undefined}
          onInteractionClose={() => undefined}
          onRetry={() => undefined}
        />
      </Theme>,
    );

    expect(
      screen.getByRole("status", { name: /device code/i }),
    ).toHaveTextContent("ABCD-1234");
    expect(screen.getByRole("link", { name: /open OpenAI/i })).toHaveAttribute(
      "href",
      "https://auth.openai.com/codex/device",
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /copy code/i }));
    expect(writeText).toHaveBeenCalledWith("ABCD-1234");
    expect(screen.getByText(/waiting for OpenAI/i)).toBeVisible();
  });

  test("keeps browser login and manual redirect entry in one auth task", async () => {
    render(
      <Theme>
        <ProviderAuthDialog
          task={{
            providerId: "openai-codex",
            providerName: "OpenAI Codex",
            phase: "waiting",
            method: "browser",
            url: "https://auth.openai.com/oauth/authorize",
            message: "Complete login in your browser.",
          }}
          interaction={{
            id: "manual",
            kind: "text",
            scope: "provider_auth",
            title: "Paste the authorization code or redirect URL",
            placeholder: "http://localhost:1455/auth/callback",
          }}
          onChooseModel={() => undefined}
          onDismiss={() => undefined}
          onInteractionClose={() => undefined}
          onRetry={() => undefined}
        />
      </Theme>,
    );

    expect(screen.getByRole("link", { name: /open OpenAI/i })).toHaveAttribute(
      "href",
      "https://auth.openai.com/oauth/authorize",
    );
    expect(
      screen.getByLabelText(/authorization code or redirect URL/i),
    ).toBeVisible();
    expect(screen.getByText(/callback may not reach Docker/i)).toBeVisible();
  });

  test("offers model selection only after subscription authentication succeeds", async () => {
    const onChooseModel = vi.fn();
    render(
      <Theme>
        <ProviderAuthDialog
          task={{
            providerId: "openai-codex",
            providerName: "OpenAI Codex",
            phase: "succeeded",
          }}
          onChooseModel={onChooseModel}
          onDismiss={() => undefined}
          onInteractionClose={() => undefined}
          onRetry={() => undefined}
        />
      </Theme>,
    );

    expect(screen.getByRole("status")).toHaveTextContent(/connected/i);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /choose a model/i }));
    expect(onChooseModel).toHaveBeenCalledOnce();
  });

  test("moves an expired device code to a retry state", () => {
    render(
      <Theme>
        <ProviderAuthDialog
          task={{
            providerId: "openai-codex",
            providerName: "OpenAI Codex",
            phase: "waiting",
            method: "device_code",
            userCode: "EXPIRED-1",
            verificationUri: "https://auth.openai.com/codex/device",
            expiresAt: Date.now() - 1,
          }}
          onChooseModel={() => undefined}
          onDismiss={() => undefined}
          onInteractionClose={() => undefined}
          onRetry={() => undefined}
        />
      </Theme>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/expired/i);
    expect(screen.getByRole("button", { name: /try again/i })).toBeVisible();
  });

  test("cancels an expired device login before retrying", async () => {
    let finishCancellation: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementation((input) => {
      if (String(input) === "/api/providers/login/cancel")
        return new Promise<Response>((resolve) => {
          finishCancellation = resolve;
        });
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    const onDismiss = vi.fn();
    const onRetry = vi.fn();

    render(
      <Theme>
        <ProviderAuthDialog
          task={{
            providerId: "openai-codex",
            providerName: "OpenAI Codex",
            phase: "waiting",
            method: "device_code",
            userCode: "EXPIRED-1",
            verificationUri: "https://auth.openai.com/codex/device",
            expiresAt: Date.now() - 1,
          }}
          onChooseModel={() => undefined}
          onDismiss={onDismiss}
          onInteractionClose={() => undefined}
          onRetry={onRetry}
        />
      </Theme>,
    );

    const click = userEvent
      .setup()
      .click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/providers/login/cancel",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(onRetry).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /try again/i })).toBeDisabled();

    finishCancellation?.(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await click;
    await waitFor(() => expect(onRetry).toHaveBeenCalledWith("openai-codex"));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  test("keeps cancelled authentication recoverable", () => {
    render(
      <Theme>
        <ProviderAuthDialog
          task={{
            providerId: "openai-codex",
            providerName: "OpenAI Codex",
            phase: "cancelled",
          }}
          onChooseModel={() => undefined}
          onDismiss={() => undefined}
          onInteractionClose={() => undefined}
          onRetry={() => undefined}
        />
      </Theme>,
    );

    expect(screen.getByRole("status")).toHaveTextContent(/cancelled/i);
    expect(screen.getByRole("button", { name: /try again/i })).toBeVisible();
  });

  test("keeps failed authentication recoverable without exposing details", async () => {
    const onRetry = vi.fn();
    render(
      <Theme>
        <ProviderAuthDialog
          task={{
            providerId: "openai-codex",
            providerName: "OpenAI Codex",
            phase: "failed",
            error: "login_failed",
          }}
          onChooseModel={() => undefined}
          onDismiss={() => undefined}
          onInteractionClose={() => undefined}
          onRetry={onRetry}
        />
      </Theme>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/could not connect/i);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledWith("openai-codex");
    expect(screen.queryByText(/secret/i)).not.toBeInTheDocument();
  });

  test("keeps OAuth recovery links and device codes directly actionable", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);

    render(
      <Theme>
        <AuthNotification
          notification={{
            message: "Complete provider sign-in",
            url: "https://provider.example/authorize",
            code: "ABCD-1234",
          }}
          onClose={() => undefined}
        />
      </Theme>,
    );

    expect(
      screen.getByRole("link", { name: /open provider/i }),
    ).toHaveAttribute("href", "https://provider.example/authorize");
    expect(screen.getByText("ABCD-1234")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith("ABCD-1234");
    expect(screen.getByRole("button", { name: /copied/i })).toBeVisible();
  });

  test("keeps OAuth recovery inside an active interaction dialog", () => {
    render(
      <InteractionDialog
        interaction={{ id: "code", kind: "text", title: "Paste code" }}
        authNotification={{
          message: "Open the provider first",
          url: "https://provider.example/authorize",
        }}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByRole("dialog")).toContainElement(
      screen.getByRole("link", { name: /open provider/i }),
    );
  });

  test("keeps interaction dialogs keyboard operable", async () => {
    const onClose = vi.fn();
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    render(
      <InteractionDialog
        interaction={{ id: "one", kind: "input", title: "Your answer" }}
        onClose={onClose}
      />,
    );

    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: "Your answer" }),
      "hello",
    );
    await user.click(screen.getByRole("button", { name: i18n.t("continue") }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledWith(
      "/api/interactions/one",
      expect.objectContaining({
        body: JSON.stringify({ value: "hello" }),
        method: "POST",
      }),
    );
  });

  test("responds to the broker when a dialog is cancelled", async () => {
    const onClose = vi.fn();
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    render(
      <InteractionDialog
        interaction={{ id: "cancelled", kind: "confirm", title: "Continue?" }}
        onClose={onClose}
      />,
    );

    await userEvent.setup().keyboard("{Escape}");

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledWith(
      "/api/interactions/cancelled",
      expect.objectContaining({ body: "{}", method: "POST" }),
    );
  });
});
