import { useEffect, useMemo, useRef, useState } from 'react';
import {
  hermesDetect,
  schedulerListJobs,
  mcpServerList,
  analyticsSummary,
  type HermesDetection,
  type SchedulerJob,
  type McpServer,
  type AnalyticsSummaryDto,
} from '@/lib/ipc';
import { useAppStatusStore } from '@/stores/appStatus';
import { useChatStore } from '@/stores/chat';

interface DashboardCache {
  hermes: HermesDetection | null;
  analytics: AnalyticsSummaryDto | null;
  cronJobs: SchedulerJob[];
  mcpServers: McpServer[];
  fetchedAt: number;
}

const CACHE_TTL = 30_000;

const cache: DashboardCache = {
  hermes: null,
  analytics: null,
  cronJobs: [],
  mcpServers: [],
  fetchedAt: 0,
};

let inflight: Promise<void> | null = null;

async function refreshCache() {
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const results = await Promise.allSettled([
        hermesDetect(),
        analyticsSummary(),
        schedulerListJobs(),
        mcpServerList(),
      ]);

      if (results[0].status === 'fulfilled') cache.hermes = results[0].value;
      if (results[1].status === 'fulfilled') cache.analytics = results[1].value as AnalyticsSummaryDto;
      if (results[2].status === 'fulfilled') cache.cronJobs = results[2].value;
      if (results[3].status === 'fulfilled') cache.mcpServers = results[3].value;
      cache.fetchedAt = Date.now();
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function useDashboard() {
  const gateway = useAppStatusStore((s) => s.gateway);
  const sessions = useChatStore((s) => s.sessions);
  const orderedIds = useChatStore((s) => s.orderedIds);

  const [, setTick] = useState(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;

    const stale = Date.now() - cache.fetchedAt > CACHE_TTL;
    const has = cache.fetchedAt > 0;

    if (stale || !has) {
      void refreshCache().then(() => {
        if (mounted.current) setTick((n) => n + 1);
      });
    }

    return () => { mounted.current = false; };
  }, []);

  const hermes = cache.hermes;
  const analytics = cache.analytics;
  const cronJobs = cache.cronJobs;
  const mcpServers = cache.mcpServers;

  const recentSessionIds = useMemo(
    () => orderedIds.slice(0, 5),
    [orderedIds],
  );

  const activeCronJobs = useMemo(
    () => cronJobs.filter((j) => j.enabled),
    [cronJobs],
  );

  const todayStr = new Date().toISOString().slice(0, 10);

  const todayMessages = useMemo(() => {
    if (!analytics) return 0;
    return analytics.messages_per_day.find((d: { date: string; count: number }) => d.date === todayStr)?.count ?? 0;
  }, [analytics, todayStr]);

  const todayTokens = useMemo(() => {
    if (!analytics) return 0;
    return analytics.tokens_per_day.find((d: { date: string; count: number }) => d.date === todayStr)?.count ?? 0;
  }, [analytics, todayStr]);

  const totalSessions = analytics?.totals.sessions ?? Object.keys(sessions).length;

  const loading = cache.fetchedAt === 0;

  return {
    gateway,
    hermes,
    todayMessages,
    todayTokens,
    totalSessions,
    recentSessionIds,
    recentSessions: recentSessionIds.map((id) => sessions[id]).filter((s): s is NonNullable<typeof s> => Boolean(s)),
    activeCronJobs,
    mcpServers,
    loading,
  };
}
