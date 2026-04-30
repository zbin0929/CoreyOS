/**
 * SkillPalette view template — quick-launch grid for Pack skills.
 *
 * Pack manifest:
 *
 * ```yaml
 * views:
 *   - id: ops-skills
 *     title: 运营技能
 *     template: SkillPalette
 *     skills:
 *       - { id: profit_calc, label: 计算利润 }
 *       - { id: ad_check,    label: 广告检查 }
 * ```
 *
 * Each item references one of the Pack's installed skills (under
 * `~/.hermes/skills/pack__<pack_id>/...`). Stage 5d shows the
 * buttons; stage 5e wires "click → open chat with skill applied".
 */
import type { PackView } from '@/lib/ipc/pack';
import { Wand2 } from 'lucide-react';

interface SkillEntry {
  id?: string;
  label?: string;
}

export function SkillPaletteTemplate({ view }: { view: PackView }) {
  const options = (view.options ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(options.skills) ? (options.skills as unknown[]) : [];
  // Tolerate both string ids and object form so manifest authors
  // can pick whichever feels natural.
  const skills: SkillEntry[] = raw.map((entry) => {
    if (typeof entry === 'string') return { id: entry, label: entry };
    if (entry && typeof entry === 'object') {
      const obj = entry as SkillEntry;
      return { id: obj.id ?? '', label: obj.label ?? obj.id ?? '' };
    }
    return {};
  });

  if (skills.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-bg-elev-1 p-6 text-sm text-fg-subtle">
        <p>This SkillPalette view has no <code>skills:</code> declared.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {skills.map((s, idx) => (
        <button
          key={s.id ?? idx}
          type="button"
          disabled
          className="flex items-center gap-2 rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-left opacity-80 hover:bg-bg-elev-2 disabled:cursor-not-allowed"
          title="stage 5d: click handler lands in stage 5e"
        >
          <Wand2 className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
          <span className="truncate text-sm text-fg">
            {s.label || s.id || `skill ${idx + 1}`}
          </span>
        </button>
      ))}
    </div>
  );
}
