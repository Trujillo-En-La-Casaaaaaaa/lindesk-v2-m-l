import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateOrderInput } from "./order-input.js";

describe("validateOrderInput", () => {
  it("accepts a valid order input", () => {
    assert.deepEqual(
      validateOrderInput({
        productId: "prod-a",
        quantity: 2,
        customerEmail: "buyer@example.com",
      }),
      {
        productId: "prod-a",
        quantity: 2,
        customerEmail: "buyer@example.com",
      }
    );
  });

  it("trims the customer email", () => {
    assert.deepEqual(
      validateOrderInput({
        productId: "prod-a",
        quantity: 1,
        customerEmail: "  buyer@example.com  ",
      }),
      {
        productId: "prod-a",
        quantity: 1,
        customerEmail: "buyer@example.com",
      }
    );
  });

  it("rejects non-positive and fractional quantities", () => {
    assert.throws(() =>
      validateOrderInput({
        productId: "prod-a",
        quantity: 0,
        customerEmail: "buyer@example.com",
      })
    );
    assert.throws(() =>
      validateOrderInput({
        productId: "prod-a",
        quantity: 1.5,
        customerEmail: "buyer@example.com",
      })
    );
  });

  it("rejects missing and non-numeric quantities", () => {
    assert.throws(() =>
      validateOrderInput({
        productId: "prod-a",
        customerEmail: "buyer@example.com",
      })
    );
    assert.throws(() =>
      validateOrderInput({
        productId: "prod-a",
        quantity: "abc",
        customerEmail: "buyer@example.com",
      })
    );
  });

  it("rejects missing product id and missing customer email", () => {
    assert.throws(() =>
      validateOrderInput({
        quantity: 1,
        customerEmail: "buyer@example.com",
      })
    );
    assert.throws(() =>
      validateOrderInput({ productId: "prod-a", quantity: 1 })
    );
    assert.throws(() =>
      validateOrderInput({
        productId: "prod-a",
        quantity: 1,
        customerEmail: "   ",
      })
    );
  });

  it("reports the preserved error message", () => {
    assert.throws(
      () => validateOrderInput({ productId: "prod-a", quantity: 0 }),
      new Error("Invalid order")
    );
  });
});
