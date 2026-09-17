type BadgeProps = React.ComponentPropsWithoutRef<"span"> & {
  tone?: "neutral" | "info" | "success" | "warning" | "danger" | "brand";
};

const TONE_CLASSES: Record<NonNullable<BadgeProps["tone"]>, string> = {
  neutral: "bg-hairline text-muted",
  info: "bg-accent/10 text-accent-hover",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger-light text-danger",
  brand: "bg-accent text-white",
};

export function Badge({ tone = "neutral", className = "", ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium before:h-1.5 before:w-1.5 before:rounded-full before:bg-current before:content-[''] ${TONE_CLASSES[tone]} ${className}`}
      {...props}
    />
  );
}
