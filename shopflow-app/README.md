# ShopFlow Legacy (frozen F0 fixture)

ShopFlow Legacy is a server-rendered TypeScript and Express application backed
by PostgreSQL. The externally observable behavior is frozen; the internal
structure is an MVC-style layered monolith: HTTP controllers, application
services, repositories, domain models, and views. Customer order cancellation is
not implemented.

## Architecture

One repository, one deployable, one PostgreSQL database. Dependencies point
inward only:

```
      HTTP
       |
 controllers/  ->  views/            (presentation)
       |
       v
  services/    ->  models/            (application + domain)
       |
       v
repositories/  ->  models/            (persistence)
       |
       v
 PostgreSQL (products, orders)   +   notification JSON Lines file
```

```
src/
  server.ts                     composition root: env config, pool, listen, shutdown
  container.ts                  composition root: wiring + createApp factory
  controllers/                  routing, request parsing, HTTP translation
  services/                     application logic and the transaction boundary
  repositories/                 SQL, the order transaction, the notification file store, schema bootstrap
  models/                       Product, Order, NotificationRecord, OrderInput + validation, row mapping
  views/                        pure HTML rendering and escapeHtml
```

- The order-creation transaction lives in exactly one place: `OrderService`
  drives it and `OrderRepository`/`createTransactionRunner` own the statements,
  keeping `BEGIN` → locked read (`FOR UPDATE`) → stock check → decrement →
  insert → `COMMIT`, with `ROLLBACK` on failure.
- The `ORDER_CONFIRMATION` notification is appended to the JSON Lines file after
  the commit and outside the transaction.
- `pg` and `fs` are imported only by `repositories/` and the composition root;
  controllers and services contain no SQL, and no HTML markup leaves `views/`.
- Unit tests are colocated (`src/models`, `src/views`, `src/repositories`,
  `src/tests/architecture.test.ts`); integration tests live in
  `src/tests/integration` and are compiled separately so that `npm test` needs
  no database.

## Start

Requirements: Docker with Docker Compose.

```bash
docker compose up -d --build
curl http://127.0.0.1:3000/api/health
```

Open http://127.0.0.1:3000. PostgreSQL is exposed on host port `5433`.

Stop the application with:

```bash
docker compose down
```

## Test

Requirements: Node.js 22 and npm.

```bash
npm install
npm test
```

`npm test` compiles the sources and runs every compiled unit test (validation,
notification file store, views, and the architecture/dependency rules). It does
not require Docker or PostgreSQL.

The integration suite runs against the real PostgreSQL instance and exercises
the JSON API, the server-rendered pages, the transaction/rollback behavior, the
row lock under concurrency, and durability across a restart:

```bash
docker compose up -d db
DATABASE_URL=postgres://shopflow:shopflow@127.0.0.1:5433/shopflow npm run test:integration
```

`npm run test:integration` restores the seed baseline (seed stock, no orders) in
that throwaway database before asserting, and runs the test files serially.

Run the baseline black-box acceptance suite from this directory with:

```powershell
..\..\..\scripts\run-acceptance.ps1 -Target . -Suite baseline -StartCompose
```

## Seed data

- `prod-a`: Product A, 1999 cents, stock 20
- `prod-b`: Product B, 999 cents, stock 10

Order confirmations are appended locally to the configured JSON Lines file and
do not use an internet service.
