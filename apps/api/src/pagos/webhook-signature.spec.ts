import { createHmac } from "crypto";
import { isValidWebhookSignature } from "./webhook-signature";

const ORIGINAL_SECRET = process.env.MERCADOPAGO_WEBHOOK_SECRET;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

describe("isValidWebhookSignature", () => {
  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
    else process.env.MERCADOPAGO_WEBHOOK_SECRET = ORIGINAL_SECRET;
    if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it("allows through without a secret only outside production", () => {
    process.env.NODE_ENV = "development";
    delete process.env.MERCADOPAGO_WEBHOOK_SECRET;

    const result = isValidWebhookSignature({ xSignature: undefined, xRequestId: undefined, dataId: "123" });

    expect(result).toBe(true);
  });

  it("rejects unsigned webhooks in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.MERCADOPAGO_WEBHOOK_SECRET;

    expect(isValidWebhookSignature({ xSignature: undefined, xRequestId: undefined, dataId: "123" })).toBe(false);
  });

  it("accepts a correctly computed signature when the secret is set", () => {
    process.env.MERCADOPAGO_WEBHOOK_SECRET = "test-secret";
    const ts = "1704908010";
    const dataId = "123456";
    const manifest = `id:${dataId};request-id:req-1;ts:${ts};`;
    const v1 = createHmac("sha256", "test-secret").update(manifest).digest("hex");

    const result = isValidWebhookSignature({
      xSignature: `ts=${ts},v1=${v1}`,
      xRequestId: "req-1",
      dataId,
    });

    expect(result).toBe(true);
  });

  it("rejects a wrong signature when the secret is set", () => {
    process.env.MERCADOPAGO_WEBHOOK_SECRET = "test-secret";

    const result = isValidWebhookSignature({
      xSignature: "ts=1704908010,v1=deadbeef",
      xRequestId: "req-1",
      dataId: "123456",
    });

    expect(result).toBe(false);
  });

  it("rejects missing headers when the secret is set", () => {
    process.env.MERCADOPAGO_WEBHOOK_SECRET = "test-secret";

    expect(isValidWebhookSignature({ xSignature: undefined, xRequestId: "req-1", dataId: "1" })).toBe(false);
    expect(isValidWebhookSignature({ xSignature: "ts=1,v1=a", xRequestId: undefined, dataId: "1" })).toBe(false);
  });

  it("rejects a malformed x-signature missing ts or v1", () => {
    process.env.MERCADOPAGO_WEBHOOK_SECRET = "test-secret";

    expect(isValidWebhookSignature({ xSignature: "v1=abc", xRequestId: "req-1", dataId: "1" })).toBe(false);
    expect(isValidWebhookSignature({ xSignature: "ts=123", xRequestId: "req-1", dataId: "1" })).toBe(false);
  });

  it("lowercases an alphanumeric data.id before building the manifest", () => {
    process.env.MERCADOPAGO_WEBHOOK_SECRET = "test-secret";
    const ts = "1704908010";
    const manifest = `id:abc123;request-id:req-1;ts:${ts};`;
    const v1 = createHmac("sha256", "test-secret").update(manifest).digest("hex");

    const result = isValidWebhookSignature({
      xSignature: `ts=${ts},v1=${v1}`,
      xRequestId: "req-1",
      dataId: "ABC123",
    });

    expect(result).toBe(true);
  });
});
