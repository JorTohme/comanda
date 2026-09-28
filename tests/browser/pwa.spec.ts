import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createMesaPedido, DEMO_PASSWORD, listPedidos, loginAs, OPERATIVA_URL } from "./session";

test("offline cold reload keeps a queued order and reconnect creates one server order", async ({ page, context }) => {
  test.setTimeout(60_000);
  await loginAs(page, "mozo.belgrano@donmario.test", DEMO_PASSWORD, OPERATIVA_URL);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect(page.getByText("Nuevo pedido", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox").nth(1).locator("option").nth(1)).toBeAttached();

  const initialOrders = await listPedidos(page);
  await context.setOffline(true);
  const plateName = await createMesaPedido(page);
  await expect(page.getByText(/pedido\(s\) guardado\(s\), pendiente\(s\) de sincronización/)).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
  await expect(page.getByText(/pedido\(s\) guardado\(s\), pendiente\(s\) de sincronización/)).toBeVisible();
  await expect(page.getByText(`1× ${plateName}`, { exact: true })).toBeVisible();

  await context.setOffline(false);
  await expect.poll(async () => (await listPedidos(page)).length, { timeout: 30_000 }).toBe(initialOrders.length + 1);
  await expect(page.getByText(/pedido\(s\) guardado\(s\), pendiente\(s\) de sincronización/)).toHaveCount(0);
  expect((await listPedidos(page)).length).toBe(initialOrders.length + 1);
});

test("a transient server rejection keeps the command recoverable and retry syncs it once", async ({ page }) => {
  test.setTimeout(60_000);
  await loginAs(page, "mozo.belgrano@donmario.test", DEMO_PASSWORD, OPERATIVA_URL);
  await expect(page.getByText("Nuevo pedido", { exact: true })).toBeVisible();
  const initialOrders = await listPedidos(page);
  let posts = 0;
  const requestIds: string[] = [];
  await page.route("**/pedidos", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts += 1;
    requestIds.push(route.request().postDataJSON().clientRequestId);
    if (posts === 1) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "temporary outage" }) });
    if (posts === 2) return route.fulfill({ status: 429, headers: { "Retry-After": "0" }, contentType: "application/json", body: JSON.stringify({ message: "retry later" }) });
    return route.continue();
  });

  await createMesaPedido(page);
  await expect(page.getByText(/pedido\(s\) guardado\(s\), pendiente\(s\) de sincronización/)).toBeVisible();
  await expect.poll(() => posts, { timeout: 25_000 }).toBe(2);
  expect(requestIds[0]).toBeTruthy();
  expect(requestIds[1]).toBe(requestIds[0]);
  await expect(page.getByText(/pedido\(s\) guardado\(s\), pendiente\(s\) de sincronización/)).toBeVisible();

  await page.unroute("**/pedidos");
  await page.waitForTimeout(4_100);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => posts, { timeout: 15_000 }).toBe(3);
  expect(requestIds[2]).toBe(requestIds[0]);
  await expect.poll(async () => (await listPedidos(page)).length, { timeout: 20_000 }).toBe(initialOrders.length + 1);
  await expect(page.getByText(/pedido\(s\) guardado\(s\), pendiente\(s\) de sincronización/)).toHaveCount(0);
  expect((await listPedidos(page)).length).toBe(initialOrders.length + 1);
});

test("a rejected command keeps retry and discard controls until the operator resolves it", async ({ page }) => {
  await loginAs(page, "mozo.belgrano@donmario.test", DEMO_PASSWORD, OPERATIVA_URL);
  await expect(page.getByText("Nuevo pedido", { exact: true })).toBeVisible();
  const initialOrders = await listPedidos(page);
  let firstPost = true;
  await page.route("**/pedidos", async (route) => {
    if (route.request().method() === "POST" && firstPost) {
      firstPost = false;
      return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "validation rejected" }) });
    }
    return route.continue();
  });

  await createMesaPedido(page);
  const retry = page.getByRole("button", { name: /^Reintentar pedido / });
  await expect(retry).toBeVisible();
  await expect(page.getByRole("button", { name: /^Descartar pedido pendiente / })).toBeVisible();
  await page.unroute("**/pedidos");
  await retry.click();
  await expect.poll(async () => (await listPedidos(page)).length, { timeout: 20_000 }).toBe(initialOrders.length + 1);
  await expect(retry).toHaveCount(0);
});

test("a waiting update stays blocked by drafts and pending commands, then preserves saved session data", async ({ page, context }) => {
  test.setTimeout(90_000);
  const workerPath = join(process.cwd(), "apps/operativa/dist/sw.js");
  const originalWorker = await readFile(workerPath, "utf8");
  try {
    await loginAs(page, "mozo.belgrano@donmario.test", DEMO_PASSWORD, OPERATIVA_URL);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    const initialOrders = await listPedidos(page);
    await page.getByRole("combobox").nth(0).selectOption({ index: 1 });

    const buildHash = originalWorker.match(/const BUILD_HASH=("[^"]+");/)?.[1];
    expect(buildHash).toBeTruthy();
    const updatedWorker = originalWorker.replace(buildHash!, `"acceptance-${Date.now()}"`);
    await writeFile(workerPath, updatedWorker, "utf8");
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
    await expect(page.getByRole("status", { name: "Actualización disponible" })).toBeVisible({ timeout: 20_000 });
    const update = page.getByRole("button", { name: "Actualizar" });
    await expect(update).toBeDisabled();

    const selects = page.getByRole("combobox");
    await selects.nth(0).selectOption("");
    await selects.nth(1).selectOption("");
    await page.route("**/pedidos", async (route) => {
      if (route.request().method() === "POST") return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "validation rejected" }) });
      return route.continue();
    });
    await createMesaPedido(page);
    await expect(page.getByRole("button", { name: /^Reintentar pedido / })).toBeVisible();
    await expect(update).toBeDisabled();

    await page.unroute("**/pedidos");
    await page.getByRole("button", { name: /^Reintentar pedido / }).click();
    await expect.poll(async () => (await listPedidos(page)).length, { timeout: 20_000 }).toBe(initialOrders.length + 1);
    await expect(update).toBeEnabled();

    await Promise.all([page.waitForEvent("load"), update.click()]);
    await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
    await expect(page.getByText("Mis pedidos", { exact: true })).toBeVisible();
    expect((await listPedidos(page)).length).toBe(initialOrders.length + 1);
  } finally {
    await writeFile(workerPath, originalWorker, "utf8");
  }
});

test("switching operational accounts across branches hides the previous branch outbox", async ({ page }) => {
  await loginAs(page, "mozo.belgrano@donmario.test", DEMO_PASSWORD, OPERATIVA_URL);
  await expect(page.getByText("Nuevo pedido", { exact: true })).toBeVisible();
  await page.route("**/pedidos", async (route) => {
    if (route.request().method() === "POST") return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "validation rejected" }) });
    return route.continue();
  });
  const plateName = await createMesaPedido(page, 41);
  await expect(page.getByRole("button", { name: /^Reintentar pedido / })).toBeVisible();
  await page.unroute("**/pedidos");

  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page.getByLabel("Email")).toBeVisible();
  await loginAs(page, "mozo.palermo@donmario.test", DEMO_PASSWORD, OPERATIVA_URL);
  await expect(page.getByText("Nuevo pedido", { exact: true })).toBeVisible();
  await expect(page.getByText(/pedido\(s\) guardado\(s\), pendiente\(s\) de sincronización/)).toHaveCount(0);
  await expect(page.getByText(`41× ${plateName}`, { exact: true })).toHaveCount(0);
});
