import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createApp } from "../container.js";

/**
 * Architecture test: asserts the MVC layer rules of `mvc-layer-rules.md` and the
 * absence of new capability. It reads the real source tree, so it fails when a
 * layer boundary is crossed even if the runtime behavior still works.
 */
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);
const sourceRoot = path.join(repositoryRoot, "src");

const layerDirectories = [
  "controllers",
  "services",
  "repositories",
  "models",
  "views",
] as const;

const compositionRootFiles = new Set(["server.ts", "container.ts"]);

const allowedBareImports: Record<string, Set<string>> = {
  controllers: new Set(["express"]),
  services: new Set(),
  repositories: new Set([
    "node:crypto",
    "node:fs",
    "node:path",
    "pg",
  ]),
  models: new Set(),
  views: new Set(),
  "": new Set(["node:path", "express", "pg"]),
};

const allowedRelativeTargets: Record<string, string[]> = {
  controllers: ["controllers", "services", "models", "views"],
  services: ["services", "repositories", "models"],
  repositories: ["repositories", "models"],
  models: ["models"],
  views: ["views", "models"],
  "": ["", "controllers", "services", "repositories", "models", "views"],
};

const ioModules = ["pg", "node:fs", "node:crypto"];

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "tests") continue;
      files.push(...sourceFiles(fullPath));
      continue;
    }
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
    files.push(fullPath);
  }
  return files;
}

function relativeSourcePath(file: string): string {
  return path.relative(sourceRoot, file).split(path.sep).join("/");
}

function layerOf(file: string): string {
  const relative = relativeSourcePath(file);
  const first = relative.split("/")[0];
  return (layerDirectories as readonly string[]).includes(first) ? first : "";
}

function importsOf(file: string): string[] {
  return [...fs.readFileSync(file, "utf8").matchAll(/(?:from|import)\s+"([^"]+)"/g)].map(
    (match) => match[1]
  );
}

function targetLayerOf(file: string, specifier: string): string {
  const resolved = path.resolve(path.dirname(file), specifier);
  const relative = path.relative(sourceRoot, resolved).split(path.sep).join("/");
  const first = relative.split("/")[0];
  return (layerDirectories as readonly string[]).includes(first) ? first : "";
}

const productionFiles = sourceFiles(sourceRoot);

describe("layer structure", () => {
  it("keeps the layer folders and the composition root, without a catch-all app module", () => {
    for (const layer of layerDirectories) {
      assert.ok(
        fs.statSync(path.join(sourceRoot, layer)).isDirectory(),
        `missing layer folder src/${layer}`
      );
    }
    for (const file of compositionRootFiles) {
      assert.ok(
        fs.statSync(path.join(sourceRoot, file)).isFile(),
        `missing composition root file src/${file}`
      );
    }
    assert.ok(
      !fs.existsSync(path.join(sourceRoot, "app.ts")),
      "src/app.ts must not remain as the transaction-script catch-all"
    );
    assert.ok(
      productionFiles.length > 0,
      "expected production TypeScript sources"
    );
  });

  it("imports every module through its own layer boundaries", () => {
    for (const file of productionFiles) {
      const layer = layerOf(file);
      const fileLabel = relativeSourcePath(file);
      for (const specifier of importsOf(file)) {
        if (specifier.startsWith(".")) {
          const target = targetLayerOf(file, specifier);
          const allowed = allowedRelativeTargets[layer];
          assert.ok(
            allowed.includes(target),
            `${fileLabel} may not import ${specifier} (${layer || "composition root"} -> ${target || "root"})`
          );
          continue;
        }
        assert.ok(
          allowedBareImports[layer].has(specifier),
          `${fileLabel} may not import ${specifier}`
        );
      }
    }
  });

  it("keeps pg, fs and crypto inside repositories and the composition root", () => {
    for (const file of productionFiles) {
      const relative = relativeSourcePath(file);
      const isCompositionRoot = compositionRootFiles.has(relative);
      const isRepository = relative.startsWith("repositories/");
      if (isCompositionRoot || isRepository) continue;
      for (const specifier of importsOf(file)) {
        assert.ok(
          !ioModules.includes(specifier),
          `${relative} must not import ${specifier} outside repositories/`
        );
      }
    }
  });

  it("keeps SQL out of controllers and services", () => {
    const sqlPattern =
      /\b(SELECT\s|INSERT\s+INTO\s|UPDATE\s+\w+\s+SET\s|DELETE\s+FROM\s|BEGIN\b|COMMIT\b|ROLLBACK\b|FOR\s+UPDATE\b)/i;
    for (const file of productionFiles) {
      const relative = relativeSourcePath(file);
      if (!relative.startsWith("controllers/") && !relative.startsWith("services/")) {
        continue;
      }
      const content = fs.readFileSync(file, "utf8");
      assert.ok(
        !sqlPattern.test(content),
        `${relative} must not contain SQL statements`
      );
    }
  });

  it("keeps HTML markup out of controllers and keeps the transaction in one module", () => {
    const htmlPattern =
      /<\/?(?:!doctype|html|head|body|title|h1|p|a|div|table|tr|td|th|form|label|select|option|input|button|dl|dt|dd)\b/i;
    const transactionPattern = /\b(BEGIN\b|COMMIT\b|ROLLBACK\b|FOR\s+UPDATE\b)/;
    const transactionOwners: string[] = [];
    for (const file of productionFiles) {
      const relative = relativeSourcePath(file);
      const content = fs.readFileSync(file, "utf8");
      if (relative.startsWith("controllers/")) {
        assert.ok(
          !htmlPattern.test(content),
          `${relative} must not contain HTML markup`
        );
      }
      if (!relative.startsWith("repositories/") && transactionPattern.test(content)) {
        transactionOwners.push(relative);
      }
    }
    assert.deepEqual(transactionOwners, []);
  });
});

interface RouteLayer {
  route?: { path: string; methods?: Record<string, boolean> };
  regexp?: RegExp;
  handle?: { stack?: RouteLayer[] };
}

function mountPathOf(layer: RouteLayer): string {
  const source = (layer.regexp?.source ?? "").replace(/^\^/, "");
  const marker = source.indexOf("\\/?(?=");
  const literal = marker >= 0 ? source.slice(0, marker) : "";
  const segments = literal.split("\\/").filter(Boolean);
  return segments.length > 0 ? `/${segments.join("/")}` : "/";
}

function joinPath(prefix: string, routePath: string): string {
  const joined = `${prefix}${routePath}`;
  const segments = joined.split("/").filter(Boolean);
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function collectRoutes(app: unknown): string[] {
  const routes: string[] = [];
  const walk = (stack: RouteLayer[], prefix: string): void => {
    for (const layer of stack) {
      if (layer.route) {
        for (const [method, enabled] of Object.entries(layer.route.methods ?? {})) {
          if (enabled) {
            routes.push(
              `${method.toUpperCase()} ${joinPath(prefix, layer.route.path)}`
            );
          }
        }
        continue;
      }
      const nested = layer.handle?.stack;
      if (nested) {
        walk(nested, joinPath(prefix, mountPathOf(layer)));
      }
    }
  };
  walk((app as { _router?: { stack: RouteLayer[] } })._router?.stack ?? [], "");
  return routes.sort();
}

const expectedRoutes = [
  "GET /",
  "GET /api/health",
  "GET /api/notifications",
  "GET /api/orders/:id",
  "GET /api/products",
  "GET /api/products/:id",
  "GET /orders/:id",
  "GET /orders/new",
  "GET /products/:id",
  "POST /api/orders",
  "POST /api/orders/:id/ship",
  "POST /orders",
  "POST /orders/:id/ship",
].sort();

describe("route table", () => {
  it("exposes exactly the preserved routes and no new capability", () => {
    const app = createApp(undefined as never, "/tmp/shopflow-route-table.jsonl");
    const routes = collectRoutes(app);

    assert.deepEqual(routes, expectedRoutes);
    for (const route of routes) {
      assert.ok(
        !/\b(cancel|refund|return|pay|payment|login|logout|auth|admin|delete|put|patch)\b/i.test(
          route
        ),
        `unexpected capability in route table: ${route}`
      );
    }
  });

  it("does not add product or order management routes", () => {
    const app = createApp(undefined as never, "/tmp/shopflow-route-table.jsonl");
    const routes = collectRoutes(app);

    assert.deepEqual(
      routes.filter(
        (route) => !expectedRoutes.includes(route)
      ),
      []
    );
    assert.equal(
      routes.filter((route) => route.startsWith("POST /api/products")).length,
      0
    );
    assert.equal(routes.filter((route) => route.includes("ship")).length, 2);
  });
});

describe("preserved data contract", () => {
  it("keeps the products and orders schema and the prod-a/prod-b seed", () => {
    const schema = fs.readFileSync(
      path.join(sourceRoot, "repositories", "schema.ts"),
      "utf8"
    );

    assert.ok(schema.includes("CREATE TABLE IF NOT EXISTS products"));
    assert.ok(schema.includes("CREATE TABLE IF NOT EXISTS orders"));
    assert.ok(schema.includes("price_cents INTEGER NOT NULL CHECK (price_cents >= 0)"));
    assert.ok(schema.includes("stock INTEGER NOT NULL CHECK (stock >= 0)"));
    assert.ok(
      schema.includes("status TEXT NOT NULL CHECK (status IN ('CONFIRMED', 'SHIPPED'))")
    );
    assert.ok(schema.includes("product_id TEXT NOT NULL REFERENCES products(id)"));
    assert.ok(schema.includes("quantity INTEGER NOT NULL CHECK (quantity > 0)"));
    assert.ok(schema.includes("total_cents INTEGER NOT NULL CHECK (total_cents >= 0)"));
    assert.ok(schema.includes("created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"));
    assert.ok(schema.includes("('prod-a', 'Product A', 1999, 20)"));
    assert.ok(schema.includes("('prod-b', 'Product B', 999, 10)"));
    assert.ok(schema.includes("ON CONFLICT (id) DO NOTHING"));
  });

  it("adds no capability that the legacy application did not have", () => {
    const capabilities = [
      "cancel",
      "cancellation",
      "refund",
      "partial-ship",
      "payment",
      "invoice",
      "login",
      "logout",
      "password",
      "authorization",
      "authenticate",
      "pagination",
      "softdelete",
    ];
    for (const file of productionFiles) {
      const relative = relativeSourcePath(file);
      const content = fs.readFileSync(file, "utf8").toLowerCase();
      for (const capability of capabilities) {
        assert.ok(
          !content.includes(capability),
          `${relative} must not introduce ${capability}`
        );
      }
    }
  });

  it("adds no new data fields or tables to the schema", () => {
    const schema = fs.readFileSync(
      path.join(sourceRoot, "repositories", "schema.ts"),
      "utf8"
    );
    const tables = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(
      (match) => match[1]
    );
    assert.deepEqual(tables.sort(), ["orders", "products"]);

    for (const capability of [
      "cancelled",
      "canceled",
      "refund",
      "refunded",
      "payment",
      "paid",
      "carrier",
      "tracking",
      "tax",
      "soft_delete",
      "deleted_at",
    ]) {
      assert.ok(
        !new RegExp(`\\b${capability}\\b`, "i").test(schema),
        `schema must not contain ${capability}`
      );
    }
  });
});
