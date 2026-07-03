import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export type DuckDbRunner = {
  backend: "native" | "wasm";
  run(sql: string, params?: Record<string, number | bigint>): Promise<Array<Record<string, unknown>>>;
  close(): Promise<void>;
};

const bindNumericParams = (sql: string, params?: Record<string, number | bigint>) => {
  if (!params) return sql;
  let bound = sql;
  for (const [key, value] of Object.entries(params)) {
    bound = bound.replaceAll(`$${key}`, String(value));
  }
  return bound;
};

const isNativeBlocked = (error: unknown) =>
  error instanceof Error
  && (error.message.includes("Application Control policy")
    || error.message.includes("ERR_DLOPEN_FAILED")
    || error.message.includes("dlopen"));

async function createNativeRunner(): Promise<DuckDbRunner> {
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  await connection.run("SET threads TO 8; SET preserve_insertion_order=false;");
  return {
    backend: "native",
    run: async (sql, params) => {
      const result = await connection.run(sql, params);
      return await result.getRowObjectsJS() as Array<Record<string, unknown>>;
    },
    close: async () => {
      connection.closeSync();
      instance.closeSync();
    },
  };
}

async function createWasmRunner(): Promise<DuckDbRunner> {
  const require = createRequire(import.meta.url);
  const dist = dirname(require.resolve("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs"));
  const blocking = require("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs") as {
    createDuckDB: (
      bundles: Record<string, { mainModule: string; mainWorker: string }>,
      logger: unknown,
      runtime: unknown,
    ) => Promise<{
      instantiate: (progress: (p: number) => void) => Promise<void>;
      connect: () => Promise<{
        query: (sql: string) => Promise<{ toArray: () => Array<Record<string, unknown>> }>;
        close: () => Promise<void>;
      }>;
      terminate?: () => Promise<void>;
    }>;
    VoidLogger: new () => unknown;
    NODE_RUNTIME: unknown;
  };

  const bundles = {
    eh: {
      mainModule: join(dist, "duckdb-eh.wasm"),
      mainWorker: join(dist, "duckdb-node-eh.worker.cjs"),
    },
  };
  const db = await blocking.createDuckDB(bundles, new blocking.VoidLogger(), blocking.NODE_RUNTIME);
  await db.instantiate(() => {});
  const connection = await db.connect();

  return {
    backend: "wasm",
    run: async (sql, params) => {
      const table = await connection.query(bindNumericParams(sql, params));
      return table.toArray();
    },
    close: async () => {
      await connection.close();
      await db.terminate?.();
    },
  };
}

export async function createDuckDbRunner(): Promise<DuckDbRunner> {
  if (process.platform === "win32" && process.env.DUCKDB_BACKEND !== "native") {
    console.warn("[duckdb] Using DuckDB WASM on Windows. Set DUCKDB_BACKEND=native to force native bindings.");
    return createWasmRunner();
  }

  try {
    return await createNativeRunner();
  } catch (error) {
    if (!isNativeBlocked(error)) throw error;
    console.warn("[duckdb] Native module blocked; falling back to DuckDB WASM.");
    return createWasmRunner();
  }
}
