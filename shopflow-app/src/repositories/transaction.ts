import type pg from "pg";

/**
 * Persistence: the only module that owns the database transaction boundary
 * (``BEGIN`` / ``COMMIT`` / ``ROLLBACK``) and the per-order client checkout.
 * Statements are delegated by repositories through the context handed to them.
 */
export interface TransactionContext {
  query(text: string, values?: readonly unknown[]): Promise<pg.QueryResult>;
}

export interface TransactionRunner {
  run<T>(work: (context: TransactionContext) => Promise<T>): Promise<T>;
}

export function createTransactionRunner(pool: pg.Pool): TransactionRunner {
  return {
    async run<T>(work: (context: TransactionContext) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await work(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
