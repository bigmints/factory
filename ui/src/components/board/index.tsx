// ─── Board Module Barrel Export ───
// Re-exports the main NotionBoard component and all board sub-modules.

export { NotionBoard } from '../notion-board';

// Types
export type {
  Task,
  Story,
  FeatureEpic,
  AppRollupData,
  PhysicalStory,
  QueueItem,
  QueueStats,
  ActivityStep,
  NotionBoardProps,
  EpicColor,
  KanbanColumnProps,
  ListStoryRowProps,
} from './types';

// Constants
export {
  storyStatusMap,
  epicStatusMap,
  EPIC_COLORS,
  taskStatusMap,
  STATUS_SORT_ORDER,
} from './constants';

// Utilities
export {
  getStepIcon,
  parseActivities,
  getBasename,
  getSlug,
  getStorySlugs,
  getRelatedStories,
  getEffectiveStatus,
  topoSort,
  resolveDependencyChain,
} from './utils';

// Components
export { YamlViewer } from './yaml-viewer';
export { StoryKanbanCard } from './story-kanban-card';
export { KanbanColumn } from './kanban-column';
export { ListStoryRow } from './list-story-row';
export { MobileKanbanBoard } from './mobile-kanban-board';
export { FlatTaskList } from './flat-task-list';
