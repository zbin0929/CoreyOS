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
  FolderTree,
  BookMarked,
  PiggyBank,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export interface NavEntry {
  id: string;
  path: string;
  labelKey: string;
  icon: LucideIcon;
  group: 'primary' | 'ops';
  phase: number;
  shortcut?: string[];
}

export const NAV: NavEntry[] = [
  { id: 'home', path: '/', labelKey: 'nav.home', icon: Home, group: 'primary', phase: 0, shortcut: ['mod', '0'] },
  { id: 'chat', path: '/chat', labelKey: 'nav.chat', icon: MessageSquare, group: 'primary', phase: 1, shortcut: ['mod', '1'] },
  { id: 'compare', path: '/compare', labelKey: 'nav.compare', icon: Columns3, group: 'primary', phase: 4, shortcut: ['mod', '2'] },
  { id: 'skills', path: '/skills', labelKey: 'nav.skills', icon: Wand2, group: 'primary', phase: 4, shortcut: ['mod', '3'] },
  { id: 'trajectory', path: '/trajectory', labelKey: 'nav.trajectory', icon: GitBranch, group: 'primary', phase: 4, shortcut: ['mod', '4'] },
  { id: 'analytics', path: '/analytics', labelKey: 'nav.analytics', icon: BarChart3, group: 'ops', phase: 2, shortcut: ['mod', '5'] },
  { id: 'logs', path: '/logs', labelKey: 'nav.logs', icon: ScrollText, group: 'ops', phase: 2, shortcut: ['mod', '6'] },
  { id: 'terminal', path: '/terminal', labelKey: 'nav.terminal', icon: Terminal, group: 'ops', phase: 4, shortcut: ['mod', '7'] },
  { id: 'scheduler', path: '/scheduler', labelKey: 'nav.scheduler', icon: Clock, group: 'ops', phase: 2, shortcut: ['mod', '8'] },
  { id: 'channels', path: '/channels', labelKey: 'nav.channels', icon: Radio, group: 'ops', phase: 3, shortcut: ['mod', '9'] },
  { id: 'models', path: '/models', labelKey: 'nav.models', icon: Boxes, group: 'ops', phase: 2 },
  { id: 'profiles', path: '/profiles', labelKey: 'nav.profiles', icon: FolderTree, group: 'ops', phase: 2 },
  { id: 'runbooks', path: '/runbooks', labelKey: 'nav.runbooks', icon: BookMarked, group: 'ops', phase: 4 },
  { id: 'budgets', path: '/budgets', labelKey: 'nav.budgets', icon: PiggyBank, group: 'ops', phase: 4 },
  { id: 'settings', path: '/settings', labelKey: 'nav.settings', icon: Settings, group: 'ops', phase: 2, shortcut: ['mod', ','] },
];
