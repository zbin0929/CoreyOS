import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  FileText,
  Loader2,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { PageHeader } from '@/app/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { InfoHint } from '@/components/ui/info-hint';
import { cn } from '@/lib/cn';
import {
  ipcErrorMessage,
  knowledgeDelete,
  knowledgeList,
  knowledgeSearch,
  knowledgeUpload,
  type KnowledgeDoc,
  type KnowledgeSearchHit,
} from '@/lib/ipc';

export function KnowledgeRoute() {
  const { t } = useTranslation();
  const [docs, setDocs] = useState<KnowledgeDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<KnowledgeSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDocs(await knowledgeList());
    } catch (e) {
      setError(ipcErrorMessage(e));
      setDocs([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onUpload = useCallback(
    async (file: File) => {
      const FIFTY_KB = 50 * 1024;
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const binaryExts = ['pdf', 'docx', 'xlsx', 'pptx', 'zip', 'gz', 'tar'];
      if (binaryExts.includes(ext)) {
        const ok = window.confirm(
          t('knowledge.binary_warn', { ext, name: file.name }),
        );
        if (!ok) return;
      }
      if (file.size > FIFTY_KB) {
        const ok = window.confirm(
          t('knowledge.size_warn', { name: file.name, sizeKB: Math.round(file.size / 1024) }),
        );
        if (!ok) return;
      }
      setUploading(true);
      setError(null);
      try {
        const text = await file.text();
        await knowledgeUpload(file.name, file.name, text);
        await load();
      } catch (e) {
        setError(ipcErrorMessage(e));
      } finally {
        setUploading(false);
      }
    },
    [load, t],
  );

  const onDelete = useCallback(
    async (id: string) => {
      try {
        await knowledgeDelete(id);
        await load();
      } catch (e) {
        setError(ipcErrorMessage(e));
      }
    },
    [load],
  );

  const onSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      setSearchResults(await knowledgeSearch(q, 5));
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) void onUpload(file);
    },
    [onUpload],
  );

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void onUpload(file);
      e.target.value = '';
    },
    [onUpload],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('knowledge.title')}
        subtitle={t('knowledge.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <InfoHint
              title={t('knowledge.title')}
              content={t('knowledge.help')}
              testId="knowledge-help"
            />
            <Button
              size="sm"
              variant="primary"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              data-testid="knowledge-upload"
            >
              <Icon icon={uploading ? Loader2 : Plus} size="sm" className={cn(uploading && 'animate-spin')} />
              {uploading ? t('knowledge.uploading') : t('knowledge.upload')}
            </Button>
          </div>
        }
      />

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept=".txt,.md,.json,.csv,.yaml,.yml,.xml,.html,.log,.rs,.py,.ts,.js,.go"
        onChange={onFileChange}
        data-testid="knowledge-file-input"
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
            <Icon icon={AlertCircle} size="md" className="mt-0.5 flex-none" />
            <span>{error}</span>
          </div>
        )}

        {/* Drop zone */}
        <div
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          className={cn(
            'mb-4 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-6 py-8 text-center transition-colors',
            'hover:border-gold-500/40 hover:bg-gold-500/5',
          )}
          data-testid="knowledge-drop-zone"
        >
          <Icon icon={Upload} size="lg" className="text-fg-subtle" />
          <p className="text-sm text-fg-muted">{t('knowledge.drop_hint')}</p>
          <p className="text-xs text-fg-subtle">{t('knowledge.drop_formats')}</p>
        </div>

        {/* Search bar */}
        {docs && docs.length > 0 && (
          <div className="mb-4 flex gap-2">
            <div className="relative flex-1">
              <Icon icon={Search} size="sm" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchResults(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void onSearch();
                }}
                placeholder={t('knowledge.search_placeholder')}
                className="w-full rounded-md border border-border bg-bg-elev-1 py-1.5 pl-8 pr-3 text-sm text-fg placeholder:text-fg-subtle focus:border-gold-500/40 focus:outline-none focus:ring-1 focus:ring-gold-500/40"
                data-testid="knowledge-search-input"
              />
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void onSearch()}
              disabled={searching || !searchQuery.trim()}
              data-testid="knowledge-search-btn"
            >
              <Icon icon={searching ? Loader2 : Search} size="sm" className={cn(searching && 'animate-spin')} />
              {t('knowledge.search')}
            </Button>
          </div>
        )}

        {/* Search results */}
        {searchResults && (
          <div className="mb-4">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-subtle">
              {t('knowledge.search_results', { count: searchResults.length })}
            </h3>
            <div className="flex flex-col gap-2">
              {searchResults.map((hit, i) => (
                <div
                  key={`${hit.doc_id}-${hit.chunk_index}`}
                  className="rounded-md border border-border bg-bg-elev-1 px-3 py-2"
                  data-testid={`knowledge-hit-${i}`}
                >
                  <div className="flex items-center gap-2 text-xs">
                    <Icon icon={FileText} size="xs" className="text-fg-subtle" />
                    <span className="font-medium text-fg">{hit.doc_name}</span>
                    <span className="text-fg-subtle">
                      {t('knowledge.chunk', { index: hit.chunk_index + 1 })}
                    </span>
                    <span className="ml-auto text-fg-subtle">
                      {(hit.score * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-fg-muted line-clamp-3">{hit.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Document list */}
        {docs === null ? (
          <div className="flex flex-1 items-center justify-center text-fg-muted">
            <Icon icon={Loader2} size="md" className="animate-spin" />
          </div>
        ) : docs.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={t('knowledge.empty_title')}
            description={t('knowledge.empty_desc')}
          />
        ) : (
          <ul className="flex flex-col gap-2" data-testid="knowledge-doc-list">
            {docs.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center gap-3 rounded-md border border-border bg-bg-elev-1 px-3 py-2"
                data-testid={`knowledge-doc-${doc.id}`}
              >
                <Icon icon={FileText} size="md" className="flex-none text-fg-subtle" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-fg">{doc.name}</div>
                  <div className="text-xs text-fg-subtle">
                    {formatSize(doc.total_chars)} · {doc.chunk_count} {t('knowledge.chunks')} · {formatDate(doc.created_at)}
                  </div>
                </div>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => void onDelete(doc.id)}
                  aria-label={t('knowledge.delete')}
                  data-testid={`knowledge-delete-${doc.id}`}
                >
                  <Icon icon={Trash2} size="xs" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatSize(chars: number): string {
  if (chars < 1024) return `${chars} chars`;
  return `${(chars / 1024).toFixed(1)}K chars`;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString();
}
