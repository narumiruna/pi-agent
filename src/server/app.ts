import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import { apiError } from "../shared/contracts.js";
import { type ApiServices, registerApi } from "./api.js";
import { type AuthService, createAuthService } from "./auth/service.js";
import type { AppConfig } from "./config.js";
import type { AppStore, WebSessionRecord } from "./storage/types.js";

const SESSION_COOKIE = "pi_agent_session";
const STATE_COOKIE = "pi_agent_oidc";

export interface AppBindings {
  Variables: {
    session?: WebSessionRecord;
  };
}

export interface CreateAppOptions {
  config: AppConfig;
  store: AppStore;
  authService?: AuthService;
  ready?: () => boolean;
  services?: Omit<ApiServices, "config" | "store">;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function encodeOidcState(value: object, secret: string): string {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function decodeOidcState<T>(value: string, secret: string): T {
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra)
    throw new Error("Invalid OIDC state cookie");
  const expected = createHmac("sha256", secret).update(payload).digest();
  const received = Buffer.from(signature, "base64url");
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  ) {
    throw new Error("Invalid OIDC state cookie signature");
  }
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T;
}

export function createApp(options: CreateAppOptions): Hono<AppBindings> {
  const app = new Hono<AppBindings>();
  const auth =
    options.authService ??
    (options.config.auth.mode === "oidc"
      ? createAuthService({
          config: options.config.auth,
          appOrigin: options.config.appOrigin,
          store: options.store,
        })
      : undefined);

  app.use("*", secureHeaders());
  app.use("/api/*", async (context, next) => {
    await next();
    context.header("cache-control", "no-store");
  });
  app.use("/auth/*", async (context, next) => {
    await next();
    context.header("cache-control", "no-store");
  });
  const defaultBodyLimit = bodyLimit({
    maxSize: 2_000_000,
    onError: (context) => context.json(apiError("bad_request"), 413),
  });
  const messageBodyLimit = bodyLimit({
    maxSize: 8_000_000,
    onError: (context) => context.json(apiError("bad_request"), 413),
  });
  const importBodyLimit = bodyLimit({
    maxSize: 12_000_000,
    onError: (context) => context.json(apiError("bad_request"), 413),
  });
  app.use("/api/*", (context, next) => {
    const path = context.req.path.split("/");
    const limit =
      path.length === 4 &&
      path[1] === "api" &&
      path[2] === "conversations" &&
      path[3] === "import"
        ? importBodyLimit
        : path.length === 5 &&
            path[1] === "api" &&
            path[2] === "conversations" &&
            path[4] !== undefined &&
            ["follow-up", "messages", "steer"].includes(path[4])
          ? messageBodyLimit
          : defaultBodyLimit;
    return limit(context, next);
  });
  app.get("/health/live", (context) => context.json({ status: "ok" }));
  app.get("/health/ready", (context) =>
    options.ready?.() === false
      ? context.json(apiError("not_ready"), 503)
      : context.json({ status: "ready" }),
  );

  app.get("/auth/login", async (context) => {
    if (!auth) return context.redirect("/");
    const login = await auth.beginLogin();
    const state = encodeOidcState(
      {
        state: login.state,
        nonce: login.nonce,
        codeVerifier: login.codeVerifier,
      },
      options.config.auth.mode === "oidc"
        ? options.config.auth.clientSecret
        : "disabled",
    );
    setCookie(context, STATE_COOKIE, state, {
      httpOnly: true,
      secure: options.config.appOrigin.startsWith("https://"),
      sameSite: "Lax",
      path: "/auth/callback",
      maxAge: 600,
    });
    return context.redirect(login.authorizationUrl);
  });

  app.get("/auth/callback", async (context) => {
    if (!auth) return context.redirect("/");
    const encoded = getCookie(context, STATE_COOKIE);
    deleteCookie(context, STATE_COOKIE, { path: "/auth/callback" });
    if (!encoded) return context.json(apiError("unauthorized"), 401);
    let expected: { state: string; nonce: string; codeVerifier: string };
    try {
      expected = decodeOidcState<typeof expected>(
        encoded,
        options.config.auth.mode === "oidc"
          ? options.config.auth.clientSecret
          : "disabled",
      );
    } catch {
      return context.json(apiError("unauthorized"), 401);
    }
    const code = context.req.query("code");
    const state = context.req.query("state");
    if (!code || !state) return context.json(apiError("bad_request"), 400);
    try {
      const token = await auth.completeLogin({
        code,
        state,
        expectedState: expected.state,
        expectedNonce: expected.nonce,
        codeVerifier: expected.codeVerifier,
      });
      setCookie(context, SESSION_COOKIE, token, {
        httpOnly: true,
        secure: options.config.appOrigin.startsWith("https://"),
        sameSite: "Lax",
        path: "/",
        maxAge: 86_400,
      });
      return context.redirect("/");
    } catch {
      return context.json(apiError("unauthorized"), 401);
    }
  });

  app.use("/api/*", async (context, next) => {
    if (options.config.auth.mode === "disabled") return next();
    const token = getCookie(context, SESSION_COOKIE);
    const session = auth ? await auth.authenticate(token) : undefined;
    if (!session) return context.json(apiError("unauthorized"), 401);
    context.set("session", session);
    return next();
  });

  app.use("/api/*", async (context, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(context.req.method)) return next();
    if (context.req.header("origin") !== options.config.appOrigin) {
      return context.json(apiError("origin_mismatch"), 403);
    }
    return next();
  });

  app.get("/api/session", (context) =>
    context.json({
      authenticated: true,
      authDisabled: options.config.auth.mode === "disabled",
      owner: context.get("session")?.subject,
      tools: options.config.agentTools,
    }),
  );

  app.post("/api/logout", async (context) => {
    const token = getCookie(context, SESSION_COOKIE);
    if (auth) await auth.logout(token);
    deleteCookie(context, SESSION_COOKIE, { path: "/" });
    return context.json({ ok: true });
  });

  if (options.services) {
    registerApi(app, {
      config: options.config,
      store: options.store,
      ...options.services,
    });
  }

  app.onError((error, context) => {
    console.error("Request failed", {
      path: context.req.path,
      error: hash(error.message),
    });
    return context.json(apiError("internal_error"), 500);
  });

  return app;
}
