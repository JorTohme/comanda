import { useEffect, useState } from "react";
import { getDb } from "./schema";

export function useRxData<T>(collectionName: "mesas" | "platos" | "pedidos"): T[] {
  const [data, setData] = useState<T[]>([]);

  useEffect(() => {
    let cancelled = false;
    let subscription: { unsubscribe(): void } | undefined;

    getDb().then((db) => {
      if (cancelled) return;
      subscription = db.collections[collectionName].find().$.subscribe((docs: { toJSON(): T }[]) => {
        setData(docs.map((doc) => doc.toJSON()));
      });
    });

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, [collectionName]);

  return data;
}
