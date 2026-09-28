import { expect, test } from "@playwright/test";
import { API_URL, createBarraPedido, DEMO_PASSWORD, OPERATIVA_URL, WEB_URL, loginAs } from "./session";

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

test("a reconnect snapshot removes a Mesa whose delete event was missed offline", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const mozoContext = await browser.newContext();
  const admin = await adminContext.newPage();
  const mozo = await mozoContext.newPage();
  const name = `Recovery ${Date.now()}`;
  let mesaId: string | null = null;

  try {
    await loginAs(admin, "admin@donmario.test", DEMO_PASSWORD, WEB_URL);
    await loginAs(mozo, "mozo.belgrano@donmario.test", DEMO_PASSWORD, OPERATIVA_URL);
    await expect(mozo.getByText("Nuevo pedido", { exact: true })).toBeVisible();

    const mesa = await admin.evaluate(async ({ apiUrl, name }) => {
      const session = JSON.parse(localStorage.getItem("comanda.session") ?? "{}") as { accessToken?: string };
      const response = await fetch(`${apiUrl}/mesas`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
        body: JSON.stringify({ nombre: name, capacidad: 2 }),
      });
      if (!response.ok) throw new Error(`Could not create Mesa: ${response.status}`);
      return response.json() as Promise<{ id: string }>;
    }, { apiUrl: API_URL, name });
    mesaId = mesa.id;
    await expect(mozo.locator(".mesa-plano").filter({ hasText: name })).toBeVisible();

    await mozoContext.setOffline(true);
    const response = await admin.evaluate(async ({ apiUrl, id }) => {
      const session = JSON.parse(localStorage.getItem("comanda.session") ?? "{}") as { accessToken?: string };
      return (await fetch(`${apiUrl}/mesas/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${session.accessToken}` } })).status;
    }, { apiUrl: API_URL, id: mesa.id });
    expect(response).toBe(200);
    mesaId = null;

    await mozoContext.setOffline(false);
    await expect(mozo.locator(".mesa-plano").filter({ hasText: name })).toHaveCount(0, { timeout: 30_000 });
  } finally {
    if (mesaId) {
      await admin.evaluate(async ({ apiUrl, id }) => {
        const session = JSON.parse(localStorage.getItem("comanda.session") ?? "{}") as { accessToken?: string };
        await fetch(`${apiUrl}/mesas/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${session.accessToken}` } });
      }, { apiUrl: API_URL, id: mesaId }).catch(() => {});
    }
    await adminContext.close();
    await mozoContext.close();
  }
});
