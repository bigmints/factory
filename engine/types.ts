/**
 * Shared types for the Factory engine.
 *
 * Every type lives here — no local duplicates anywhere.
 */

// ─── Story Types ──────────────────────────────────────────

/** Top-level app story (parsed from YAML in .factory/stories/apps/) */
export interface AppStory {
    appName: string;
    description: string;
    stack: StackConfig;
    frontend?: FrontendConfig;
    layout?: LayoutConfig;
    auth?: AuthConfig;
    data?: DataConfig;
    pages?: PagesConfig;
    deployment?: DeploymentConfig;
    dependencies?: string[];       // npm packages this app requires (e.g. ['express', 'dotenv'])
    status?: StoryStatus;
    engine?: 'factory' | 'worker';
    build?: BuildMeta;
}

/** Build metadata written back into the story after a successful build */
export interface BuildMeta {
    lastBuiltAt: string;       // ISO timestamp
    buildCount: number;        // incremented each build
    outputDir: string;         // where files were written
    commitHash?: string;       // git commit hash if available
    filesGenerated: number;    // count of files
    iterations: number;        // how many LLM iterations
    taskType: string;          // from the task classifier
}

export interface StackConfig {
    framework: string;
    packageManager?: string;
    language?: string;
    linter?: string;
    testing?: string;
    database?: string;
    cloud?: string;
}

export interface FrontendConfig {
    ui?: string;
    theme?: string;
    icons?: string;
    fonts?: string[];
}

export interface LayoutConfig {
    sidebar?: boolean;
    topbar?: boolean;
    bottombar?: boolean;
    footer?: boolean;
}

export interface AuthConfig {
    provider?: string;
    methods?: {
        email?: boolean;
        google?: boolean;
        github?: boolean;
        apple?: boolean;
        phone?: boolean;
    };
    pages?: {
        login?: boolean;
        signup?: boolean;
        forgotPassword?: boolean;
    };
}

export interface DataConfig {
    tables?: TableDefinition[];
}

export interface TableDefinition {
    name: string;
    fields: Record<string, FieldDefinition>;
}

export interface FieldDefinition {
    type: string;
    required?: boolean;
    default?: string | number | boolean;
    description?: string;
}

export interface PagesConfig {
    dashboard?: string[];
    crud?: Array<{ table: string }>;
    custom?: string[];
}

export interface DeploymentConfig {
    port?: number;
    region?: string;
}

export type StoryStatus = 'draft' | 'ready' | 'in-progress' | 'validation' | 'review' | 'done';

/** Blueprint about an existing app that feature builds need for integration */
export interface AppIntegrationBlueprint {
    /** Parsed package.json — deps already installed */
    packageJson?: {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        scripts?: Record<string, string>;
    };
    /** Raw tsconfig.json content */
    tsconfigRaw?: string;
    /** Flat list of existing file paths in the app */
    fileTree: string[];
    /** Stack derived from the actual app */
    stack?: StackConfig;
}

// ─── Feature Story ────────────────────────────────────────

export interface FeatureStory {
    feature: {
        name: string;
        slug: string;
    };
    target: {
        app: string;
    };
    phase?: number;              // 1 = foundation, 2 = core, 3 = polish
    dependsOn?: string[];        // slugs of other feature stories that must complete first
    dependencies?: string[];     // npm packages this feature requires (e.g. ['puppeteer', 'nodemailer'])
    model?: {
        collection: string;
        fields: Array<{
            name: string;
            type: string;
            required?: boolean;
            default?: string | number | boolean;
        }>;
    };
    pages?: Array<{
        slug: string;
        type: string;
        title: string;
    }>;
    engine?: 'factory' | 'worker';
}

// ─── Bridge Config (.factory/factory.yaml) ───────────────

export interface BridgeConfig {
    version: number;
    name: string;
    description: string;
    namespace?: string;
    projectId?: string;
    /** Relative path to the Factory project root (for self-referential bridges) */
    factory_home?: string;
    stack?: ProjectStack;
    registry?: { apps?: string };
    conventions?: { rules?: string; agents?: string };
    skills?: SkillsConfig;
    templates?: { starter?: string };
    apps_dir?: string;
    /** Agentic configuration — paths to logs, tasks, skills, workflows, knowledge */
    agentic?: {
        logs_dir?: string;
        blueprint_dir?: string;  // legacy: was .factory/blueprint
        context_dir?: string;    // legacy: was .factory/context
        task_queue?: string;
        skill_index?: string;
        workflows_dir?: string;
        knowledge_dir?: string;
    };
}

export interface SkillsConfig {
    discovery?: 'auto' | 'manual';
    files?: string[];
}

export interface ProjectStack {
    framework: string;
    packageManager: string;
    linter?: string;
    testing?: string;
    database?: string;
    cloud?: string;
}

// ─── Project Management ──────────────────────────────────

export interface Project {
    id: string;
    name: string;
    path: string;
    addedAt: string;
    stack?: ProjectStack;
}

export interface ProjectsConfig {
    activeProject: string | null;
    projects: Project[];
}

// ─── LLM Settings ────────────────────────────────────────

export interface ModelConfig {
    id: string;
    name: string;
}

export interface LLMProvider {
    id: string;
    name: string;
    /**
     * 'builtin'      — Factory calls the provider API directly (Gemini, OpenAI, Ollama)
     * 'openai-compat' — OpenAI-compatible API at a custom baseUrl
     * 'cli'          — Delegates to an installed CLI tool (gemini, claude, pi, agy)
     */
    kind: 'builtin' | 'openai-compat' | 'cli';
    enabled: boolean;
    apiKey?: string;
    baseUrl?: string;
    models: ModelConfig[];
    defaultModel?: string;
}

export interface FactorySettings {
    providers: LLMProvider[];
    activeProvider: string;
    buildModel: string;
    updatedAt?: string;
    defaultCli?: 'pi' | 'gemini' | 'claude' | 'agy';
}

// ─── Build Pipeline ──────────────────────────────────────

export interface GeneratedFile {
    filename: string;
    content: string;
}

export interface BuildPlan {
    files: string[];
    architecture: string;
    decisions: string[];
}

export interface BuildResult {
    success: boolean;
    files: GeneratedFile[];
    plan: BuildPlan;
    iterations: number;
    errors?: string[];
    /** Token usage accumulated across all LLM calls in this build */
    tokenUsage?: { promptTokens: number; completionTokens: number };
    /** Model used for generation */
    model?: string;
    /** Provider used (gemini/openai/ollama) */
    provider?: string;
    /** which engine produced this result */
    engine?: string;
}

export type TaskType = 'full-app' | 'frontend' | 'scaffold' | 'static' | 'config';

export interface TaskProfile {
    type: TaskType;
    needsPlan: boolean;
    needsInstall: boolean;
    needsTypeCheck: boolean;
    needsLint: boolean;
    needsTest: boolean;
    needsRuntimeTest: boolean;
    maxIterations: number;
}

export interface KnowledgeFile {
    app: string;
    filename: string;
    path: string;
    content: string;
}

export interface ProjectBlueprint {
    repoPath: string;
    bridge: BridgeConfig;
    knowledgeFiles: KnowledgeFile[];
    conventions: string[];
    stack: ProjectStack | undefined;
    /** Raw TOON state snapshot from .factory/logs/state.toon (or legacy .factory/blueprint/blueprint.toon) */
    toonSnapshot?: string;
    /** Parsed skill index entries from .factory/skill-index.toon */
    projectSkills?: Array<{ name: string; path: string; description: string }>;
}

export interface ValidationResult {
    passed: boolean;
    errors: string[];
}

// ─── Skills ──────────────────────────────────────────────

/** A reusable skill/recipe the engine can discover and apply during builds */
export interface Skill {
    id: string;
    name: string;
    description: string;
    tags: string[];
    trigger: string;               // regex/keyword trigger pattern
    instructions: string;          // markdown instructions for the LLM
    template: string;              // optional code template
    category: SkillCategory;
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
}

export type SkillCategory = 'general' | 'layout' | 'auth' | 'api' | 'data' | 'ui' | 'integration' | 'custom' | 'mcp';

/** A skill with its relevance score after matching */
export interface ScoredSkill {
    skill: Skill;
    score: number;
    matchReason: string;
}

/** Blueprint / Context used to match skills against a build task */
export interface SkillMatchBlueprint {
    storyName: string;
    storyDescription: string;
    stack: string;
    tags: string[];
    taskDescription?: string;
}

// ─── Helpers ─────────────────────────────────────────────

/** Slugify a string: "My App Name" → "my-app-name" */
export function slugify(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

/** Get the slug from an AppStory */
export function storySlug(story: AppStory): string {
    return slugify(story.appName);
}

/** Get the port from an AppStory (defaults to 3000) */
export function storyPort(story: AppStory): number {
    return story.deployment?.port || 3000;
}

/** Get the region from an AppStory (defaults to us-central1) */
export function storyRegion(story: AppStory): string {
    return story.deployment?.region || 'us-central1';
}

// ─── Hierarchical App Roadmaps (App -> Feature/Epic -> Story -> Task) ───

export type AppStatus = 'draft' | 'in-progress' | 'testing' | 'done';
export type EpicStatus = 'pending' | 'in-progress' | 'completed' | 'blocked';
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface AppSpec {
    name: string;
    description: string;
    brd: string; // File path or content describing Business Requirements Document
    version: string;
    stack: StackConfig;
    features: FeatureEpicSpec[];
    status?: AppStatus;
}

export interface FeatureEpicSpec {
    name: string;
    description?: string;
    status?: EpicStatus;
    stories: StoryReferenceSpec[];
}

export interface StoryReferenceSpec {
    name: string;
    file?: string; // Path relative to project root or .factory/ (e.g. ".factory/stories/apps/greeting-scaffold.yaml")
    status?: StoryStatus;
    tasks: TaskItemSpec[];
}

export interface TaskItemSpec {
    id: string; // e.g. "task_001" or "lint"
    title: string;
    status: TaskStatus;
}

