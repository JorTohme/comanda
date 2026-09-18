import "./globals.css";
import { AuthGate } from "./_components/AuthGate";
import { AuthSession } from "./_components/AuthSession";
import { NavLinks } from "./_components/NavLinks";
import { SucursalSwitcher } from "./_components/SucursalSwitcher";

export const metadata = {
  title: "Comanda — Consola",
  description: "Consola web (Admin + Caja)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-bg font-sans text-ink antialiased">
        <header className="border-b border-hairline bg-surface">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <span className="font-serif text-lg font-semibold text-ink">Comanda</span>
            <NavLinks />
            <div className="flex items-center gap-3">
              <SucursalSwitcher />
              <AuthSession />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-5xl p-6">
          <AuthGate>{children}</AuthGate>
        </main>
      </body>
    </html>
  );
}
