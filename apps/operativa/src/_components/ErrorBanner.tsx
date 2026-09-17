export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      style={{
        color: "var(--state-alerta)",
        background: "color-mix(in srgb, var(--state-alerta) 12%, transparent)",
        borderRadius: "var(--radius-md)",
        padding: "10px 14px",
        fontWeight: 800,
        fontSize: 14,
      }}
    >
      {message}
    </p>
  );
}
