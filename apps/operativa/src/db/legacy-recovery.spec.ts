import { assessLegacyCommand, findLegacyDatabaseNames, migrateLegacyOutboxRecord } from "./legacy-recovery";

const tenant = { orgId: "00000000-0000-0000-0000-000000000001", sucursalId: "00000000-0000-0000-0000-000000000002" };
const branchDatabase = `comanda-operativa-${tenant.orgId}-${tenant.sucursalId}`;
const rawEntry = {
  id: "request-1",
  input: JSON.stringify({ tipoServicio: "barra", items: [], clientRequestId: "request-1" }),
  createdAt: "2026-09-27T00:00:00.000Z",
  futureField: { must: "survive export" },
};
const matchingOrder = { id: "request-1", clientRequestId: "request-1", orgId: tenant.orgId, sucursalId: tenant.sucursalId };

describe("legacy offline data recovery", () => {
  it("migrates only when branch database and optimistic row prove the same tenant", () => {
    expect(assessLegacyCommand(branchDatabase, tenant, rawEntry, matchingOrder)).toMatchObject({
      disposition: "recoverable",
      tenant,
      input: { clientRequestId: rawEntry.id },
    });
  });

  it.each([
    [`comanda-operativa-${tenant.orgId}`, matchingOrder],
    ["comanda-operativa", matchingOrder],
    [branchDatabase, { ...matchingOrder, sucursalId: "00000000-0000-0000-0000-000000000099" }],
    [branchDatabase, null],
  ])("quarantines data without complete matching branch proof", (databaseName, order) => {
    const result = assessLegacyCommand(databaseName, tenant, rawEntry, order);
    expect(result.disposition).toBe("quarantined");
    expect(result.raw).toContain("futureField");
  });

  it("keeps corrupt legacy JSON exportable without assigning a tenant", () => {
    const corrupt = { ...rawEntry, input: "{broken" };
    const result = assessLegacyCommand(branchDatabase, tenant, corrupt, matchingOrder);
    expect(result.disposition).toBe("quarantined");
    expect(result.raw).toContain("{broken");
    expect(result.raw).toContain("futureField");
  });

  it("quarantines old outbox data without assigning the currently selected tenant", () => {
    const migrated = migrateLegacyOutboxRecord(rawEntry);
    expect(migrated).toMatchObject({ orgId: "", sucursalId: "", status: "failed", errorCode: "legacy_recovery_required" });
    expect(migrated.legacyRaw).toContain("futureField");
  });

  it("finds only known historical RxDB/Dexie database names for the organization", () => {
    const names = [
      "rxdb-dexie-comanda-operativa--0--outbox",
      `rxdb-dexie-comanda-operativa-${tenant.orgId}--0--outbox`,
      `rxdb-dexie-${branchDatabase}--0--outbox`,
      "rxdb-dexie-some-other-app--0--outbox",
    ];
    expect(findLegacyDatabaseNames(names, tenant.orgId)).toEqual(names.slice(0, 2));
  });
});
