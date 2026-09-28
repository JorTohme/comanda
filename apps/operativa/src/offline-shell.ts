export async function registerOfflineShell(): Promise<ServiceWorkerRegistration | null> {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("/sw.js");
}
