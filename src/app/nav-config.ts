import {
  Home,
  ListChecks,
  MessageSquare,
  Columns3,
  Wand2,
  GitBranch,
  BarChart3,
  ScrollText,
  Terminal,
  Clock,
  Radio,
  Boxes,
  Bot,
  FolderTree,
  BookMarked,
  PiggyBank,
  Brain,
  BookOpen,
  Mic,
  Plug,
  ShieldCheck,
  Workflow as WorkflowIcon,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export type NavCapability =
  | 'skills'
  | 'scheduler'
  | 'channels'
  | 'logs'
  | 'terminal'
  | 'trajectory_export'
  | 'memory';

/**
 * Sidebar buckets after the 2026-05-06 personalisation pass.
 *
 * - **`hero`**: a single, oversized entry — `chat`. Rendered by
 *   `<ChatHeroBlock>` with an inline recent-sessions list and a
 *   `+ New chat` CTA so the assistant feels like the product, not
 *   one tab among four.
 * - **`workspace`**: high-frequency surfaces that *do* something with
 *   the assistant's output (run workflows, queue tasks, swap models,
 *   land on the home dashboard).
 * - **`library`**: read-only / configuration surfaces (skills,
 *   knowledge base, MCP, channels, etc.). Collapsed by default.
 * - **`utility`**: passive observability — analytics, logs.
 * - **`settings`**: pinned to the bottom.
 */
export type NavGroup =
  | 'hero'
  | 'workspace'
  | 'library'
  | 'utility'
  | 'settings';

export interface NavEntry {
  id: string;
  path: string;
  labelKey: string;
  icon: LucideIcon;
  group: NavGroup;
  phase: number;
  shortcut?: string[];
  requires?: NavCapability;
}

export const NAV: NavEntry[] = [
  // ─── Hero ───────────────────────────────────────────────────
  // The assistant. Always at the top, gets a much taller block in
  // the sidebar with an inline recent-sessions list. Everything
  // else is in service of this entry.
  { id: 'chat', path: '/chat', labelKey: 'nav.chat', icon: MessageSquare, group: 'hero', phase: 1, shortcut: ['mod', '1'] },

  // ─── Workspace ──────────────────────────────────────────────
  // High-frequency surfaces. Things you go to *because of* a chat:
  // run a workflow, audit a task, swap a model, glance at home.
  { id: 'home', path: '/', labelKey: 'nav.home', icon: Home, group: 'workspace', phase: 0, shortcut: ['mod', '0'] },
  { id: 'workflows', path: '/workflows', labelKey: 'nav.workflows', icon: WorkflowIcon, group: 'workspace', phase: 9, shortcut: ['mod', '2'] },
  { id: 'tasks', path: '/tasks', labelKey: 'nav.tasks', icon: ListChecks, group: 'workspace', phase: 9, shortcut: ['mod', 't'] },
  { id: 'approvals', path: '/approvals', labelKey: 'nav.approvals', icon: ShieldCheck, group: 'workspace', phase: 9 },
  { id: 'models', path: '/models', labelKey: 'nav.models', icon: Boxes, group: 'workspace', phase: 2 },

  // ─── Library ────────────────────────────────────────────────
  // Read-only / configuration surfaces. Collapsed by default —
  // most users open them once a week. Per the 2026-05-06 route
  // audit, agents/scheduler/runbooks/voice/profiles/compare/
  // terminal already moved to Settings → Advanced.
  { id: 'skills', path: '/skills', labelKey: 'nav.skills', icon: Wand2, group: 'library', phase: 4, requires: 'skills' },
  { id: 'knowledge', path: '/knowledge', labelKey: 'nav.knowledge', icon: BookOpen, group: 'library', phase: 7 },
  { id: 'memory', path: '/memory', labelKey: 'nav.memory', icon: Brain, group: 'library', phase: 7 },
  { id: 'mcp', path: '/mcp', labelKey: 'nav.mcp', icon: Plug, group: 'library', phase: 7 },
  { id: 'channels', path: '/channels', labelKey: 'nav.channels', icon: Radio, group: 'library', phase: 3, requires: 'channels' },
  { id: 'trajectory', path: '/trajectory', labelKey: 'nav.trajectory', icon: GitBranch, group: 'library', phase: 4, requires: 'trajectory_export' },
  { id: 'budgets', path: '/budgets', labelKey: 'nav.budgets', icon: PiggyBank, group: 'library', phase: 4 },

  // ─── Utility ────────────────────────────────────────────────
  // Passive observability. Always-visible but visually quieter
  // than Workspace.
  { id: 'analytics', path: '/analytics', labelKey: 'nav.analytics', icon: BarChart3, group: 'utility', phase: 2, shortcut: ['mod', '3'] },
  { id: 'logs', path: '/logs', labelKey: 'nav.logs', icon: ScrollText, group: 'utility', phase: 2, shortcut: ['mod', '4'], requires: 'logs' },

  // ─── Settings ───────────────────────────────────────────────
  { id: 'settings', path: '/settings', labelKey: 'nav.settings', icon: Settings, group: 'settings', phase: 2, shortcut: ['mod', ','] },
];

/**
 * Routes that still exist (per N-2) but were removed from the sidebar
 * during the 2026-05-06 audit. Surfaced in Settings → Advanced so power
 * users can still find them. Order is the recommended discovery order.
 */
export interface DemotedRoute {
  id: string;
  path: string;
  labelKey: string;
  icon: LucideIcon;
}

export const DEMOTED_ROUTES: DemotedRoute[] = [
  { id: 'agents', path: '/agents', labelKey: 'nav.agents', icon: Bot },
  { id: 'scheduler', path: '/scheduler', labelKey: 'nav.scheduler', icon: Clock },
  { id: 'runbooks', path: '/runbooks', labelKey: 'nav.runbooks', icon: BookMarked },
  { id: 'profiles', path: '/profiles', labelKey: 'nav.profiles', icon: FolderTree },
  { id: 'voice', path: '/voice', labelKey: 'nav.voice', icon: Mic },
  { id: 'compare', path: '/compare', labelKey: 'nav.compare', icon: Columns3 },
  { id: 'terminal', path: '/terminal', labelKey: 'nav.terminal', icon: Terminal },
];
