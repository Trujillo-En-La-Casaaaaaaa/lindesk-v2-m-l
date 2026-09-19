import { Router } from "express";
import type { NotificationService } from "../services/notification.service.js";
import type { OrderService } from "../services/order.service.js";
import type { ProductService } from "../services/product.service.js";

/**
 * HTTP translation for the JSON API reads.
 */
export interface ApiRouteDependencies {
  products: ProductService;
  orders: OrderService;
  notifications: NotificationService;
}

export function createApiRouter({
  products,
  orders,
  notifications,
}: ApiRouteDependencies): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  router.get("/products", async (_req, res) => {
    try {
      res.json(await products.listCatalog());
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Database error" });
    }
  });

  router.get("/products/:id", async (req, res) => {
    try {
      const product = await products.getProduct(req.params.id);
      if (!product) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(product);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Database error" });
    }
  });

  router.get("/orders/:id", async (req, res) => {
    try {
      const order = await orders.getOrder(req.params.id);
      if (!order) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(order);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Database error" });
    }
  });

  router.get("/notifications", (_req, res) => {
    try {
      res.json(notifications.listNotifications());
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Notification log error" });
    }
  });

  return router;
}
