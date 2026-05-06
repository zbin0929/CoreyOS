import type { ComponentType } from 'react';

import { MetricsTodayWidget } from './MetricsTodayWidget';
import { PackHomeWidgetsList } from './PackHomeWidgetsList';
import { QuickActionsWidget } from './QuickActionsWidget';
import { RecentChatsWidget } from './RecentChatsWidget';
import { RecentWorkflowsWidget } from './RecentWorkflowsWidget';
import { SystemStatusWidget } from './SystemStatusWidget';
import { TasksActiveWidget } from './TasksActiveWidget';

export type WidgetSpan = 'full' | 'wide' | 'sidebar';

export interface HomeWidgetSpec {
  id: string;
  /** i18n key for the widget's name in the Home → Edit catalog. */
  labelKey: string;
  /** Render slot:
   *   - `full`    — spans both columns (e.g. metrics row)
   *   - `wide`    — left column on `lg+` screens
   *   - `sidebar` — right column on `lg+` screens
   */
  span: WidgetSpan;
  /** Whether the widget is shown by default for a fresh install. */
  defaultVisible: boolean;
  /** The actual widget component. */
  Component: ComponentType;
}

export const HOME_WIDGETS: HomeWidgetSpec[] = [
  {
    id: 'metrics_today',
    labelKey: 'home.widget_metrics_today',
    span: 'full',
    defaultVisible: true,
    Component: MetricsTodayWidget,
  },
  {
    id: 'system_status',
    labelKey: 'home.widget_system_status',
    span: 'wide',
    defaultVisible: true,
    Component: SystemStatusWidget,
  },
  {
    id: 'recent_chats',
    labelKey: 'home.widget_recent_chats',
    span: 'wide',
    defaultVisible: true,
    Component: RecentChatsWidget,
  },
  {
    id: 'tasks_active',
    labelKey: 'home.widget_tasks_active',
    span: 'wide',
    defaultVisible: false,
    Component: TasksActiveWidget,
  },
  {
    id: 'recent_workflows',
    labelKey: 'home.widget_recent_workflows',
    span: 'wide',
    defaultVisible: false,
    Component: RecentWorkflowsWidget,
  },
  {
    id: 'pack_home_views',
    labelKey: 'home.widget_pack_views',
    span: 'wide',
    defaultVisible: true,
    Component: PackHomeWidgetsList,
  },
  {
    id: 'quick_actions',
    labelKey: 'home.widget_quick_actions',
    span: 'sidebar',
    defaultVisible: true,
    Component: QuickActionsWidget,
  },
];

export function widgetById(id: string): HomeWidgetSpec | undefined {
  return HOME_WIDGETS.find((w) => w.id === id);
}
