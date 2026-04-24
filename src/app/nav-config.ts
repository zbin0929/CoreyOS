import {
  Home,
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
  Plug,
  Settings,
  type LucideIcon,
} from 'lucide-react';

/** Phase 5 · T5.5b — which `Capabilities` field must be truthy for this
 *  nav entry to appear when the user has an active adapter selected.
 *  `'channels'` is special-cased because the Rust field is a `Vec<String>`
 *  (empty ⇒ no messenger channels ⇒ hide the tab). Entries WITHOUT this
 *  field are always visible (chat/home/compare/analytics/settings/etc). */
export type NavCapability =
  | 'skills'
  | 'scheduler'
  | 'channels'
  | 'logs'
  | 'terminal'
  | 'trajectory_export'
  | 'memory';

export interface NavEntry {
  id: string;
  path: string;
  labelKey: string;
  icon: LucideIcon;
  group: 'primary' | 'ops';
  phase: number;
  shortcut?: string[];
  /** If set, this entry is hidden when the active adapter's
   *  `capabilities[requires]` is false/empty. */
  requires?: NavCapability;
}

export const NAV: NavEntry[] = [
  { id: 'home', path: '/', labelKey: 'nav.home', icon: Home, group: 'primary', phase: 0, shortcut: ['mod', '0'] },
  { id: 'chat', path: '/chat', labelKey: 'nav.chat', icon: MessageSquare, group: 'primary', phase: 1, shortcut: ['mod', '1'] },
  { id: 'compare', path: '/compare', labelKey: 'nav.compare', icon: Columns3, group: 'primary', phase: 4, shortcut: ['mod', '2'] },
  { id: 'skills', path: '/skills', labelKey: 'nav.skills', icon: Wand2, group: 'primary', phase: 4, shortcut: ['mod', '3'], requires: 'skills' },
  { id: 'trajectory', path: '/trajectory', labelKey: 'nav.trajectory', icon: GitBranch, group: 'primary', phase: 4, shortcut: ['mod', '4'], requires: 'trajectory_export' },
  { id: 'analytics', path: '/analytics', labelKey: 'nav.analytics', icon: BarChart3, group: 'ops', phase: 2, shortcut: ['mod', '5'] },
  { id: 'logs', path: '/logs', labelKey: 'nav.logs', icon: ScrollText, group: 'ops', phase: 2, shortcut: ['mod', '6'], requires: 'logs' },
  { id: 'terminal', path: '/terminal', labelKey: 'nav.terminal', icon: Terminal, group: 'ops', phase: 4, shortcut: ['mod', '7'], requires: 'terminal' },
  { id: 'scheduler', path: '/scheduler', labelKey: 'nav.scheduler', icon: Clock, group: 'ops', phase: 2, shortcut: ['mod', '8'], requires: 'scheduler' },
  { id: 'channels', path: '/channels', labelKey: 'nav.channels', icon: Radio, group: 'ops', phase: 3, shortcut: ['mod', '9'], requires: 'channels' },
  { id: 'models', path: '/models', labelKey: 'nav.models', icon: Boxes, group: 'ops', phase: 2 },
  // T8 — Agents (formerly "Extra Hermes instances" in Settings). Sits
  // adjacent to Models in the sidebar so the two halves of the
  // agent/model split (model configs ↔ running agents) are visible as
  // siblings.
  { id: 'agents', path: '/agents', labelKey: 'nav.agents', icon: Bot, group: 'ops', phase: 2 },
  { id: 'profiles', path: '/profiles', labelKey: 'nav.profiles', icon: FolderTree, group: 'ops', phase: 2 },
  { id: 'runbooks', path: '/runbooks', labelKey: 'nav.runbooks', icon: BookMarked, group: 'ops', phase: 4 },
  { id: 'budgets', path: '/budgets', labelKey: 'nav.budgets', icon: PiggyBank, group: 'ops', phase: 4 },
  // T7.3 — GUI over Hermes' native MEMORY.md + USER.md. `requires` is
  // unset so the tab is always visible (no adapter-side gating — the
  // files are independent of which adapter is active).
  { id: 'memory', path: '/memory', labelKey: 'nav.memory', icon: Brain, group: 'ops', phase: 7 },
  // T7.1 — MCP server manager. Always visible; works with any Hermes
  // instance (MCP is a Hermes-native capability, not adapter-gated).
  { id: 'mcp', path: '/mcp', labelKey: 'nav.mcp', icon: Plug, group: 'ops', phase: 7 },
  { id: 'settings', path: '/settings', labelKey: 'nav.settings', icon: Settings, group: 'ops', phase: 2, shortcut: ['mod', ','] },
];
