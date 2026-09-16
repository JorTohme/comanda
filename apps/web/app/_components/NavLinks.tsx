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
                ? "rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white"
                : "rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            }
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
