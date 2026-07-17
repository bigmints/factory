/**
 * Zod schemas for Factory engine types.
 *
 * These schemas mirror the TypeScript interfaces in types.ts.
 * The interfaces in types.ts remain the source of truth for TypeScript types;
 * these schemas are used for runtime validation of external data (YAML/JSON).
 */

import { z } from 'zod/v4';

// ─── Stack ───────────────────────────────────────────────

export const StackConfigSchema = z.object({
    framework: z.string().min(1, 'stack.framework is required'),
    packageManager: z.string().optional(),
    language: z.string().optional(),
    linter: z.string().optional(),
    testing: z.string().optional(),
    database: z.string().optional(),
    cloud: z.string().optional(),
});

export type StackConfigZ = z.infer<typeof StackConfigSchema>;

// ─── Sub-schemas for AppStory ────────────────────────────

const FrontendConfigSchema = z.object({
    ui: z.string().optional(),
    theme: z.string().optional(),
    icons: z.string().optional(),
    fonts: z.array(z.string()).optional(),
});

const LayoutConfigSchema = z.object({
    sidebar: z.boolean().optional(),
    topbar: z.boolean().optional(),
    bottombar: z.boolean().optional(),
    footer: z.boolean().optional(),
});

const AuthConfigSchema = z.object({
    provider: z.string().optional(),
    methods: z.object({
        email: z.boolean().optional(),
        google: z.boolean().optional(),
        github: z.boolean().optional(),
        apple: z.boolean().optional(),
        phone: z.boolean().optional(),
    }).optional(),
    pages: z.object({
        login: z.boolean().optional(),
        signup: z.boolean().optional(),
        forgotPassword: z.boolean().optional(),
    }).optional(),
});

const FieldDefinitionSchema = z.object({
    type: z.string(),
    required: z.boolean().optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    description: z.string().optional(),
});

const TableDefinitionSchema = z.object({
    name: z.string().min(1, 'Each data table must have a name'),
    fields: z.record(z.string(), FieldDefinitionSchema).refine(
        (fields) => Object.keys(fields).length > 0,
        { message: 'Table must have at least one field' },
    ),
});

const DataConfigSchema = z.object({
    tables: z.array(TableDefinitionSchema).optional(),
});

const PagesConfigSchema = z.object({
    dashboard: z.array(z.string()).optional(),
    crud: z.array(z.object({ table: z.string() })).optional(),
    custom: z.array(z.string()).optional(),
});

const DeploymentConfigSchema = z.object({
    port: z.number().int().min(1024, 'Port must be >= 1024').max(65535, 'Port must be <= 65535').optional(),
    region: z.string().optional(),
});

const BuildMetaSchema = z.object({
    lastBuiltAt: z.union([z.string(), z.date()]).transform(d => typeof d === 'string' ? d : d.toISOString()),
    buildCount: z.number(),
    outputDir: z.string(),
    commitHash: z.string().optional(),
    filesGenerated: z.number(),
    iterations: z.number(),
    taskType: z.string(),
});

const StoryExecutionSchema = z.object({
    executor: z.literal('pi-sdk'),
    model: z.string().min(1),
    provider: z.string().min(1),
    endpointHost: z.string().min(1),
    branch: z.string().min(1),
    worktree: z.string().min(1),
    baseBranch: z.string().min(1),
    claimedAt: z.string().min(1),
    heartbeatAt: z.string().min(1),
    leaseUntil: z.string().min(1),
    prNumber: z.number().int().positive().optional(),
    prUrl: z.string().url().optional(),
    state: z.enum(['claimed', 'building', 'review', 'stale', 'merged']).optional(),
    lastEvent: z.string().optional(),
    lastReconciledAt: z.string().optional(),
    changedFiles: z.array(z.string()).optional(),
    verification: z.object({
        status: z.enum(['verified', 'review', 'failed']),
        summary: z.string(),
        evidence: z.array(z.string()),
        productFilesChanged: z.boolean(),
        userReachable: z.boolean(),
    }).optional(),
});

export const LIFECYCLE_STATUSES = ['draft', 'queued', 'running', 'review', 'failed', 'done'] as const;
export type CanonicalLifecycleStatus = typeof LIFECYCLE_STATUSES[number];

export function isLifecycleStatus(value: unknown): value is CanonicalLifecycleStatus {
    return typeof value === 'string' && LIFECYCLE_STATUSES.includes(value as CanonicalLifecycleStatus);
}

export function readLifecycleStatus(
    value: unknown,
    fallback: CanonicalLifecycleStatus = 'draft',
): CanonicalLifecycleStatus {
    return isLifecycleStatus(value) ? value : fallback;
}

export const LifecycleStatusSchema = z.enum(LIFECYCLE_STATUSES);

// ─── Story ────────────────────────────────────────────

export const StorySchema = z.object({
    name: z.string().min(1, 'name is required'),
    kind: z.enum(['app', 'feature']),
    description: z.string().optional(),
    
    // Feature fields
    target: z.string().optional(),
    phase: z.number().int().min(1).max(10).optional(),
    dependsOn: z.array(
        z.string().regex(/^[a-z][a-z0-9-]*$/, 'Dependency slug must be lowercase alphanumeric with hyphens'),
    ).optional(),
    
    // Config fields
    stack: StackConfigSchema.optional(),
    frontend: FrontendConfigSchema.optional(),
    layout: LayoutConfigSchema.optional(),
    auth: AuthConfigSchema.optional(),
    data: DataConfigSchema.optional(),
    pages: z.union([
        PagesConfigSchema,
        z.array(z.object({
            slug: z.string(),
            type: z.string(),
            title: z.string(),
        }))
    ]).optional(),
    deployment: DeploymentConfigSchema.optional(),
    dependencies: z.array(z.string()).optional(),
    model: z.object({
        collection: z.string(),
        fields: z.array(z.object({
            name: z.string(),
            type: z.string(),
            required: z.boolean().optional(),
            default: z.union([z.string(), z.number(), z.boolean()]).optional(),
        })),
    }).optional(),

    status: LifecycleStatusSchema.optional(),
    engine: z.enum(['factory', 'worker']).optional(),
    build: BuildMetaSchema.optional(),
    threadId: z.string().optional(),
    btw: z.array(z.string()).optional(),
    execution: StoryExecutionSchema.optional(),
    validation: z.object({ command: z.string().min(1) }).optional(),
});

export type StoryZ = z.infer<typeof StorySchema>;

// ─── BridgeConfig (.factory/factory.yaml) ────────────────

const ProjectStackSchema = z.object({
    framework: z.string(),
    packageManager: z.string(),
    linter: z.string().optional(),
    testing: z.string().optional(),
    database: z.string().optional(),
    cloud: z.string().optional(),
});

const SkillsConfigSchema = z.object({
    discovery: z.enum(['auto', 'manual']).optional(),
    files: z.array(z.string()).optional(),
});

export const BridgeConfigSchema = z.object({
    version: z.number({ message: 'version is required' }),
    name: z.string().min(1, 'name is required'),
    description: z.string().min(1, 'description is required'),
    namespace: z.string().optional(),
    projectId: z.string().optional(),
    factory_home: z.string().optional(),
    stack: ProjectStackSchema.optional(),
    registry: z.object({ apps: z.string().optional() }).optional(),
    conventions: z.object({ rules: z.string().optional(), agents: z.string().optional() }).optional(),
    skills: SkillsConfigSchema.optional(),
    templates: z.object({ starter: z.string().optional() }).optional(),
    apps_dir: z.string().optional(),
    project: z.object({
        bootstrapped: z.boolean().optional(),
    }).optional(),
    delivery: z.object({
        mode: z.literal('pull-request').optional(),
        executor: z.literal('pi-sdk').optional(),
        localModelsOnly: z.boolean().optional(),
        requireHumanMerge: z.literal(true).optional(),
        maxWorkers: z.number().int().min(1).max(1).optional(),
        leaseMinutes: z.number().int().min(1).optional(),
        unattended: z.object({
            enabled: z.boolean(),
            maxRuntimeMinutes: z.number().int().min(1),
            maxToolCalls: z.number().int().min(1),
            maxChangedFiles: z.number().int().min(1),
            maxChangedLines: z.number().int().min(1),
        }).optional(),
    }).optional(),
    agentic: z.object({
        logs_dir: z.string().optional(),
        blueprint_dir: z.string().optional(),
        context_dir: z.string().optional(),
        task_queue: z.string().optional(),
        skill_index: z.string().optional(),
        workflows_dir: z.string().optional(),
        knowledge_dir: z.string().optional(),
    }).optional(),
});

export type BridgeConfigZ = z.infer<typeof BridgeConfigSchema>;

// ─── QueueItem ───────────────────────────────────────────

export const QueueItemSchema = z.object({
    id: z.string().min(1, 'id is required'),
    storyFile: z.string().min(1, 'storyFile is required'),
    kind: z.enum(['app', 'feature']),
    status: LifecycleStatusSchema,
    priority: z.number(),
    phase: z.number(),
    dependsOn: z.array(z.string()),
    engine: z.enum(['factory', 'worker']),
    addedAt: z.string(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    output: z.string(),
    error: z.string().nullable(),
    errorCategory: z.enum(['transient', 'permanent']).nullable(),
    durationMs: z.number().nullable(),
    targetApp: z.string().optional(),
    threadId: z.string().optional(),
});

export type QueueItemZ = z.infer<typeof QueueItemSchema>;
