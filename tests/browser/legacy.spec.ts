import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { DEMO_PASSWORD, OPERATIVA_URL, loginAs } from "./session";

test("legacy operational data is discoverable, exportable, and preserved", async ({ page }) => {
  const orgId = "5dbff8f2-89ed-4c65-b39d-f6c029346ee1";
  const databaseName = `rxdb-dexie-comanda-operativa-${orgId}--0--outbox`;
  const sentinel = `legacy-${Date.now()}`;
  await page.goto(OPERATIVA_URL);
  await page.evaluate(async ({ databaseName, sentinel }) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("outbox", { keyPath: "id" });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("outbox", "readwrite");
        transaction.objectStore("outbox").put({ id: sentinel, futureField: "preserve-this-record" });
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => { database.close(); reject(transaction.error); };
      };
    });
  }, { databaseName, sentinel });

  await loginAs(page, "mozo.belgrano@donmario.test", DEMO_PASSWORD, OPERATIVA_URL);
  const exportButton = page.getByRole("button", { name: "Exportar datos locales antiguos" });
  await expect(exportButton).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("comanda-datos-locales-antiguos.json");
  const path = await download.path();
  expect(path).toBeTruthy();
  const exported = JSON.parse(await readFile(path!, "utf8")) as Array<{ name: string; stores: Record<string, Array<Record<string, unknown>>> }>;
  expect(exported).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: databaseName, stores: { outbox: expect.arrayContaining([expect.objectContaining({ id: sentinel, futureField: "preserve-this-record" })]) } }),
  ]));
  await expect.poll(() => page.evaluate(async (name) => (await indexedDB.databases()).some((database) => database.name === name), databaseName)).toBe(true);
});
