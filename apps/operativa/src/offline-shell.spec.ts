import { activateOfflineUpdate } from "./offline-update";

describe("activateOfflineUpdate", () => {
  it("keeps a waiting worker until the operator confirms work is safe", async () => {
    const postMessage = jest.fn();
    const registration = { waiting: { postMessage } } as unknown as ServiceWorkerRegistration;

    await expect(activateOfflineUpdate(registration, async () => false)).resolves.toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("requests activation only after an explicit safe confirmation", async () => {
    const postMessage = jest.fn();
    const registration = { waiting: { postMessage } } as unknown as ServiceWorkerRegistration;

    await expect(activateOfflineUpdate(registration, async () => true)).resolves.toBe(true);
    expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });
});
