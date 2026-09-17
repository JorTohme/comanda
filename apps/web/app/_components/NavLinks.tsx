"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/catalogo", label: "Catálogo" },
  { href: "/salon", label: "Salón" },
  { href: "/pedidos", label: "Pedidos" },
  { href: "/caja", label: "Caja" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1">
      {LINKS.map((link) => {
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
