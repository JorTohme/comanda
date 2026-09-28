import { expect, test } from "@playwright/test";
import { currentCashShift, DEMO_PASSWORD, loginAs, pesosFromCentavos, WEB_URL } from "./session";

test("cash collection increases drawer cash without changing the digital total", async ({ page }) => {
  await loginAs(page, "caja.belgrano@donmario.test", DEMO_PASSWORD, WEB_URL);
  await page.goto(`${WEB_URL}/caja`);
  await expect(page.getByRole("heading", { name: "Caja" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pedidos entregados, pendientes de cobro" })).toBeVisible();

  const before = await currentCashShift(page);
  const pedidos = await page.evaluate(async (apiUrl) => {
    const session = JSON.parse(localStorage.getItem("comanda.session") ?? "{}") as { accessToken?: string };
    const response = await fetch(`${apiUrl}/pedidos`, { headers: { Authorization: `Bearer ${session.accessToken}` } });
    if (!response.ok) throw new Error(`Could not list orders: ${response.status}`);
    return response.json() as Promise<Array<{ id: string; estado: string; items: Array<{ precioUnitario: number; cantidad: number }> }>>;
  }, "http://localhost:3001");
  const delivered = pedidos.find((pedido) => pedido.estado === "entregado");
  expect(delivered).toBeTruthy();
  const orderTotal = delivered!.items.reduce((sum, item) => sum + item.precioUnitario * item.cantidad, 0);

  await page.getByRole("button", { name: "Cobrar en efectivo" }).first().click();
  await expect.poll(async () => (await currentCashShift(page)).totalCalculado).toBe(before.totalCalculado + orderTotal);
  const after = await currentCashShift(page);
  expect(after.totalDigital).toBe(before.totalDigital);
  expect(after.totalVentas).toBe(before.totalVentas + orderTotal);
  await expect(page.getByText(`Efectivo esperado: ${pesosFromCentavos(after.totalCalculado)}`)).toBeVisible();
  await expect(page.getByText(`Cobros digitales: ${pesosFromCentavos(after.totalDigital)}`)).toBeVisible();
});
