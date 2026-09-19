import assert from "node:assert/strict";
import fs from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { createApp } from "../../container.js";
import type { NotificationRecord } from "../../models/notification.js";
import { initializeDatabase } from "../../repositories/schema.js";

/**
 * Integration harness: builds the real wired application (composition root) on a
 * real PostgreSQL pool, listens on a loopback port, and exposes raw SQL so tests
 * can assert persistence directly.
 *
 * `resetFixture` restores the documented seed baseline of the throwaway
 * integration database (`docker compose up -d db`), which keeps the suite
 * deterministic across runs.
 */
export const seedStock = { "prod-a": 20, "prod-b": 10 } as const;

export interface IntegrationContextOptions {
  notificationFile?: string;
  databaseUrl?: string;
  initializeSchema?: boolean;
}

export interface IntegrationContext {
  baseUrl: string;
  notificationFile: string;
  pool: pg.Pool;
  fetchPath(target: string, init?: RequestInit): Promise<Response>;
  postJson(target: string, body?: unknown): Promise<Response>;
  postForm(target: string, fields?: Record<string, unknown>): Promise<Response>;
  query(text: string, values?: unknown[]): Promise<pg.QueryResult>;
  getStock(productId: string): Promise<number>;
  setStock(productId: string, stock: number): Promise<void>;
  countOrders(productId?: string): Promise<number>;
  notificationRecords(): NotificationRecord[];
  initializeSchema(): Promise<void>;
  resetFixture(): Promise<void>;
  dispose(): Promise<void>;
}

export async function startIntegrationContext(
  options: IntegrationContextOptions = {}
): Promise<IntegrationContext> {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the integration suite");
  }

  const ownsDirectory = options.notificationFile === undefined;
  const directory = ownsDirectory
    ? fs.mkdtempSync(path.join(os.tmpdir(), "shopflow-integration-"))
    : "";
  const notificationFile =
    options.notificationFile ?? path.join(directory, "notifications.jsonl");

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5000,
  });

  if (options.initializeSchema !== false) {
    await initializeDatabase(pool);
  }

  const server = await new Promise<Server>((resolve) => {
    const listening = createApp(pool, notificationFile).listen(0, () => {
      resolve(listening);
    });
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function fetchPath(
    target: string,
    init: RequestInit = {}
  ): Promise<Response> {
    return fetch(`${baseUrl}${target}`, { redirect: "manual", ...init });
  }

  return {
    baseUrl,
    notificationFile,
    pool,
    fetchPath,
    async postJson(target, body) {
      return fetchPath(target, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
    },
    async postForm(target, fields) {
      const form = new URLSearchParams();
      for (const [key, value] of Object.entries(fields ?? {})) {
        if (value === undefined) continue;
        form.set(key, String(value));
      }
      return fetchPath(target, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
    },
    async query(text, values) {
      return pool.query(text, values);
    },
    async getStock(productId) {
      const result = await pool.query("SELECT stock FROM products WHERE id = $1", [
        productId,
      ]);
      assert.equal(result.rowCount, 1, `product ${productId} is missing`);
      return Number(result.rows[0].stock);
    },
    async setStock(productId, stock) {
      await pool.query("UPDATE products SET stock = $2 WHERE id = $1", [
        productId,
        stock,
      ]);
    },
    async countOrders(productId) {
      const result = productId
        ? await pool.query("SELECT COUNT(*)::int AS count FROM orders WHERE product_id = $1", [
            productId,
          ])
        : await pool.query("SELECT COUNT(*)::int AS count FROM orders");
      return Number(result.rows[0].count);
    },
    notificationRecords() {
      if (!fs.existsSync(notificationFile)) return [];
      return fs
        .readFileSync(notificationFile, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as NotificationRecord);
    },
    async initializeSchema() {
      await initializeDatabase(pool);
    },
    async resetFixture() {
      await pool.query("DELETE FROM orders");
      await pool.query("UPDATE products SET stock = 20 WHERE id = 'prod-a'");
      await pool.query("UPDATE products SET stock = 10 WHERE id = 'prod-b'");
    },
    async dispose() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await pool.end();
      if (ownsDirectory && directory) {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}
