export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" style={{ color: "red" }}>
      {message}
    </p>
  );
}
