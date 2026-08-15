import { mkdir, open, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import postgres from "postgres";

const E2E_ROOT = resolve(".local/e2e");
const RUNTIME_ROOT = resolve(E2E_ROOT, "runtime");
const STATE_ROOT = resolve(E2E_ROOT, "state");

export interface E2eRuntime {
  appOrigin: string;
  appPort: number;
  mockOrigin: string;
  mockPort: number;
}

function port(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("E2E ports must be integers between 1 and 65535");
  }
  return parsed;
}

function assertContained(path: string): void {
  if (!path.startsWith(`${E2E_ROOT}${sep}`)) {
    throw new Error(`Refusing to modify path outside ${E2E_ROOT}`);
  }
}

async function resetPostgres(databaseUrl: string): Promise<void> {
  const database = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!database.toLowerCase().includes("e2e")) {
    throw new Error("E2E_DATABASE_URL must target a database containing e2e");
  }
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`DROP TABLE IF EXISTS heartbeat_runs, web_sessions, app_owner, schema_migrations CASCADE`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function prepareRuntime(): Promise<E2eRuntime> {
  assertContained(RUNTIME_ROOT);
  assertContained(STATE_ROOT);
  await Promise.all([
    rm(RUNTIME_ROOT, { recursive: true, force: true }),
    rm(STATE_ROOT, { recursive: true, force: true }),
  ]);

  const agentDir = resolve(RUNTIME_ROOT, "agent");
  const dataDir = resolve(RUNTIME_ROOT, "data");
  const workspace = resolve(RUNTIME_ROOT, "workspace");
  const home = resolve(RUNTIME_ROOT, "home");
  await Promise.all([
    mkdir(agentDir, { recursive: true }),
    mkdir(dataDir, { recursive: true }),
    mkdir(workspace, { recursive: true }),
    mkdir(home, { recursive: true }),
    mkdir(STATE_ROOT, { recursive: true }),
  ]);
  await Promise.all([
    mkdir(join(workspace, "src")),
    mkdir(join(workspace, "workers")),
    mkdir(join(workspace, ".git")),
  ]);
  await Promise.all([
    writeFile(
      join(workspace, "src", "existing.ts"),
      "export const value = 1;\n",
    ),
    writeFile(join(workspace, "binary.dat"), Buffer.from([0, 1, 2, 3])),
    writeFile(join(workspace, ".env"), "E2E_SECRET=hidden\n"),
    writeFile(join(workspace, ".git", "config"), "private\n"),
    writeFile(join(workspace, "workers", "config.json"), '{"valid":true}\n'),
    writeFile(join(workspace, "workers", "page.html"), "<main>worker</main>\n"),
    writeFile(
      join(workspace, "workers", "style.css"),
      "main { color: teal; }\n",
    ),
  ]);
  const largePreview = await open(join(workspace, "large-preview.txt"), "w");
  await largePreview.truncate(1_000_001);
  await largePreview.close();

  const appPort = port(process.env.E2E_APP_PORT, 39_110);
  const mockPort = port(process.env.E2E_MOCK_PORT, 39_111);
  if (appPort === mockPort)
    throw new Error("E2E app and mock ports must differ");
  const appOrigin = `http://127.0.0.1:${appPort}`;
  const mockOrigin = `http://127.0.0.1:${mockPort}`;

  await Promise.all([
    writeFile(
      resolve(agentDir, "models.json"),
      `${JSON.stringify(
        {
          providers: {
            e2e: {
              baseUrl: `${mockOrigin}/v1`,
              api: "openai-completions",
              apiKey: "e2e-key",
              compat: {
                supportsDeveloperRole: false,
                supportsReasoningEffort: false,
              },
              models: [
                {
                  id: "e2e-primary",
                  name: "E2E Primary",
                  contextWindow: 16_384,
                  maxTokens: 2_048,
                },
                {
                  id: "e2e-secondary",
                  name: "E2E Secondary",
                  contextWindow: 16_384,
                  maxTokens: 2_048,
                },
              ],
            },
          },
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    ),
    writeFile(
      resolve(agentDir, "settings.json"),
      `${JSON.stringify(
        {
          defaultProvider: "e2e",
          defaultModel: "e2e-primary",
          defaultThinkingLevel: "off",
          defaultProjectTrust: "never",
          enableInstallTelemetry: false,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    ),
  ]);

  const databaseUrl = process.env.E2E_DATABASE_URL?.trim();
  if (databaseUrl) await resetPostgres(databaseUrl);

  Object.assign(process.env, {
    APP_ORIGIN: appOrigin,
    AUTH_MODE: "oidc",
    OIDC_ISSUER_URL: mockOrigin,
    OIDC_CLIENT_ID: "pi-agent-e2e",
    OIDC_CLIENT_SECRET: "e2e-client-secret",
    AGENT_TOOLS: "read",
    HOST: "127.0.0.1",
    PORT: String(appPort),
    PI_CODING_AGENT_DIR: agentDir,
    DATA_DIR: dataDir,
    WORKSPACE: workspace,
    HOME: home,
    PI_OFFLINE: "1",
  });
  if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
  else delete process.env.DATABASE_URL;

  return { appOrigin, appPort, mockOrigin, mockPort };
}
