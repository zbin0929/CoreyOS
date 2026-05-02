/**
 * Component-only helpers for the Agent Wizard. Pure-function helpers
 * (e.g. `generateUniqueId`) live in `AgentWizardHelpers.ts` so React
 * Fast Refresh keeps working on this component module.
 */

/**
 * Titled group container — wraps a vertical stack of related fields
 * with a small heading and optional right-side action slot (used for
 * the "Refresh models" button next to the Model card's title). Keeps
 * the DetailsStep readable when all three cards are open at once.
 */
export function FieldCard({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-bg-elev-1 p-3">
      <header className="flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
          {title}
        </h4>
        {actions}
      </header>
      {children}
    </section>
  );
}

