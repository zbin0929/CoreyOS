import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';
import {
  Columns3,
  Wand2,
  GitBranch,
  BarChart3,
  ScrollText,
  Terminal,
  Clock,
  Radio,
  Boxes,
} from 'lucide-react';
import { AppShell } from '@/app/shell/AppShell';
import { HomeRoute } from '@/features/home';
import { ChatRoute } from '@/features/chat';
import { SettingsRoute } from '@/features/settings';
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
  component: () => (
    <Placeholder
      titleKey="nav.compare"
      emptyTitleKey="empty.compare.title"
      emptyDescKey="empty.compare.desc"
      icon={Columns3}
      phase={4}
    />
  ),
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
  component: () => (
    <Placeholder
      titleKey="nav.trajectory"
      emptyTitleKey="empty.trajectory.title"
      emptyDescKey="empty.trajectory.desc"
      icon={GitBranch}
      phase={4}
    />
  ),
});

const analyticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/analytics',
  component: () => (
    <Placeholder
      titleKey="nav.analytics"
      emptyTitleKey="empty.analytics.title"
      emptyDescKey="empty.analytics.desc"
      icon={BarChart3}
      phase={2}
    />
  ),
});

const logsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/logs',
  component: () => (
    <Placeholder
      titleKey="nav.logs"
      emptyTitleKey="empty.logs.title"
      emptyDescKey="empty.logs.desc"
      icon={ScrollText}
      phase={2}
    />
  ),
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
  component: () => (
    <Placeholder
      titleKey="nav.channels"
      emptyTitleKey="empty.channels.title"
      emptyDescKey="empty.channels.desc"
      icon={Radio}
      phase={3}
    />
  ),
});

const modelsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/models',
  component: () => (
    <Placeholder
      titleKey="nav.models"
      emptyTitleKey="empty.models.title"
      emptyDescKey="empty.models.desc"
      icon={Boxes}
      phase={2}
    />
  ),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsRoute,
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
  settingsRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
