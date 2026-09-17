import { createHmac, timingSafeEqual } from "crypto";

export interface WebhookSignatureInput {
  xSignature: string | undefined;
  xRequestId: string | undefined;
  dataId: string;
}

let warnedMissingSecret = false;

/** Validates Mercado Pago's `x-signature`/`x-request-id` webhook headers.
 * Manifest format per MP docs: `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` signed HMAC-SHA256 with the webhook secret. */
export function isValidWebhookSignature(input: WebhookSignatureInput): boolean {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) {
    // ponytail: webhook signature validation is a no-op until MERCADOPAGO_WEBHOOK_SECRET is set (deferred per user request); once set, this must fail closed on a missing/invalid signature
    if (!warnedMissingSecret) {
      // eslint-disable-next-line no-console
      console.warn("MERCADOPAGO_WEBHOOK_SECRET not set — skipping webhook signature validation (dev-only)");
      warnedMissingSecret = true;
    }
    return true;
  }

  if (!input.xSignature || !input.xRequestId) return false;

  const parts: Record<string, string> = {};
  for (const pair of input.xSignature.split(",")) {
    const [key, value] = pair.split("=").map((part) => part.trim());
    if (key && value) parts[key] = value;
  }
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const manifest = `id:${input.dataId.toLowerCase()};request-id:${input.xRequestId};ts:${ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(v1);
  return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
}
