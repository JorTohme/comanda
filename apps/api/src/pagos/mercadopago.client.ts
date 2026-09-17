import { Injectable } from "@nestjs/common";
import { MercadoPagoConfig, Payment, Preference } from "mercadopago";

export interface CrearPreferenciaInput {
  pedidoId: string;
  items: { id: string; title: string; quantity: number; unitPrice: number }[];
  notificationUrl: string;
}

export interface PreferenciaCreada {
  preferenceId: string;
  initPoint: string;
}

export interface PagoMercadoPago {
  id: string;
  status: string;
  externalReference: string | null;
  transactionAmount: number;
}

// The only file in the codebase that imports from the `mercadopago` package (ACL boundary).
@Injectable()
export class MercadoPagoClient {
  private readonly client = new MercadoPagoConfig({
    accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN!,
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
        external_reference: input.pedidoId,
        notification_url: input.notificationUrl,
      },
    });
    return { preferenceId: created.id!, initPoint: created.init_point! };
  }

  async obtenerPago(paymentId: string): Promise<PagoMercadoPago> {
    const payment = new Payment(this.client);
    const fetched = await payment.get({ id: paymentId });
    return {
      id: String(fetched.id),
      status: fetched.status ?? "unknown",
      externalReference: fetched.external_reference ?? null,
      transactionAmount: fetched.transaction_amount ?? 0,
    };
  }
}
