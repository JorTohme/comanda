import { Injectable } from "@nestjs/common";
import { MercadoPagoConfig, MerchantOrder, Payment, Preference } from "mercadopago";

export interface CrearPreferenciaInput {
  pedidoId: string;
  externalReference: string;
  items: { id: string; title: string; quantity: number; unitPrice: number }[];
  notificationUrl: string;
}

export interface PreferenciaCreada {
  preferenceId: string;
  initPoint: string;
  externalReference: string;
  merchantId: string;
  monto: number;
  currency: string;
}

export interface PagoMercadoPago {
  id: string;
  status: string;
  externalReference: string | null;
  amountCents: number;
  currency: string;
  merchantId: string;
  preferenceId: string | null;
  approvedAt: Date | null;
}

function cents(amount: number | undefined): number {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return Number.NaN;
  const raw = amount * 100;
  const rounded = Math.round(raw);
  return Number.isSafeInteger(rounded) && Math.abs(raw - rounded) <= 1e-6 ? rounded : Number.NaN;
}

function verifiedPreferenceFields(preference: {
  id?: string; init_point?: string; external_reference?: string; collector_id?: number;
  items?: { unit_price?: number; quantity?: number; currency_id?: string }[];
}): PreferenciaCreada {
  let total = 0n;
  let currency = "";
  let valid = Boolean(preference.items?.length);
  for (const item of preference.items ?? []) {
    const itemCents = cents(item.unit_price);
    if (!Number.isSafeInteger(itemCents) || itemCents < 0 || !Number.isSafeInteger(item.quantity) || !item.quantity || item.quantity < 1 ||
      !item.currency_id || (currency && currency !== item.currency_id)) {
      valid = false;
      continue;
    }
    currency ||= item.currency_id;
    total += BigInt(itemCents) * BigInt(item.quantity);
    if (total > 2_147_483_647n) valid = false;
  }
  return {
    preferenceId: preference.id ?? "",
    initPoint: preference.init_point ?? "",
    externalReference: preference.external_reference ?? "",
    merchantId: preference.collector_id == null ? "" : String(preference.collector_id),
    monto: valid ? Number(total) : Number.NaN,
    currency,
  };
}

// The only file in the codebase that imports from the `mercadopago` package (ACL boundary).
@Injectable()
export class MercadoPagoClient {
  private readonly client = new MercadoPagoConfig({
    accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN ?? "",
    options: { timeout: 5000 },
  });

  async crearPreferencia(input: CrearPreferenciaInput): Promise<PreferenciaCreada> {
    const preference = new Preference(this.client);
    const created = await preference.create({
      body: {
        items: input.items.map((item) => ({
          id: item.id,
          title: item.title,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          currency_id: "ARS",
        })),
        external_reference: input.externalReference,
        notification_url: input.notificationUrl,
      },
    });
    return verifiedPreferenceFields(created);
  }

  async obtenerPago(paymentId: string): Promise<PagoMercadoPago> {
    const payment = new Payment(this.client);
    const fetched = await payment.get({ id: paymentId });
    const orderId = fetched.order?.id;
    const merchantOrder = orderId == null
      ? null
      : await new MerchantOrder(this.client).get({ merchantOrderId: String(orderId) });
    const approved = fetched.date_approved ? new Date(fetched.date_approved) : null;
    const orderCollector = merchantOrder?.collector?.id;
    const paymentCollector = fetched.collector_id;
    const merchantId = paymentCollector != null && orderCollector != null && paymentCollector !== orderCollector
      ? ""
      : paymentCollector != null ? String(paymentCollector) : orderCollector != null ? String(orderCollector) : "";
    return {
      id: fetched.id == null ? "" : String(fetched.id),
      status: fetched.status ?? "unknown",
      externalReference: fetched.external_reference ?? null,
      amountCents: cents(fetched.transaction_amount),
      currency: fetched.currency_id ?? "",
      merchantId,
      preferenceId: merchantOrder?.preference_id ?? null,
      approvedAt: approved && Number.isFinite(approved.getTime()) ? approved : null,
    };
  }

  async buscarPreferencias(externalReference: string): Promise<PreferenciaCreada[]> {
    const preference = new Preference(this.client);
    const summaries: { id: string }[] = [];
    let offset = 0;
    let total: number | undefined;
    do {
      const page = await preference.search({ options: { external_reference: externalReference, offset, limit: 100 } });
      const pageTotal = page.total;
      if (pageTotal == null || !Number.isSafeInteger(pageTotal) || pageTotal < 0) throw new Error("Mercado Pago preference search omitted pagination total");
      total = pageTotal;
      const elements = page.elements ?? [];
      if (elements.some((element) => !element.id)) throw new Error("Mercado Pago preference search returned an invalid preference id");
      summaries.push(...elements.map(({ id }) => ({ id })));
      const nextOffset = page.next_offset ?? offset + elements.length;
      if (nextOffset <= offset && offset < total) throw new Error("Mercado Pago preference search pagination did not advance");
      offset = nextOffset;
      if (offset > total) throw new Error("Mercado Pago preference search pagination exceeded total results");
    } while (offset < total);

    return Promise.all(summaries.map(async ({ id }) => verifiedPreferenceFields(await preference.get({ preferenceId: id }))));
  }
}
