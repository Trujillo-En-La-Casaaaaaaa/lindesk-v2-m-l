import pg from "pg";
import { createApp } from "./container.js";
import { initializeDatabase } from "./repositories/schema.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const pool = new pg.Pool({ connectionString: databaseUrl });
await initializeDatabase(pool);

const port = Number(process.env.PORT || 3000);
const server = createApp(pool).listen(port, () => {
  console.log(`ShopFlow Legacy listening on ${port}`);
});

async function shutdown() {
  server.close();
  await pool.end();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
