export function Section({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-12 rounded-2xl border border-border bg-bg-elev-1/70 p-4 shadow-[var(--shadow-1)]">
      <div className="mb-4 border-b border-border pb-3">
        <h2 className="text-sm font-semibold tracking-tight text-fg">{title}</h2>
        {description && (
          <p className="mt-1 text-xs leading-relaxed text-fg-muted">{description}</p>
        )}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-xs font-medium tracking-wide text-fg">{label}</span>
      {children}
      {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
    </label>
  );
}
