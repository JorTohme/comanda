"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "./useSession";

const LINKS_BY_ROLE = {
  admin: ["/catalogo", "/salon", "/pedidos", "/caja", "/reportes", "/sucursales"],
  caja: ["/pedidos", "/caja"],
  mozo: ["/salon", "/pedidos"],
  cocina: ["/catalogo", "/pedidos"],
} as const;
const LINKS = [
  { href: "/catalogo", label: "Catálogo" },
  { href: "/salon", label: "Salón" },
  { href: "/pedidos", label: "Pedidos" },
  { href: "/caja", label: "Caja" },
  { href: "/reportes", label: "Reportes" },
  { href: "/sucursales", label: "Sucursales" },
];

export function NavLinks() {
  const pathname = usePathname();
  const { session } = useSession();
  const allowed: readonly string[] = session ? LINKS_BY_ROLE[session.user.rol] : [];
  const links = LINKS.filter((link) => allowed.includes(link.href));
  return (
    <nav className="flex max-w-full flex-wrap gap-1" aria-label="Navegación principal">
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
