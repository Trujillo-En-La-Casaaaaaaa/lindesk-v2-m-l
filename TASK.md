Migrate the provided ShopFlow Legacy application into a clean LOW ARCHITECTURAL COMPLEXITY MVC architecture.

The migration must preserve the existing externally observable behavior.

TARGET ARCHITECTURE

- Keep exactly one repository.
- Keep one principal deployable application.
- Use MVC-style responsibility separation.
- Separate concerns equivalent to:
  - controllers;
  - services/application logic;
  - persistence/repositories;
  - models/entities;
  - views.
- Keep PostgreSQL.
- Do not introduce microservices.
- Do not introduce additional repositories.

PRESERVATION REQUIREMENTS

The migrated system must continue to support:

1. Product catalog.
2. Product inventory.
3. Order creation.
4. Inventory validation.
5. Inventory decrement.
6. Order detail/status.
7. Administrative transition to SHIPPED.
8. Order-confirmation notification.

Do not add customer order cancellation.

Preserve existing data semantics and externally observable behavior.

Add or maintain automated tests that demonstrate behavioral preservation.

Do not add unrelated functionality.

The goal is architectural restructuring, not feature development.
