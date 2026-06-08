// ─── Board Interfaces ───

export interface Task {
  id: string;
  fullId: string;
  title: string;
  status: 'draft' | 'ready-to-build' | 'building' | 'paused' | 'failed' | 'done';
}

export interface Story {
  id: string;
  name: string;
  file: string;
  status: string;
  progressPercent: number;
  tasks: Task[];
}

export interface FeatureEpic {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'ready-to-build' | 'building' | 'paused' | 'failed' | 'done';
  progressPercent: number;
  stories: Story[];
}

export interface AppRollupData {
  id: string;
  name: string;
  description: string;
  brd: string;
  version: string;
  status: string;
  stack: {
    framework: string;
    packageManager?: string;
    language?: string;
    linter?: string;
    testing?: string;
    database?: string;
    cloud?: string;
  };
  progressPercent: number;
  features: FeatureEpic[];
}

export interface PhysicalStory {
  file: string;
  kind?: 'AppStory' | 'FeatureStory';
  valid: boolean;
  status: string;
  metadata?: {
    name?: string;
    slug?: string;
    description?: string;
    icon?: string;
    color?: string;
    group?: string;
  };
  deployment?: {
    port?: number;
    region?: string;
    customDomain?: string;
  };
  database?: {
    firestoreId?: string;
    collections?: string[];
  };
  api?: {
    resources?: Array<{ name: string }>;
  };
  feature?: {
    name?: string;
    description?: string;
  };
  target?: {
    app?: string;
  };
  pages?: any[];
  model?: {
    collection?: string;
  };
  phase?: number;
  dependsOn?: string[];
}

export interface QueueItem {
  id: string;
  specFile?: string;
  storyFile?: string;
  kind: string;
  status: string;
  priority: number;
  engine?: string;
  addedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  output: string;
  error: string | null;
  durationMs: number | null;
}

export interface QueueStats {
  'draft': number;
  'ready-to-build': number;
  'building': number;
  'paused': number;
  'failed': number;
  'done': number;
  total: number;
}

export interface ActivityStep {
  id: string;
  label: string;
  status: 'success' | 'error' | 'running' | 'info' | 'warning';
  icon: any;
  details: string[];
  substeps: { text: string; status: 'success' | 'error' | 'info' | 'warning' }[];
}

export interface NotionBoardProps {
  initialView?: 'board' | 'list' | 'queue';
  onNavigateToBuild?: () => void;
  /** Increment this key whenever the active project changes to force a full data reset. */
  projectRefreshKey?: number;
  /** Callback to switch to the Ask TPM chat tab */
  onOpenStoryChat?: () => void;
  className?: string;
}

export interface EpicColor {
  border: string;
  badge: string;
}

export interface KanbanColumnProps {
  title: string;
  description: string;
  badgeColor: string;
  stories: any[];
  epicColorMap: Map<string, EpicColor>;
  onSelect: (item: any, type: 'task' | 'story', parentStory?: any, parentFeature?: any) => void;
  onValidate: (file: string, kind: string) => void;
  onBuild: (file: string, kind: string) => void;
  activeAction: { type: string; file: string } | null;
  allStories?: any[];
  /** When false, show a scaffold-first banner in the Ready to Build column */
  bootstrapped?: boolean;
  scaffoldStoryFile?: string | null;
}

export interface ListStoryRowProps {
  item: any;
  expanded: boolean;
  onToggleExpand: () => void;
  onSelect: (item: any, type: 'task' | 'story', parentStory?: any, parentFeature?: any) => void;
  onValidate: (file: string, kind: string) => void;
  onBuild: (file: string, kind: string) => void;
  onToggleTask: (taskId: string, nextStatus: Task['status']) => void;
  updatingTaskId: string | null;
  activeAction: { type: string; file: string } | null;
  allStories?: any[];
  bootstrapped?: boolean;
}
