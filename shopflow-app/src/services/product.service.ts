import type { Product } from "../models/product.js";
import type { ProductRepository } from "../repositories/product.repository.js";

/**
 * Application service: product catalog reads.
 */
export class ProductService {
  constructor(private readonly products: ProductRepository) {}

  async listCatalog(): Promise<Product[]> {
    return this.products.listAll();
  }

  async getProduct(id: string): Promise<Product | null> {
    return this.products.findById(id);
  }
}
