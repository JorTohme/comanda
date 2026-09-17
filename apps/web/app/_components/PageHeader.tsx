export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="space-y-1">
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-wide text-muted">{eyebrow}</p>}
        <h1 className="font-serif text-2xl font-semibold text-ink">{title}</h1>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
