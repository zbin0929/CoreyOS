/**
 * FormRunner view template — typed form wired to an MCP call.
 *
 * Pack manifest:
 *
 * ```yaml
 * views:
 *   - id: lookup-asin
 *     title: ASIN 速查
 *     template: FormRunner
 *     data_source: { mcp: amazon-sp, method: get_listing }
 *     fields:
 *       - { key: asin, label: ASIN, type: string, required: true }
 *       - { key: market, label: 市场, type: enum, options: [US, EU, JP], default: US }
 *     submit_label: 查询
 * ```
 *
 * Stage 5d ships the disabled form layout. Stage 5e wires submit
 * to invoke the MCP method via the workflow runner.
 */
import type { PackView } from '@/lib/ipc/pack';

interface FormField {
  key?: string;
  label?: string;
  type?: string;
  required?: boolean;
  default?: unknown;
  options?: string[];
}

export function FormRunnerTemplate({ view }: { view: PackView }) {
  const options = (view.options ?? {}) as Record<string, unknown>;
  const fields: FormField[] = Array.isArray(options.fields)
    ? (options.fields as FormField[])
    : [];
  const submitLabel = (options.submit_label as string) ?? 'Submit';

  if (fields.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-bg-elev-1 p-6 text-sm text-fg-subtle">
        <p>This FormRunner view has no <code>fields:</code> declared.</p>
      </div>
    );
  }

  return (
    <form
      className="flex max-w-md flex-col gap-3 rounded-md border border-border bg-bg-elev-1 p-4"
      onSubmit={(e) => e.preventDefault()}
    >
      {fields.map((f, idx) => (
        <label key={f.key ?? idx} className="flex flex-col gap-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-fg-subtle">
            {f.label ?? f.key ?? `field ${idx + 1}`}
            {f.required && <span className="ml-1 text-danger">*</span>}
          </span>
          {f.type === 'enum' && Array.isArray(f.options) ? (
            <select
              disabled
              defaultValue={typeof f.default === 'string' ? f.default : ''}
              className="rounded border border-border bg-bg-elev-2 px-2 py-1 text-fg disabled:opacity-70"
            >
              {f.options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={f.type === 'number' ? 'number' : 'text'}
              disabled
              defaultValue={
                typeof f.default === 'string' || typeof f.default === 'number'
                  ? String(f.default)
                  : ''
              }
              className="rounded border border-border bg-bg-elev-2 px-2 py-1 text-fg disabled:opacity-70"
            />
          )}
        </label>
      ))}
      <button
        type="submit"
        disabled
        className="self-start rounded bg-gold-600 px-3 py-1.5 text-sm font-medium text-bg disabled:cursor-not-allowed disabled:opacity-70"
        title="stage 5d: submit handler lands in stage 5e"
      >
        {submitLabel}
      </button>
      <p className="text-xs text-fg-subtle">
        stage 5d: data_source wiring lands in stage 5e
      </p>
    </form>
  );
}
