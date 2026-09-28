export async function activateOfflineUpdate(
  registration: ServiceWorkerRegistration,
  canActivate: () => Promise<boolean>,
): Promise<boolean> {
  if (!registration.waiting || !await canActivate()) return false;
  registration.waiting.postMessage({ type: "SKIP_WAITING" });
  return true;
}
