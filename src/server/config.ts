import { join, resolve } from "node:path";

const TOOL_NAMES = new Set([
  "bash",
  "edit",
  "find",
  "grep",
  "ls",
  "read",
  "write",
]);
const DEFAULT_TOOLS = ["read", "grep", "find", "ls"];

type Environment = Record<string, string | undefined>;

export interface OidcAuthConfig {
  mode: "oidc";
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  ownerSub?: string;
  ownerEmail?: string;
}

export interface DisabledAuthConfig {
  mode: "disabled";
}

export interface AppConfig {
  host: string;
  port: number;
  appOrigin: string;
  agentDir: string;
  dataDir: string;
  workspace: string;
  databaseUrl?: string;
  sqlitePath: string;
  agentTools: string[];
  auth: OidcAuthConfig | DisabledAuthConfig;
}

function parseOrigin(raw: string): string {
  const url = new URL(raw);
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "APP_ORIGIN must be an http(s) origin without a path, query, or credentials",
    );
  }
  return url.origin;
}

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

function required(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseTools(raw: string | undefined): string[] {
  const tools = raw ? raw.split(",").map((tool) => tool.trim()) : DEFAULT_TOOLS;
  if (tools.length === 0 || tools.some((tool) => !TOOL_NAMES.has(tool))) {
    throw new Error("AGENT_TOOLS contains an unknown tool");
  }
  return [...new Set(tools)];
}

export function parseConfig(env: Environment = process.env): AppConfig {
  const authMode = env.AUTH_MODE?.trim() || "oidc";
  if (authMode !== "oidc" && authMode !== "disabled") {
    throw new Error("AUTH_MODE must be oidc or disabled");
  }

  const appOrigin = parseOrigin(
    env.APP_ORIGIN?.trim() || "http://localhost:3000",
  );
  const agentDir = resolve(env.PI_CODING_AGENT_DIR?.trim() || "/app/.pi/agent");
  const dataDir = resolve(env.DATA_DIR?.trim() || "/app/data");
  const workspace = resolve(env.WORKSPACE?.trim() || "/workspace");
  const host = env.HOST?.trim() || "0.0.0.0";
  if (host.length > 253 || /[\s/\\]/.test(host))
    throw new Error("HOST is invalid");
  const port = Number(env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error("PORT must be between 1 and 65535");

  let auth: AppConfig["auth"];
  if (authMode === "disabled") {
    auth = { mode: "disabled" };
  } else {
    const ownerSub = env.OIDC_OWNER_SUB?.trim() || undefined;
    const ownerEmail = env.OIDC_OWNER_EMAIL?.trim() || undefined;
    if (!ownerSub && !ownerEmail) {
      throw new Error(
        "OIDC configuration is required and must include OIDC_OWNER_SUB or OIDC_OWNER_EMAIL",
      );
    }
    const publicUrl = new URL(appOrigin);
    if (
      publicUrl.protocol !== "https:" &&
      !isLocalHostname(publicUrl.hostname)
    ) {
      throw new Error(
        "OIDC deployments require an HTTPS APP_ORIGIN unless running on localhost",
      );
    }
    const issuerUrl = new URL(required(env, "OIDC_ISSUER_URL"));
    if (
      !/^https?:$/.test(issuerUrl.protocol) ||
      issuerUrl.username ||
      issuerUrl.password ||
      issuerUrl.search ||
      issuerUrl.hash
    ) {
      throw new Error(
        "OIDC_ISSUER_URL must use http or https without credentials, query, or fragment",
      );
    }
    if (
      issuerUrl.protocol !== "https:" &&
      !isLocalHostname(issuerUrl.hostname)
    ) {
      throw new Error(
        "OIDC_ISSUER_URL requires HTTPS unless running on localhost",
      );
    }
    auth = {
      mode: "oidc",
      issuerUrl: issuerUrl.href,
      clientId: required(env, "OIDC_CLIENT_ID"),
      clientSecret: required(env, "OIDC_CLIENT_SECRET"),
      ...(ownerSub ? { ownerSub } : {}),
      ...(ownerEmail ? { ownerEmail } : {}),
    };
  }

  const databaseUrl = env.DATABASE_URL?.trim();
  return {
    host,
    port,
    appOrigin,
    agentDir,
    dataDir,
    workspace,
    ...(databaseUrl ? { databaseUrl } : {}),
    sqlitePath: join(dataDir, "app.db"),
    agentTools: parseTools(env.AGENT_TOOLS),
    auth,
  };
}
