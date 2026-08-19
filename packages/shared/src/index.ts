export interface HealthStatus {
  status: "ok" | "error";
}

/**
 * Fetches GET {baseUrl}/health and returns the parsed status.
 * Shared by web and operativa so neither hand-rolls its own health fetch.
 */
export async function pingApi(baseUrl: string): Promise<HealthStatus> {
  const res = await fetch(`${baseUrl}/health`);
  if (!res.ok) {
    return { status: "error" };
  }
  return (await res.json()) as HealthStatus;
}
