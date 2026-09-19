import { Router } from "express";
import type { OrderService } from "../services/order.service.js";
import type { ProductService } from "../services/product.service.js";
import { renderCatalogPage } from "../views/catalog.view.js";
import { renderOrderDetailPage } from "../views/order-detail.view.js";
import { renderOrderFormPage } from "../views/order-form.view.js";
import { renderProductPage } from "../views/product.view.js";

/**
 * HTTP translation for the server-rendered pages.
 */
export interface PageRouteDependencies {
  products: ProductService;
  orders: OrderService;
}

export function createPagesRouter({
  products,
  orders,
}: PageRouteDependencies): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      res.type("html").send(renderCatalogPage(await products.listCatalog()));
    } catch (error) {
      console.error(error);
      res.status(500).send("Database error");
    }
  });

  router.get("/products/:id", async (req, res) => {
    try {
      const product = await products.getProduct(req.params.id);
      if (!product) {
        res.status(404).send("Not found");
        return;
      }
      res.type("html").send(renderProductPage(product));
    } catch (error) {
      console.error(error);
      res.status(500).send("Database error");
    }
  });

  router.get("/orders/new", async (_req, res) => {
    try {
      res.type("html").send(renderOrderFormPage(await products.listCatalog()));
    } catch (error) {
      console.error(error);
      res.status(500).send("Database error");
    }
  });

  router.get("/orders/:id", async (req, res) => {
    try {
      const order = await orders.getOrder(req.params.id);
      if (!order) {
        res.status(404).send("Not found");
        return;
      }
      res.type("html").send(renderOrderDetailPage(order));
    } catch (error) {
      console.error(error);
      res.status(500).send("Database error");
    }
  });

  return router;
}
