export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-hairline bg-surface p-6 shadow-card ${className}`}>{children}</div>;
}
