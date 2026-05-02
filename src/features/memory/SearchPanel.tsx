import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Loader2, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { ipcErrorMessage, sessionSearch, type SessionSearchHit } from '@/lib/ipc';

import { splitHighlight } from './utils';

/**
 * T7.3b — session search tab. FTS5 over Hermes' `~/.hermes/state.db`.
 *
 * UX is intentionally spartan: a single search input (Enter to run),
 * a vertical list of hit rows. No filter chips, no "open session"
 * navigation yet — we don't have a corresponding session viewer on
 * our side (Hermes' sessions live in its DB, not Corey's). Clicking
 * a row just highlights it; the session id is in the tooltip so
 * power users can `hermes -r <id>` from the CLI.
 */
export function SearchPanel() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<SessionSearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await sessionSearch(q, 50);
      setHits(rows);
    } catch (e) {
      setError(ipcErrorMessage(e));
      setHits([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run();
          }}
          placeholder={t('memory.search_placeholder')}
          className="flex-1 rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
          data-testid="memory-search-input"
        />
        <Button
          size="sm"
          variant="primary"
          onClick={() => void run()}
          disabled={loading || !query.trim()}
          data-testid="memory-search-run"
        >
          {loading ? (
            <Icon icon={Loader2} size="sm" className="animate-spin" />
          ) : (
            <Icon icon={Search} size="sm" />
          )}
          {t('memory.search_run')}
        </Button>
      </div>
      <p className="text-[11px] text-fg-subtle">{t('memory.search_hint')}</p>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2 text-xs text-danger"
          data-testid="memory-search-error"
        >
          <Icon icon={AlertCircle} size="sm" className="mt-0.5 flex-none" />
          <span>{error}</span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto" data-testid="memory-search-results">
        {hits === null ? (
          <div className="flex items-center justify-center py-10 text-xs text-fg-subtle">
            {t('memory.search_idle')}
          </div>
        ) : hits.length === 0 ? (
          <div
            className="flex items-center justify-center py-10 text-xs text-fg-subtle"
            data-testid="memory-search-empty"
          >
            {t('memory.search_no_hits')}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {hits.map((h, i) => (
              <SearchHitRow key={`${h.session_id}-${i}`} hit={h} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SearchHitRow({ hit }: { hit: SessionSearchHit }) {
  const { t } = useTranslation();
  const ts = new Date(hit.timestamp_ms);
  // FTS5 snippet comes back with `>>>match<<<` markers. We split on
  // them and wrap the matched fragments in <mark> so highlights
  // render without trusting arbitrary HTML from the query.
  const parts = splitHighlight(hit.snippet);
  return (
    <li
      className="rounded-md border border-border bg-bg-elev-1 p-3 text-xs"
      title={hit.session_id}
      data-testid="memory-search-hit"
    >
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-fg-subtle">
        <span className="font-medium text-fg">
          {hit.session_title ?? t('memory.search_untitled')}
        </span>
        <span className="rounded bg-bg-elev-2 px-1.5 py-0.5 uppercase tracking-wider">
          {hit.session_source || 'cli'}
        </span>
        <span className="rounded bg-bg-elev-2 px-1.5 py-0.5 uppercase tracking-wider">
          {hit.role}
        </span>
        <span className="ml-auto">{ts.toLocaleString()}</span>
      </div>
      <div className="whitespace-pre-wrap text-fg">
        {parts.map((p, idx) =>
          p.match ? (
            <mark
              key={idx}
              className="rounded bg-accent/20 px-0.5 text-accent"
            >
              {p.text}
            </mark>
          ) : (
            <span key={idx}>{p.text}</span>
          ),
        )}
      </div>
    </li>
  );
}
