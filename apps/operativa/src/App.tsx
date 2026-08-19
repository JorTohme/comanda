import { useEffect, useState } from "react";
import { pingApi, type HealthStatus } from "@comanda/shared";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export default function App() {
  const [health, setHealth] = useState<HealthStatus | "loading" | "unreachable">("loading");

  useEffect(() => {
    pingApi(API_URL)
      .then(setHealth)
      .catch(() => setHealth("unreachable"));
  }, []);

  return (
    <main>
      <h1>Comanda — Operativa</h1>
      <p>
        api ({API_URL}):{" "}
        {health === "loading" ? "checking..." : health === "unreachable" ? "unreachable" : health.status}
      </p>
    </main>
  );
}
