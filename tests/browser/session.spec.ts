import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD, WEB_URL, loginAs } from "./session";

test("two console tabs coalesce simultaneous expired-session refreshes", async ({ context, page }) => {
  await loginAs(page, "admin@donmario.test", DEMO_PASSWORD, WEB_URL);
  await expect(page.getByLabel("Sucursal")).toBeVisible();

  const secondPage = await context.newPage();
  try {
    await secondPage.goto(WEB_URL);
    await expect(secondPage.getByRole("link", { name: "Equipo" })).toBeVisible();
    await expect(secondPage.getByLabel("Sucursal")).toBeVisible();

    await page.evaluate(() => {
      const key = "comanda.session";
      const session = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
      session.accessToken = "expired-browser-acceptance-token";
      localStorage.setItem(key, JSON.stringify(session));
    });

    let protectedRequests = 0;
    let refreshRequests = 0;
    let release401!: () => void;
    const twoUnauthorized = new Promise<void>((resolve) => { release401 = resolve; });
    await context.route("**/sucursales", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      protectedRequests += 1;
      if (protectedRequests <= 2) {
        if (protectedRequests === 2) release401();
        await twoUnauthorized;
        return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "expired access token" }) });
      }
      return route.continue();
    });
    await context.route("**/auth/refresh", async (route) => {
      refreshRequests += 1;
      return route.continue();
    });

    await Promise.all([page.goto(`${WEB_URL}/reportes`), secondPage.goto(`${WEB_URL}/equipo`)]);
    await expect(page.getByRole("heading", { name: "Reportes" })).toBeVisible();
    await expect(secondPage.getByRole("heading", { name: "Equipo" })).toBeVisible();
    expect(protectedRequests).toBeGreaterThanOrEqual(2);
    expect(refreshRequests).toBe(1);
  } finally {
    await secondPage.close();
  }
});

test("logout while refresh is blocked cannot restore the old console session", async ({ context, page }) => {
  await loginAs(page, "admin@donmario.test", DEMO_PASSWORD, WEB_URL);
  const session = await page.evaluate(() => JSON.parse(localStorage.getItem("comanda.session") ?? "{}"));
  let releaseRefresh!: () => void;
  let reportRefreshStarted!: () => void;
  const blocked = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  const refreshStarted = new Promise<void>((resolve) => { reportRefreshStarted = resolve; });

  await context.route("**/sucursales", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "expired access token" }) });
    }
    return route.continue();
  });
  await context.route("**/auth/refresh", async (route) => {
    reportRefreshStarted();
    await blocked;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) });
  });

  await page.evaluate(() => {
    const key = "comanda.session";
    const current = JSON.parse(localStorage.getItem(key) ?? "{}");
    current.accessToken = "expired-logout-race-token";
    localStorage.setItem(key, JSON.stringify(current));
  });

  try {
    await page.goto(`${WEB_URL}/reportes`);
    await refreshStarted;
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page.getByLabel("Email")).toBeVisible();
    releaseRefresh();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("comanda.session"))).toBeNull();
    await expect(page.getByRole("button", { name: "Cerrar sesión" })).toHaveCount(0);
  } finally {
    releaseRefresh();
  }
});
