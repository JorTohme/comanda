import { expect, test } from "@playwright/test";
import { createBarraPedido, DEMO_PASSWORD, OPERATIVA_URL, loginAs } from "./session";

test("kitchen receives a newly sent order over realtime", async ({ browser }) => {
  const kitchenContext = await browser.newContext();
  const waiterContext = await browser.newContext();
  const kitchen = await kitchenContext.newPage();
  const waiter = await waiterContext.newPage();
  try {
    await loginAs(kitchen, "cocina.belgrano@donmario.test", DEMO_PASSWORD, OPERATIVA_URL);
    await expect(kitchen.getByRole("heading", { name: "Cocina" })).toBeVisible();
    await expect(kitchen.getByText("Cargando...")).toHaveCount(0);

    await loginAs(waiter, "mozo.belgrano@donmario.test", DEMO_PASSWORD, OPERATIVA_URL);
    await expect(waiter.getByText("Nuevo pedido", { exact: true })).toBeVisible();
    const plateName = await createBarraPedido(waiter, 37);
    const orderCard = waiter.locator(".tarjeta-pedido").filter({ hasText: `37× ${plateName}` });
    await expect(orderCard.getByRole("button", { name: "Enviar a cocina" })).toBeVisible();
    await orderCard.getByRole("button", { name: "Enviar a cocina" }).click();

    await expect(kitchen.locator(".ticket").filter({ hasText: `37× ${plateName}` })).toBeVisible({ timeout: 20_000 });

    await kitchenContext.setOffline(true);
    const reconnectedPlateName = await createBarraPedido(waiter, 38);
    const reconnectedOrder = waiter.locator(".tarjeta-pedido").filter({ hasText: `38× ${reconnectedPlateName}` });
    await reconnectedOrder.getByRole("button", { name: "Enviar a cocina" }).click();
    await kitchenContext.setOffline(false);
    await expect(kitchen.locator(".ticket").filter({ hasText: `38× ${reconnectedPlateName}` })).toBeVisible({ timeout: 20_000 });
  } finally {
    await waiterContext.close();
    await kitchenContext.close();
  }
});
