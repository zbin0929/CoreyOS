import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';
import {
  Wand2,
  Terminal,
  Clock,
} from 'lucide-react';
import { AppShell } from '@/app/shell/AppShell';
import { HomeRoute } from '@/features/home';
import { ChatRoute } from '@/features/chat';
import { CompareRoute } from '@/features/compare';
import { ModelsRoute } from '@/features/models';
import { SettingsRoute } from '@/features/settings';
import { AnalyticsRoute } from '@/features/analytics';
import { LogsRoute } from '@/features/logs';
import { ProfilesRoute } from '@/features/profiles';
import { ChannelsRoute } from '@/features/channels';
import { RunbooksRoute } from '@/features/runbooks';
import { BudgetsRoute } from '@/features/budgets';
import { TrajectoryRoute } from '@/features/trajectory';
import { Placeholder } from '@/features/_lib/Placeholder';

const rootRoute = createRootRoute({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomeRoute,
});

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat',
  component: ChatRoute,
});

const compareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/compare',
  component: CompareRoute,
});

const skillsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/skills',
  component: () => (
    <Placeholder
      titleKey="nav.skills"
      emptyTitleKey="empty.skills.title"
      emptyDescKey="empty.skills.desc"
      icon={Wand2}
      phase={4}
    />
  ),
});

const trajectoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/trajectory',
  component: TrajectoryRoute,
});

const analyticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/analytics',
  component: AnalyticsRoute,
});

const logsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/logs',
  component: LogsRoute,
});

const terminalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/terminal',
  component: () => (
    <Placeholder
      titleKey="nav.terminal"
      emptyTitleKey="empty.terminal.title"
      emptyDescKey="empty.terminal.desc"
      icon={Terminal}
      phase={4}
    />
  ),
});

const schedulerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/scheduler',
  component: () => (
    <Placeholder
      titleKey="nav.scheduler"
      emptyTitleKey="empty.scheduler.title"
      emptyDescKey="empty.scheduler.desc"
      icon={Clock}
      phase={2}
    />
  ),
});

const channelsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/channels',
  component: ChannelsRoute,
});

const modelsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/models',
  component: ModelsRoute,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsRoute,
});

const profilesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profiles',
  component: ProfilesRoute,
});

const runbooksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/runbooks',
  component: RunbooksRoute,
});

const budgetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/budgets',
  component: BudgetsRoute,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  chatRoute,
  compareRoute,
  skillsRoute,
  trajectoryRoute,
  analyticsRoute,
  logsRoute,
  terminalRoute,
  schedulerRoute,
  channelsRoute,
  modelsRoute,
  profilesRoute,
  runbooksRoute,
  budgetsRoute,
  settingsRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
