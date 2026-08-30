import { buildApp } from "./app.js";
import { loadAppConfig } from "./config.js";
import { createDatabasePool } from "./db.js";

const config = loadAppConfig();
const pool = createDatabasePool(config.databaseUrl);
const app = await buildApp({ config, pool });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exit(1);
}
