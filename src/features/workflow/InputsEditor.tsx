import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { WorkflowInput } from '@/lib/ipc';

/**
 * Inline editor for `WorkflowDef.inputs`.
 *
 * Lives in its own component because the Editor's left panel was
 * already crowded with Basic Info, and "what runtime parameters does
 * this workflow ask for?" is a self-contained concern. Without this
 * editor, users could only ever ship `inputs: []` workflows from the
 * UI — which made the run-time inputs prompt always empty and broke
 * approval-card templating like `{{inputs.campaign_name}}`.
 *
 * Field semantics mirror the Rust `WorkflowInput` struct:
 *   - `name`     — variable name, used by `{{inputs.<name>}}` in templates.
 *                  Validated client-side as a JS-identifier-ish slug.
 *   - `label`    — what the runtime prompt UI shows above the field.
 *                  Falls back to `name` when blank.
 *   - `type`     — `text` / `number` / `textarea`. `textarea` is treated
 *                  as `string` by the engine; the dropdown distinction
 *                  only changes the run-time input widget.
 *   - `default`  — value pre-filled into the run-time prompt.
 *   - `required` — empty value blocks Start.
 *   - `options`  — when non-empty, the run-time prompt shows a select
 *                  instead of a text input. Stored as a comma-separated
 *                  string here, split on submit.
 */

const INPUT_TYPES = [
  { value: 'text', label: '文本 / Text' },
  { value: 'number', label: '数字 / Number' },
  { value: 'textarea', label: '多行 / Textarea' },
] as const;

interface Props {
  inputs: WorkflowInput[];
  onChange: (inputs: WorkflowInput[]) => void;
}

export function InputsEditor({ inputs, onChange }: Props) {
  const { t } = useTranslation();

  const updateAt = (i: number, patch: Partial<WorkflowInput>) => {
    const next = inputs.map((inp, idx) => (idx === i ? { ...inp, ...patch } : inp));
    onChange(next);
  };

  const removeAt = (i: number) => {
    onChange(inputs.filter((_, idx) => idx !== i));
  };

  const add = () => {
    // Auto-name as `param_<n>` so two clicks of "+" don't collide.
    // Users will rename immediately; this just keeps the array valid.
    const usedNames = new Set(inputs.map((i) => i.name));
    let n = inputs.length + 1;
    while (usedNames.has(`param_${n}`)) n += 1;
    onChange([
      ...inputs,
      {
        name: `param_${n}`,
        label: '',
        type: 'text',
        default: '',
        required: false,
      },
    ]);
  };

  return (
    <div className="rounded-md border border-border bg-bg-elev-2/40">
      <details open={inputs.length > 0}>
        <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-xs font-medium text-fg-subtle hover:text-fg">
          <span>
            {t('workflow_page.inputs_section', { defaultValue: '运行参数' })}
            <span className="ml-1 text-fg-muted">({inputs.length})</span>
          </span>
          <span className="text-[10px] text-fg-muted">
            {t('workflow_page.inputs_section_hint', {
              defaultValue: '运行时弹窗收集',
            })}
          </span>
        </summary>

        <div className="space-y-3 border-t border-border px-3 py-3">
          {inputs.map((inp, i) => {
            // Comma-separated options; split on submit. Empty string
            // means "no enum"; we keep the raw text so the user can
            // type `a, b` mid-edit without us mangling the cursor.
            const optionsRaw = (inp.options ?? []).join(', ');
            return (
              <div
                key={i}
                className="space-y-1.5 rounded-md border border-border/60 p-2.5"
              >
                <div className="flex items-center gap-1.5">
                  <Input
                    value={inp.name}
                    onChange={(e) =>
                      updateAt(i, {
                        // Strip whitespace; templates can't reference
                        // `{{inputs. campaign }}` reliably.
                        name: e.target.value.replace(/\s+/g, ''),
                      })
                    }
                    placeholder={t('workflow_page.input_name_placeholder', {
                      defaultValue: 'campaign_name',
                    })}
                    className="flex-1 text-xs"
                    aria-label="name"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeAt(i)}
                    aria-label={t('workflow_page.remove', { defaultValue: '删除' })}
                  >
                    <Icon icon={Trash2} size="xs" className="text-red-500" />
                  </Button>
                </div>

                <Input
                  value={inp.label ?? ''}
                  onChange={(e) => updateAt(i, { label: e.target.value })}
                  placeholder={t('workflow_page.input_label_placeholder', {
                    defaultValue: '展示给用户的标签（可留空）',
                  })}
                  className="text-xs"
                  aria-label="label"
                />

                <div className="flex items-center gap-1.5">
                  <Select
                    value={inp.type || 'text'}
                    onChange={(v) => updateAt(i, { type: v })}
                    options={[...INPUT_TYPES]}
                    ariaLabel="type"
                  />
                  <label className="flex shrink-0 items-center gap-1 text-[11px] text-fg-subtle">
                    <input
                      type="checkbox"
                      checked={!!inp.required}
                      onChange={(e) => updateAt(i, { required: e.target.checked })}
                      className="accent-gold-500"
                    />
                    {t('workflow_page.input_required', { defaultValue: '必填' })}
                  </label>
                </div>

                <Input
                  value={inp.default ?? ''}
                  onChange={(e) => updateAt(i, { default: e.target.value })}
                  placeholder={t('workflow_page.input_default_placeholder', {
                    defaultValue: '默认值（可留空）',
                  })}
                  className="text-xs"
                  aria-label="default"
                />

                <Input
                  value={optionsRaw}
                  onChange={(e) => {
                    // Empty string normalizes to undefined so YAML
                    // doesn't carry a noisy `options: []` line.
                    const raw = e.target.value;
                    const list = raw
                      .split(',')
                      .map((s) => s.trim())
                      .filter((s) => s.length > 0);
                    updateAt(i, { options: list.length > 0 ? list : undefined });
                  }}
                  placeholder={t('workflow_page.input_options_placeholder', {
                    defaultValue: '可选项（逗号分隔，留空则为自由输入）',
                  })}
                  className="text-xs"
                  aria-label="options"
                />
              </div>
            );
          })}

          <Button variant="ghost" size="sm" onClick={add} className="w-full">
            <Icon icon={Plus} size="xs" />
            {t('workflow_page.add_input', { defaultValue: '添加参数' })}
          </Button>

          {inputs.length === 0 && (
            <p className="text-[11px] text-fg-muted">
              {t('workflow_page.inputs_empty_hint', {
                defaultValue:
                  '没有参数时，此工作流点 “运行” 会直接开始；用 {{inputs.xxx}} 在 Prompt 里引用值。',
              })}
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
