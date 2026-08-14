import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { main } from "../../../src/server/index.js";
import { createModelMock } from "./mock-model.js";
import { createOidcMock } from "./mock-oidc.js";
import { prepareRuntime } from "./runtime.js";

const runtime = await prepareRuntime();
const mock = new Hono();
const oidc = await createOidcMock({
  appOrigin: runtime.appOrigin,
  clientId: "pi-agent-e2e",
  clientSecret: "e2e-client-secret",
  issuer: runtime.mockOrigin,
});
mock.route("/", oidc);
mock.route("/", createModelMock());

const mockServer = serve({
  fetch: mock.fetch,
  hostname: "127.0.0.1",
  port: runtime.mockPort,
});

try {
  await main();
  console.log(
    `E2E app ready at ${runtime.appOrigin} with mocks at ${runtime.mockOrigin}`,
  );
} catch (error) {
  await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  throw error;
}
