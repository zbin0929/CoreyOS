import { useEffect, useRef, useState } from 'react';
import {
  hermesDetect,
  schedulerListJobs,
  mcpServerList,
  skillList,
  type HermesDetection,
  type SchedulerJob,
  type McpServer,
  type SkillSummary,
} from '@/lib/ipc';

interface SystemStatsCache {
  hermes: HermesDetection | null;
  cronJobs: SchedulerJob[];
  mcpServers: McpServer[];
  skills: SkillSummary[];
  fetchedAt: number;
}

const CACHE_TTL = 60_000;

const cache: SystemStatsCache = {
  hermes: null,
  cronJobs: [],
  mcpServers: [],
  skills: [],
  fetchedAt: 0,
};

let inflight: Promise<void> | null = null;

async function refreshCache() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const results = await Promise.allSettled([
        hermesDetect(),
        schedulerListJobs(),
        mcpServerList(),
        skillList(),
      ]);
      if (results[0].status === 'fulfilled') cache.hermes = results[0].value;
      if (results[1].status === 'fulfilled') cache.cronJobs = results[1].value;
      if (results[2].status === 'fulfilled') cache.mcpServers = results[2].value;
      if (results[3].status === 'fulfilled') cache.skills = results[3].value;
      cache.fetchedAt = Date.now();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useSystemStats() {
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

  return {
    hermesVersion: cache.hermes?.version_parsed?.join('.') ?? null,
    mcpCount: cache.mcpServers.length,
    cronCount: cache.cronJobs.filter((j) => j.enabled).length,
    skillCount: cache.skills.length,
  };
}
