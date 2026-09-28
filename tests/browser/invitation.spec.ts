import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD, WEB_URL, loginAs } from "./session";

test("an administrator activates an invited employee and the invited role is gated", async ({ page }) => {
  await loginAs(page, "admin@donmario.test", DEMO_PASSWORD, WEB_URL);
  await page.getByRole("link", { name: "Equipo" }).click();
  const email = `browser-${Date.now()}@example.test`;
  await page.getByLabel("Email").last().fill(email);
  await page.getByLabel("Sucursal").last().selectOption({ label: "Belgrano" });
  await page.getByLabel("Rol del personal").selectOption("mozo");
  await page.getByRole("button", { name: "Crear invitación" }).click();

  const activationUrl = page.getByLabel("Enlace de activación");
  await expect(activationUrl).toHaveValue(/\/invitacion\?token=/);
  await page.goto(await activationUrl.inputValue());
  await page.getByLabel("Nombre").fill("Mozo Browser");
  await page.getByLabel("Contraseña", { exact: true }).fill("BrowserTest2026!");
  await page.getByLabel("Repetir contraseña").fill("BrowserTest2026!");
  await page.getByRole("button", { name: "Activar cuenta" }).click();
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();

  await page.goto(`${WEB_URL}/equipo`);
  await expect(page.getByText("Tu rol no tiene permiso para acceder a esta sección.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Equipo" })).toHaveCount(0);
});

test("copy failure exposes the activation link for manual copying", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new Error("clipboard unavailable"); } },
    });
  });
  await loginAs(page, "admin@donmario.test", DEMO_PASSWORD, WEB_URL);
  await page.goto(`${WEB_URL}/equipo`);
  await page.getByLabel("Email").last().fill(`copy-${Date.now()}@example.test`);
  await page.getByLabel("Sucursal").last().selectOption({ label: "Belgrano" });
  await page.getByRole("button", { name: "Crear invitación" }).click();
  await expect(page.getByLabel("Enlace de activación")).toHaveValue(/\/invitacion\?token=/);
  await page.getByRole("button", { name: "Copiar enlace" }).click();
  await expect(page.getByRole("status")).toContainText("No se pudo copiar");
  await expect(page.getByLabel("Enlace de activación")).toBeVisible();
});

test("a late invitation response is not shown after logout", async ({ page }) => {
  await loginAs(page, "admin@donmario.test", DEMO_PASSWORD, WEB_URL);
  await page.goto(`${WEB_URL}/equipo`);
  await page.getByLabel("Email").last().fill(`stale-${Date.now()}@example.test`);
  await page.getByLabel("Sucursal").last().selectOption({ label: "Belgrano" });

  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
  await page.route("**/auth/invitations", async (route) => {
    await responseGate;
    try {
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ activationUrl: `${WEB_URL}/invitacion?token=late-result`, expiresAt: new Date(Date.now() + 60_000).toISOString() }) });
    } catch { /* Logout may abort this request before the deferred response is released. */ }
  });
  const request = page.waitForRequest((candidate) => candidate.url().endsWith("/auth/invitations") && candidate.method() === "POST");
  await page.getByRole("button", { name: "Crear invitación" }).click();
  await request;
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  releaseResponse();

  await expect(page.getByLabel("Enlace de activación")).toHaveCount(0);
  await expect(page.getByText("Iniciá sesión para continuar.")).toBeVisible();
});

test("a non-admin cannot open the staff console directly", async ({ page }) => {
  await loginAs(page, "caja.belgrano@donmario.test", DEMO_PASSWORD, WEB_URL);
  await page.goto(`${WEB_URL}/equipo`);
  await expect(page.getByText("Tu rol no tiene permiso para acceder a esta sección.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Equipo" })).toHaveCount(0);
});
