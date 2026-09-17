export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-2xl border border-danger/20 bg-danger-light px-4 py-3 text-sm text-danger">
      {message}
    </p>
  );
}
