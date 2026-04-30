import { useEffect, useMemo, useState } from 'react';
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

export interface DashboardData {
  gateway: 'online' | 'offline' | 'unknown';
  hermes: HermesDetection | null;
  todayMessages: number;
  todayTokens: number;
  totalSessions: number;
  recentSessionIds: string[];
  activeCronJobs: SchedulerJob[];
  mcpServers: McpServer[];
  loading: boolean;
}

export function useDashboard() {
  const gateway = useAppStatusStore((s) => s.gateway);
  const sessions = useChatStore((s) => s.sessions);
  const orderedIds = useChatStore((s) => s.orderedIds);

  const [hermes, setHermes] = useState<HermesDetection | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsSummaryDto | null>(null);
  const [cronJobs, setCronJobs] = useState<SchedulerJob[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetch() {
      setLoading(true);
      const results = await Promise.allSettled([
        hermesDetect(),
        analyticsSummary(),
        schedulerListJobs(),
        mcpServerList(),
      ]);

      if (cancelled) return;

      if (results[0].status === 'fulfilled') setHermes(results[0].value);
      if (results[1].status === 'fulfilled') setAnalytics(results[1].value as AnalyticsSummaryDto);
      if (results[2].status === 'fulfilled') setCronJobs(results[2].value);
      if (results[3].status === 'fulfilled') setMcpServers(results[3].value);

      setLoading(false);
    }

    void fetch();
    return () => { cancelled = true; };
  }, []);

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
