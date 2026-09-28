import { expect, type Page } from "@playwright/test";

export const API_URL = "http://localhost:3001";
export const WEB_URL = "http://localhost:3000";
export const OPERATIVA_URL = "http://localhost:5173";
export const DEMO_PASSWORD = "Comanda2026!";

export async function loginAs(page: Page, email: string, password: string, origin: string): Promise<void> {
  await page.goto(origin);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: origin.endsWith(":5173") ? "Entrar" : "Ingresar" }).click();
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
}

export async function listPedidos(page: Page): Promise<Array<{ id: string; estado: string; clientRequestId: string | null }>> {
  return page.evaluate(async (apiUrl) => {
    const raw = localStorage.getItem("comanda.session");
    if (!raw) throw new Error("Missing browser session");
    const session = JSON.parse(raw) as { accessToken: string };
    const response = await fetch(`${apiUrl}/pedidos`, { headers: { Authorization: `Bearer ${session.accessToken}` } });
    if (!response.ok) throw new Error(`Could not list orders: ${response.status}`);
    return response.json();
  }, API_URL);
}

export async function currentCashShift(page: Page): Promise<{
  id: string;
  montoInicial: number;
  totalCalculado: number;
  totalDigital: number;
  totalVentas: number;
}> {
  return page.evaluate(async (apiUrl) => {
    const raw = localStorage.getItem("comanda.session");
    if (!raw) throw new Error("Missing browser session");
    const session = JSON.parse(raw) as { accessToken: string };
    const response = await fetch(`${apiUrl}/caja/turnos/actual`, { headers: { Authorization: `Bearer ${session.accessToken}` } });
    if (!response.ok) throw new Error(`Could not read cash shift: ${response.status}`);
    return response.json();
  }, API_URL);
}

export async function createMesaPedido(page: Page, quantity = 1): Promise<string> {
  const selects = page.getByRole("combobox");
  await selects.nth(0).selectOption({ index: 1 });
  const plateSelect = selects.nth(1);
  await plateSelect.selectOption({ index: 1 });
  const plateName = await plateSelect.locator("option:checked").textContent();
  await page.getByRole("spinbutton").first().fill(String(quantity));
  await page.getByRole("button", { name: "Crear pedido" }).click();
  return plateName?.trim() ?? "";
}

export function pesosFromCentavos(value: number): string {
  const abs = Math.trunc(Math.abs(value));
  return `${value < 0 ? "-" : ""}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
