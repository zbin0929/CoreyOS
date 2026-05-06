import { lazy, Suspense, type ComponentType } from 'react';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';

import { DemotedRouteBanner } from '@/components/ui/demoted-route-banner';
import { AppShell } from '@/app/shell/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { RouteFallback } from '@/app/shell/RouteFallback';
import { HomeRoute } from '@/features/home';
import { ChatRoute } from '@/features/chat';
import { selectHiddenRoutes, useCustomerStore } from '@/stores/customer';

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
const VoiceRoute = lazyFeature(() => import('@/features/voice'), 'VoiceRoute');
const McpRoute = lazyFeature(() => import('@/features/mcp'), 'McpRoute');
const WorkflowRoute = lazyFeature(() => import('@/features/workflow'), 'WorkflowRoute');
const HelpRoute = lazyFeature(() => import('@/features/help'), 'HelpRoute');
const PackRoute = lazyFeature(() => import('@/features/pack'), 'PackRoute');
const TasksRoute = lazyFeature(() => import('@/features/tasks'), 'TasksRoute');

/**
 * Wrap a route component so it renders the
 * [`DemotedRouteBanner`] at the top. Used for the 5 paths pulled
 * from the sidebar in the 2026-05-06 audit (`DEMOTED_ROUTES` in
 * `nav-config.ts`). Keeps each feature page itself untouched — the
 * banner lives outside the feature's own scroll container.
 */
function withDemotedBanner(Inner: ComponentType<unknown>) {
  return () => (
    <div className="flex h-full min-h-0 flex-col">
      <DemotedRouteBanner />
      <div className="flex min-h-0 flex-1 flex-col">
        <Inner />
      </div>
    </div>
  );
}

const PATH_TO_NAV_ID: Record<string, string> = {
  '/': 'home',
  '/chat': 'chat',
  '/workflows': 'workflows',
  '/models': 'models',
  '/agents': 'agents',
  '/compare': 'compare',
  '/analytics': 'analytics',
  '/terminal': 'terminal',
  '/logs': 'logs',
  '/skills': 'skills',
  '/trajectory': 'trajectory',
  '/channels': 'channels',
  '/scheduler': 'scheduler',
  '/profiles': 'profiles',
  '/runbooks': 'runbooks',
  '/budgets': 'budgets',
  '/memory': 'memory',
  '/knowledge': 'knowledge',
  '/voice': 'voice',
  '/mcp': 'mcp',
  '/tasks': 'tasks',
  '/settings': 'settings',
  '/help': 'help',
};

const rootRoute = createRootRoute({
  beforeLoad: ({ location }) => {
    const navId = PATH_TO_NAV_ID[location.pathname];
    if (navId) {
      const hidden = selectHiddenRoutes(useCustomerStore.getState().config);
      if (hidden.has(navId)) throw redirect({ to: '/' });
    }
  },
  component: () => (
    <AppShell>
      <ErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <div className="animate-fade-in flex min-h-0 flex-1 flex-col">
            <Outlet />
          </div>
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
      <div className="flex h-full min-h-0 flex-col">
        <DemotedRouteBanner />
        <div className="flex min-h-0 flex-1 flex-col">
          <SchedulerRoute />
        </div>
      </div>
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
  component: withDemotedBanner(AgentsRoute),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsRoute,
});

const profilesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profiles',
  component: withDemotedBanner(ProfilesRoute),
});

const runbooksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/runbooks',
  component: withDemotedBanner(RunbooksRoute),
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

const voiceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/voice',
  component: withDemotedBanner(VoiceRoute),
});

const mcpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/mcp',
  component: McpRoute,
});

const workflowRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workflows',
  component: WorkflowRoute,
});

const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tasks',
  component: TasksRoute,
});

const helpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/help',
  component: HelpRoute,
});

// Dynamic Pack view route — `/pack/<packId>/<viewId>` resolves at
// render time against the live `pack_views_list` IPC. Adding a Pack
// at runtime does NOT need a router rebuild.
const packRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pack/$packId/$viewId',
  component: PackRoute,
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
  voiceRoute,
  mcpRoute,
  workflowRoute,
  tasksRoute,
  helpRoute,
  packRoute,
  settingsRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
