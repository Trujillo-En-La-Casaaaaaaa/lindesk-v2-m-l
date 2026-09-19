import path from "node:path";
import express, { type Express } from "express";
import type pg from "pg";
import { createApiRouter } from "./controllers/api.routes.js";
import {
  createApiOrderRouter,
  createPageOrderRouter,
} from "./controllers/order.routes.js";
import { createPagesRouter } from "./controllers/pages.routes.js";
import {
  createApiShipRouter,
  createPageShipRouter,
} from "./controllers/ship.routes.js";
import { NotificationRepository } from "./repositories/notification.repository.js";
import { OrderRepository } from "./repositories/order.repository.js";
import { ProductRepository } from "./repositories/product.repository.js";
import { createTransactionRunner } from "./repositories/transaction.js";
import { NotificationService } from "./services/notification.service.js";
import { OrderService } from "./services/order.service.js";
import { ProductService } from "./services/product.service.js";

/**
 * Composition root: the only place that chooses concrete implementations and
 * wires repositories to services to controllers. Integration tests build the
 * application through `createApp` with their own pool and notification file.
 */
export function defaultNotificationLogPath(): string {
  return (
    process.env.NOTIFICATION_LOG_PATH ||
    path.join(process.cwd(), "data", "notifications.jsonl")
  );
}

export function createApp(
  pool: pg.Pool,
  notificationFile = defaultNotificationLogPath()
): Express {
  const productRepository = new ProductRepository(pool);
  const orderRepository = new OrderRepository(pool);
  const notificationRepository = new NotificationRepository(notificationFile);
  const transactions = createTransactionRunner(pool);

  const productService = new ProductService(productRepository);
  const notificationService = new NotificationService(notificationRepository);
  const orderService = new OrderService(
    orderRepository,
    notificationService,
    transactions
  );

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.use(
    "/api",
    createApiRouter({
      products: productService,
      orders: orderService,
      notifications: notificationService,
    })
  );
  app.use("/api/orders", createApiOrderRouter({ orders: orderService }));
  app.use("/api/orders", createApiShipRouter({ orders: orderService }));
  app.use("/orders", createPageOrderRouter({ orders: orderService }));
  app.use("/orders", createPageShipRouter({ orders: orderService }));
  app.use(
    "/",
    createPagesRouter({ products: productService, orders: orderService })
  );

  return app;
}
