/**
 * Global Factory state store — single source of truth for UI data.
 *
 * Replaces per-component polling with a single coordinated polling loop.
 * Components subscribe to slices instead of fetching independently.
 *
 * Usage:
 *   import { useFactoryStore } from '@/stores/factory-store';
 *   const stories = useFactoryStore(s => s.stories);
 *   const fetchStories = useFactoryStore(s => s.fetchStories);
 */

import { create } from 'zustand';

// ─── Types ───────────────────────────────────────────────

export interface StoryItem {
  file: string;
  valid: boolean;
  status: string;
  metadata: Record<string, any>;
  deployment?: Record<string, any>;
  database?: Record<string, any>;
  api?: Record<string, any>;
  features?: Record<string, any>;
  execution?: DeliveryExecution | null;
}

export interface FeatureStoryItem {
  file: string;
  kind: 'FeatureStory';
  valid: boolean;
  status: string;
  feature: Record<string, any>;
  target: Record<string, any>;
  pages: any[];
  model: Record<string, any>;
  phase?: number;
  dependsOn?: string[];
  execution?: DeliveryExecution | null;
}

export interface DeliveryExecution {
  executor: 'pi-sdk';
  model: string;
  provider: string;
  endpointHost: string;
  branch: string;
  worktree: string;
  baseBranch: string;
  claimedAt: string;
  heartbeatAt: string;
  leaseUntil: string;
  state?: 'claimed' | 'building' | 'review' | 'stale' | 'merged';
  lastEvent?: string;
  changedFiles?: string[];
  prNumber?: number;
  prUrl?: string;
  verification?: {
    status: string;
    summary: string;
    evidence: string[];
    productFilesChanged: boolean;
    userReachable: boolean;
  };
}

export interface QueueItem {
  id: string;
  storyFile: string;
  specFile?: string;
  kind: 'AppStory' | 'FeatureStory';
  status: string;
  priority: number;
  phase: number;
  dependsOn: string[];
  engine: string;
  addedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  output: string;
  error: string | null;
  durationMs: number | null;
  targetApp?: string;
  title?: string;
  execution?: DeliveryExecution | null;
}

export interface ProjectItem {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  stack?: Record<string, string>;
  piConfig?: any;
}

export interface ReportStats {
  totalBuilds: number;
  successfulBuilds: number;
  failedBuilds: number;
  uniqueSpecs: number;
  totalTokensIn: number;
  totalTokensOut: number;
  avgDurationMs: number;
  modelUsage: any[];
  errorBreakdown: any[];
}

// ─── Store Interface ─────────────────────────────────────

interface FactoryStore {
  // ─── Data ────────────────────────────────────
  stories: StoryItem[];
  featureStories: FeatureStoryItem[];
  queueItems: QueueItem[];
  queueRunning: boolean;
  dgxStatus: { state: 'ready' | 'unavailable'; provider?: string; model?: string; endpointHost?: string; latencyMs?: number; error?: string } | null;
  queueCapacity: { maxWorkers: number; activeWorkers: number; unattendedEnabled: boolean; humanMergeRequired: boolean } | null;
  projects: ProjectItem[];
  activeProject: ProjectItem | null;
  activeProjectId: string | null;
  reportEntries: any[];
  reportStats: ReportStats | null;

  // ─── Loading States ──────────────────────────
  storiesLoading: boolean;
  queueLoading: boolean;
  projectsLoading: boolean;
  reportsLoading: boolean;
  initialLoadDone: boolean;

  // ─── Derived ─────────────────────────────────
  queueStatusMap: Record<string, { status: string; id: string }>;
  hasProjects: boolean;
  projectCount: number;

  // ─── Actions ─────────────────────────────────
  fetchStories: () => Promise<void>;
  fetchQueue: () => Promise<void>;
  fetchProjects: () => Promise<void>;
  fetchReports: () => Promise<void>;
  fetchAll: () => Promise<void>;

  // ─── Polling ─────────────────────────────────
  startPolling: (intervalMs?: number) => void;
  stopPolling: () => void;
  _pollTimer: ReturnType<typeof setInterval> | null;
}

// ─── Store ───────────────────────────────────────────────

export const useFactoryStore = create<FactoryStore>((set, get) => ({
  // Data
  stories: [],
  featureStories: [],
  queueItems: [],
  queueRunning: false,
  dgxStatus: null,
  queueCapacity: null,
  projects: [],
  activeProject: null,
  activeProjectId: null,
  reportEntries: [],
  reportStats: null,

  // Loading
  storiesLoading: false,
  queueLoading: false,
  projectsLoading: false,
  reportsLoading: false,
  initialLoadDone: false,

  // Derived (computed on each fetch)
  queueStatusMap: {},
  hasProjects: true,
  projectCount: 0,

  // Polling
  _pollTimer: null,

  // ─── Fetch Actions ─────────────────────────────

  fetchStories: async () => {
    set({ storiesLoading: true });
    try {
      const res = await fetch('/api/stories');
      if (!res.ok) return;
      const data = await res.json();
      set({
        stories: data.stories || [],
        featureStories: data.featureStories || [],
      });
    } catch {
      /* network error — keep stale data */
    } finally {
      set({ storiesLoading: false });
    }
  },

  fetchQueue: async () => {
    set({ queueLoading: true });
    try {
      const res = await fetch('/api/queue');
      if (!res.ok) return;
      const data = await res.json();
      const items: QueueItem[] = data.items || [];
      const map: Record<string, { status: string; id: string }> = {};
      for (const item of items) {
        const file = item.storyFile || item.specFile;
        if (file) {
          map[file] = { status: item.status, id: item.id };
        }
      }
      const running = items.some((i) => i.status === 'running') || data.isRunning || false;
      set({
        queueItems: items,
        queueRunning: running,
        queueStatusMap: map,
        dgxStatus: data.dgx || null,
        queueCapacity: data.capacity || null,
      });
    } catch {
      /* network error — keep stale data */
    } finally {
      set({ queueLoading: false });
    }
  },

  fetchProjects: async () => {
    set({ projectsLoading: true });
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) return;
      const data = await res.json();
      const projects: ProjectItem[] = data.projects || [];
      const active = projects.find((p) => p.id === data.activeId) || null;
      set({
        projects,
        activeProject: active,
        activeProjectId: data.activeId || null,
        hasProjects: projects.length > 0,
        projectCount: projects.length,
      });
    } catch {
      /* network error — keep stale data */
    } finally {
      set({ projectsLoading: false });
    }
  },

  fetchReports: async () => {
    set({ reportsLoading: true });
    try {
      const res = await fetch('/api/reports');
      if (!res.ok) return;
      const data = await res.json();
      set({
        reportEntries: data.entries || [],
        reportStats: data.stats || null,
      });
    } catch {
      /* network error — keep stale data */
    } finally {
      set({ reportsLoading: false });
    }
  },

  fetchAll: async () => {
    const { fetchStories, fetchQueue, fetchProjects, fetchReports } = get();
    await Promise.all([fetchStories(), fetchQueue(), fetchProjects(), fetchReports()]);
    set({ initialLoadDone: true });
  },

  // ─── Polling ─────────────────────────────────

  startPolling: (intervalMs = 5000) => {
    const existing = get()._pollTimer;
    if (existing) clearInterval(existing);

    // Immediate fetch
    get().fetchAll();

    const timer = setInterval(() => {
      // Only poll queue frequently when running; stories/reports less often
      get().fetchQueue();
      // Stories + reports every 3rd tick (15s default)
      if (Math.random() < 0.33) {
        get().fetchStories();
        get().fetchReports();
      }
    }, intervalMs);

    set({ _pollTimer: timer });
  },

  stopPolling: () => {
    const timer = get()._pollTimer;
    if (timer) {
      clearInterval(timer);
      set({ _pollTimer: null });
    }
  },
}));
