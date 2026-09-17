"use client";

import { useEffect, useState } from "react";
import { pingApi, type HealthStatus } from "@comanda/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function HomePage() {
  const [health, setHealth] = useState<HealthStatus | "loading" | "unreachable">("loading");

  useEffect(() => {
    pingApi(API_URL)
      .then(setHealth)
      .catch(() => setHealth("unreachable"));
  }, []);

  return (
    <div className="space-y-2">
      <h1 className="font-serif text-2xl font-semibold text-ink">Comanda — Consola</h1>
      <p className="text-sm text-muted">
        api ({API_URL}):{" "}
        {health === "loading" ? "checking..." : health === "unreachable" ? "unreachable" : health.status}
      </p>
    </div>
  );
}
