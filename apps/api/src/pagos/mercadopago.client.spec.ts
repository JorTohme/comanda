const mockPaymentGet = jest.fn();
const mockMerchantOrderGet = jest.fn();
const mockPreferenceCreate = jest.fn();
const mockPreferenceSearch = jest.fn();
const mockPreferenceGet = jest.fn();

jest.mock("mercadopago", () => ({
  MercadoPagoConfig: class {},
  Payment: class { get = mockPaymentGet; },
  MerchantOrder: class { get = mockMerchantOrderGet; },
  Preference: class { create = mockPreferenceCreate; search = mockPreferenceSearch; get = mockPreferenceGet; },
}));

import { MercadoPagoClient } from "./mercadopago.client";

describe("MercadoPagoClient verified mapping", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.MERCADOPAGO_ACCESS_TOKEN = "test-token";
    process.env.MERCADOPAGO_MERCHANT_ID = "777";
  });

  it("maps payment cents and preference association through the merchant order", async () => {
    mockPaymentGet.mockResolvedValue({
      id: 123, status: "approved", external_reference: "attempt-1", transaction_amount: 10,
      currency_id: "ARS", collector_id: 777, date_approved: "2026-09-27T18:00:00.000Z", order: { id: 456 },
    });
    mockMerchantOrderGet.mockResolvedValue({ preference_id: "preference-1", collector: { id: 777 } });

    const payment = await new MercadoPagoClient().obtenerPago("123");

    expect(mockMerchantOrderGet).toHaveBeenCalledWith({ merchantOrderId: "456" });
    expect(payment).toEqual({
      id: "123", status: "approved", externalReference: "attempt-1", amountCents: 1000,
      currency: "ARS", merchantId: "777", preferenceId: "preference-1", approvedAt: new Date("2026-09-27T18:00:00.000Z"),
    });
  });

  it("consumes every preference page and fetches complete preferences before returning matches", async () => {
    mockPreferenceSearch
      .mockResolvedValueOnce({ total: 2, next_offset: 1, elements: [{ id: "pref-1" }] })
      .mockResolvedValueOnce({ total: 2, next_offset: 2, elements: [{ id: "pref-2" }] });
    mockPreferenceGet
      .mockResolvedValueOnce({ id: "pref-1", init_point: "https://mp.test/1", external_reference: "attempt-1", collector_id: 777, items: [{ unit_price: 10, quantity: 1, currency_id: "ARS" }] })
      .mockResolvedValueOnce({ id: "pref-2", init_point: "https://mp.test/2", external_reference: "attempt-1", collector_id: 777, items: [{ unit_price: 10, quantity: 1, currency_id: "ARS" }] });

    await expect(new MercadoPagoClient().buscarPreferencias("attempt-1")).resolves.toEqual([
      { preferenceId: "pref-1", initPoint: "https://mp.test/1", externalReference: "attempt-1", merchantId: "777", monto: 1000, currency: "ARS" },
      { preferenceId: "pref-2", initPoint: "https://mp.test/2", externalReference: "attempt-1", merchantId: "777", monto: 1000, currency: "ARS" },
    ]);
    expect(mockPreferenceSearch).toHaveBeenCalledTimes(2);
    expect(mockPreferenceGet).toHaveBeenNthCalledWith(2, { preferenceId: "pref-2" });
  });

  it("does not turn missing provider amount data into a zero-value preference", async () => {
    mockPreferenceGet.mockResolvedValue({ id: "pref-1", init_point: "https://mp.test/1", external_reference: "attempt-1", collector_id: 777, items: [{ quantity: 1, currency_id: "ARS" }] });
    mockPreferenceSearch.mockResolvedValue({ total: 1, elements: [{ id: "pref-1" }] });

    const [preference] = await new MercadoPagoClient().buscarPreferencias("attempt-1");
    expect(preference.monto).toBeNaN();
  });
});
