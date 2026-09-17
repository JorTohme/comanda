import "./globals.css";
import { AuthSession } from "./_components/AuthSession";
import { NavLinks } from "./_components/NavLinks";

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
            <AuthSession />
          </div>
        </header>
        <main className="mx-auto max-w-5xl p-6">{children}</main>
      </body>
    </html>
  );
}
