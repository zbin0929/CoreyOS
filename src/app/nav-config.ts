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

export type NavGroup = 'core' | 'tools' | 'manage';

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
  { id: 'home', path: '/', labelKey: 'nav.home', icon: Home, group: 'core', phase: 0, shortcut: ['mod', '0'] },
  { id: 'chat', path: '/chat', labelKey: 'nav.chat', icon: MessageSquare, group: 'core', phase: 1, shortcut: ['mod', '1'] },
  { id: 'compare', path: '/compare', labelKey: 'nav.compare', icon: Columns3, group: 'core', phase: 4, shortcut: ['mod', '2'] },
  { id: 'skills', path: '/skills', labelKey: 'nav.skills', icon: Wand2, group: 'core', phase: 4, shortcut: ['mod', '3'], requires: 'skills' },
  { id: 'trajectory', path: '/trajectory', labelKey: 'nav.trajectory', icon: GitBranch, group: 'core', phase: 4, shortcut: ['mod', '4'], requires: 'trajectory_export' },

  { id: 'analytics', path: '/analytics', labelKey: 'nav.analytics', icon: BarChart3, group: 'tools', phase: 2, shortcut: ['mod', '5'] },
  { id: 'logs', path: '/logs', labelKey: 'nav.logs', icon: ScrollText, group: 'tools', phase: 2, shortcut: ['mod', '6'], requires: 'logs' },
  { id: 'terminal', path: '/terminal', labelKey: 'nav.terminal', icon: Terminal, group: 'tools', phase: 4, shortcut: ['mod', '7'], requires: 'terminal' },
  { id: 'channels', path: '/channels', labelKey: 'nav.channels', icon: Radio, group: 'tools', phase: 3, shortcut: ['mod', '8'], requires: 'channels' },
  { id: 'models', path: '/models', labelKey: 'nav.models', icon: Boxes, group: 'tools', phase: 2 },
  { id: 'agents', path: '/agents', labelKey: 'nav.agents', icon: Bot, group: 'tools', phase: 2 },
  { id: 'settings', path: '/settings', labelKey: 'nav.settings', icon: Settings, group: 'tools', phase: 2, shortcut: ['mod', ','] },

  { id: 'scheduler', path: '/scheduler', labelKey: 'nav.scheduler', icon: Clock, group: 'manage', phase: 2, requires: 'scheduler' },
  { id: 'profiles', path: '/profiles', labelKey: 'nav.profiles', icon: FolderTree, group: 'manage', phase: 2 },
  { id: 'runbooks', path: '/runbooks', labelKey: 'nav.runbooks', icon: BookMarked, group: 'manage', phase: 4 },
  { id: 'budgets', path: '/budgets', labelKey: 'nav.budgets', icon: PiggyBank, group: 'manage', phase: 4 },
  { id: 'memory', path: '/memory', labelKey: 'nav.memory', icon: Brain, group: 'manage', phase: 7 },
  { id: 'knowledge', path: '/knowledge', labelKey: 'nav.knowledge', icon: BookOpen, group: 'manage', phase: 7 },
  { id: 'voice', path: '/voice', labelKey: 'nav.voice', icon: Mic, group: 'manage', phase: 8 },
  { id: 'mcp', path: '/mcp', labelKey: 'nav.mcp', icon: Plug, group: 'manage', phase: 7 },
  { id: 'workflows', path: '/workflows', labelKey: 'nav.workflows', icon: WorkflowIcon, group: 'manage', phase: 9 },
];
