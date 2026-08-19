export const metadata = {
  title: "Comanda — Consola",
  description: "Consola web (Admin + Caja)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
