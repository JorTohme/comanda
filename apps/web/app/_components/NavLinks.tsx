"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/catalogo", label: "Catálogo" },
  { href: "/salon", label: "Salón" },
  { href: "/pedidos", label: "Pedidos" },
  { href: "/caja", label: "Caja" },
  { href: "/reportes", label: "Reportes" },
];

const ADMIN_LINKS = [{ href: "/sucursales", label: "Sucursales" }];

function isAdmin(): boolean {
  try {
    const raw = window.localStorage.getItem("comanda.user");
    return raw ? (JSON.parse(raw) as { rol?: string }).rol === "admin" : false;
  } catch {
    return false;
  }
}

export function NavLinks() {
  const pathname = usePathname();
  const [admin, setAdmin] = useState(false);
  useEffect(() => setAdmin(isAdmin()), []);
  const links = admin ? [...LINKS, ...ADMIN_LINKS] : LINKS;
  return (
    <nav className="flex gap-1">
      {links.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={
              active
                ? "rounded-full bg-accent px-3 py-2 text-sm font-medium text-white"
                : "rounded-full px-3 py-2 text-sm font-medium text-muted hover:bg-hairline"
            }
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
