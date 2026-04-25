import { lazy, Suspense, type ComponentType } from 'react';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';
import { AppShell } from '@/app/shell/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { RouteFallback } from '@/app/shell/RouteFallback';
import { HomeRoute } from '@/features/home';
import { ChatRoute } from '@/features/chat';

// T4.2b follow-up — code-split the leaf feature routes. `Home` and
// `Chat` stay eager because they're the primary entry points (Home on
// cold boot, Chat right after). Everything else loads only when the
// user navigates to it, shaving ~1MB off the initial bundle and
// preventing heavy deps (CodeMirror 6 in Skills, xterm.js in Terminal,
// the analytics chart code) from blocking first paint.
//
// Each feature module exports a named component (e.g. `SkillsRoute`);
// `lazyFeature` adapts that to the default-export shape React.lazy
// expects so we don't have to touch every feature module.
function lazyFeature<T extends string>(
  loader: () => Promise<Record<T, ComponentType<unknown>>>,
  exportName: T,
) {
  return lazy(async () => {
    const mod = await loader();
    return { default: mod[exportName] };
  });
}

const CompareRoute = lazyFeature(() => import('@/features/compare'), 'CompareRoute');
const ModelsRoute = lazyFeature(() => import('@/features/models'), 'ModelsRoute');
const AgentsRoute = lazyFeature(() => import('@/features/agents'), 'AgentsRoute');
const SettingsRoute = lazyFeature(() => import('@/features/settings'), 'SettingsRoute');
const AnalyticsRoute = lazyFeature(() => import('@/features/analytics'), 'AnalyticsRoute');
const LogsRoute = lazyFeature(() => import('@/features/logs'), 'LogsRoute');
const ProfilesRoute = lazyFeature(() => import('@/features/profiles'), 'ProfilesRoute');
const ChannelsRoute = lazyFeature(() => import('@/features/channels'), 'ChannelsRoute');
const RunbooksRoute = lazyFeature(() => import('@/features/runbooks'), 'RunbooksRoute');
const BudgetsRoute = lazyFeature(() => import('@/features/budgets'), 'BudgetsRoute');
const TrajectoryRoute = lazyFeature(() => import('@/features/trajectory'), 'TrajectoryRoute');
const TerminalRoute = lazyFeature(() => import('@/features/terminal'), 'TerminalRoute');
const SkillsRoute = lazyFeature(() => import('@/features/skills'), 'SkillsRoute');
const SchedulerRoute = lazyFeature(() => import('@/features/scheduler'), 'SchedulerRoute');
const MemoryRoute = lazyFeature(() => import('@/features/memory'), 'MemoryRoute');
const KnowledgeRoute = lazyFeature(() => import('@/features/knowledge'), 'KnowledgeRoute');
const McpRoute = lazyFeature(() => import('@/features/mcp'), 'McpRoute');

const rootRoute = createRootRoute({
  component: () => (
    <AppShell>
      <ErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Outlet />
        </Suspense>
      </ErrorBoundary>
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
  component: SkillsRoute,
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
  component: TerminalRoute,
});

const schedulerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/scheduler',
  component: () => (
    <Suspense fallback={<RouteFallback />}>
      <SchedulerRoute />
    </Suspense>
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

const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agents',
  component: AgentsRoute,
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

const memoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/memory',
  component: MemoryRoute,
});

const knowledgeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/knowledge',
  component: KnowledgeRoute,
});

const mcpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/mcp',
  component: McpRoute,
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
  agentsRoute,
  profilesRoute,
  runbooksRoute,
  budgetsRoute,
  memoryRoute,
  knowledgeRoute,
  mcpRoute,
  settingsRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
