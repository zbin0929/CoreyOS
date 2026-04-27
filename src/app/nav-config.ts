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
  BookOpen,
  Mic,
  Plug,
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

export type NavGroup = 'primary' | 'tools' | 'more' | 'settings';

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
  { id: 'home', path: '/', labelKey: 'nav.home', icon: Home, group: 'primary', phase: 0, shortcut: ['mod', '0'] },
  { id: 'chat', path: '/chat', labelKey: 'nav.chat', icon: MessageSquare, group: 'primary', phase: 1, shortcut: ['mod', '1'] },
  { id: 'workflows', path: '/workflows', labelKey: 'nav.workflows', icon: WorkflowIcon, group: 'primary', phase: 9, shortcut: ['mod', '2'] },
  { id: 'models', path: '/models', labelKey: 'nav.models', icon: Boxes, group: 'primary', phase: 2 },
  // `agents` route lives in /more (kept for power-users who want to
  // see the live AdapterRegistry / health pills) but no longer in
  // the primary group: post the Hermes-as-default pivot (Topbar
  // AgentSwitcher hidden in the same change), there's a single
  // active backend so the page is informational, not navigational.
  { id: 'agents', path: '/agents', labelKey: 'nav.agents', icon: Bot, group: 'more', phase: 2 },

  { id: 'compare', path: '/compare', labelKey: 'nav.compare', icon: Columns3, group: 'tools', phase: 4, shortcut: ['mod', '3'] },
  { id: 'analytics', path: '/analytics', labelKey: 'nav.analytics', icon: BarChart3, group: 'tools', phase: 2, shortcut: ['mod', '4'] },
  { id: 'terminal', path: '/terminal', labelKey: 'nav.terminal', icon: Terminal, group: 'tools', phase: 4, shortcut: ['mod', '5'], requires: 'terminal' },
  { id: 'logs', path: '/logs', labelKey: 'nav.logs', icon: ScrollText, group: 'tools', phase: 2, shortcut: ['mod', '6'], requires: 'logs' },

  { id: 'skills', path: '/skills', labelKey: 'nav.skills', icon: Wand2, group: 'more', phase: 4, requires: 'skills' },
  { id: 'trajectory', path: '/trajectory', labelKey: 'nav.trajectory', icon: GitBranch, group: 'more', phase: 4, requires: 'trajectory_export' },
  { id: 'channels', path: '/channels', labelKey: 'nav.channels', icon: Radio, group: 'more', phase: 3, requires: 'channels' },
  { id: 'scheduler', path: '/scheduler', labelKey: 'nav.scheduler', icon: Clock, group: 'more', phase: 2, requires: 'scheduler' },
  { id: 'profiles', path: '/profiles', labelKey: 'nav.profiles', icon: FolderTree, group: 'more', phase: 2 },
  { id: 'runbooks', path: '/runbooks', labelKey: 'nav.runbooks', icon: BookMarked, group: 'more', phase: 4 },
  { id: 'budgets', path: '/budgets', labelKey: 'nav.budgets', icon: PiggyBank, group: 'more', phase: 4 },
  { id: 'memory', path: '/memory', labelKey: 'nav.memory', icon: Brain, group: 'more', phase: 7 },
  { id: 'knowledge', path: '/knowledge', labelKey: 'nav.knowledge', icon: BookOpen, group: 'more', phase: 7 },
  { id: 'voice', path: '/voice', labelKey: 'nav.voice', icon: Mic, group: 'more', phase: 8 },
  { id: 'mcp', path: '/mcp', labelKey: 'nav.mcp', icon: Plug, group: 'more', phase: 7 },

  { id: 'settings', path: '/settings', labelKey: 'nav.settings', icon: Settings, group: 'settings', phase: 2, shortcut: ['mod', ','] },
];
