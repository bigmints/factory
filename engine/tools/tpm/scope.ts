import { join } from 'node:path';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { tpmToolRegistry } from '../registry.ts';
import type { OrchestratorContext } from '../../orchestrate.ts';
import type { ToolResult } from '../types.ts';
import { stringify as toYaml } from 'yaml';

function execReadQueue(_args: Record<string, unknown>, ctx: OrchestratorContext): ToolResult {
    const queuePath = join(ctx.repoPath, '.factory', 'task-manager', 'todo.yaml');
    if (!existsSync(queuePath)) {
        return { content: 'No queue found at .factory/task-manager/todo.yaml', isError: true };
    }
    const content = readFileSync(queuePath, 'utf-8');
    return { content: `Queue contents:\n\n${content}`, isError: false };
}

async function execSplitStory(args: Record<string, unknown>, ctx: OrchestratorContext): Promise<ToolResult> {
    const originalSlug = String(args.original_slug || '');
    const newStories = args.new_stories as Array<{slug: string, name: string, description: string, phase?: number, dependsOn?: string[]}>;
    
    if (!originalSlug || !Array.isArray(newStories) || newStories.length === 0) {
        return { content: 'original_slug and new_stories array are required', isError: true };
    }

    // Usually we would read the original story and mark it as split, but for now we just create the new stories
    const storiesDir = join(ctx.repoPath, '.factory', 'stories');
    const created: string[] = [];

    for (const story of newStories) {
        const filePath = join(storiesDir, `${story.slug}.md`);
        const frontmatter = {
            name: story.name,
            kind: 'feature',
            target: 'root',
            phase: story.phase || 1,
            dependsOn: story.dependsOn || [],
            status: 'draft'
        };
        const content = `---\n${toYaml(frontmatter).trim()}\n---\n\n# ${story.name}\n\n${story.description || 'Decomposed feature story.'}\n`;
        writeFileSync(filePath, content, 'utf-8');
        created.push(story.slug);
    }

    return { content: `Story ${originalSlug} split into ${created.join(', ')}.\nRemember to mark the original story as done or failed so the queue can proceed.`, isError: false };
}

function execUpdateStoryYaml(args: Record<string, unknown>, ctx: OrchestratorContext): ToolResult {
    const slug = String(args.slug || '');
    const yamlContent = String(args.yaml_content || '');
    if (!slug || !yamlContent) {
        return { content: 'slug and yaml_content are required', isError: true };
    }

    const storiesDir = join(ctx.repoPath, '.factory', 'stories');
    
    let targetPath = join(storiesDir, `${slug}.md`);
    if (!existsSync(targetPath)) {
        // Check done/ folder
        targetPath = join(storiesDir, 'done', `${slug}.md`);
        if (!existsSync(targetPath)) {
            // Also check current story file
            if (ctx.storyFile && ctx.storyFile.includes(slug)) {
                targetPath = join(ctx.repoPath, '.factory', 'stories', ctx.storyFile);
            } else {
                return { content: `Story ${slug} not found.`, isError: true };
            }
        }
    }

    try {
        let formattedContent = yamlContent;
        if (!yamlContent.trim().startsWith('---')) {
            parseYaml(yamlContent); // validate it's valid yaml
            formattedContent = `---\n${yamlContent.trim()}\n---\n\n# ${slug}\n\nAutomated requirements update.\n`;
        } else {
            // Extract and validate the frontmatter portion
            const match = yamlContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
            if (match) {
                parseYaml(match[1]);
            }
        }
        writeFileSync(targetPath, formattedContent, 'utf-8');
        return { content: `Story ${slug} updated successfully.`, isError: false };
    } catch (e) {
        return { content: `Failed to update story: ${e instanceof Error ? e.message : String(e)}`, isError: true };
    }
}

// Register Tools
tpmToolRegistry.register({
    name: 'tpm_read_queue',
    description: 'Read the contents of the task queue to see upcoming stories and dependencies.',
    parameters: { type: 'object', properties: {}, required: [] },
    execute: execReadQueue
});

tpmToolRegistry.register({
    name: 'tpm_split_story',
    description: 'Decompose a failing or complex story into smaller, phased feature stories.',
    parameters: {
        type: 'object',
        properties: {
            original_slug: { type: 'string', description: 'The slug of the story being split' },
            new_stories: { 
                type: 'array', 
                items: {
                    type: 'object',
                    properties: {
                        slug: { type: 'string' },
                        name: { type: 'string' },
                        description: { type: 'string' },
                        phase: { type: 'number' },
                        dependsOn: { type: 'array', items: { type: 'string' } }
                    },
                    required: ['slug', 'name', 'description']
                }
            }
        },
        required: ['original_slug', 'new_stories']
    },
    execute: execSplitStory
});

tpmToolRegistry.register({
    name: 'tpm_update_story_yaml',
    description: 'Update the YAML content of a story file (e.g. to amend requirements or stack choices).',
    parameters: {
        type: 'object',
        properties: {
            slug: { type: 'string' },
            yaml_content: { type: 'string', description: 'The full updated YAML content for the story.' }
        },
        required: ['slug', 'yaml_content']
    },
    execute: execUpdateStoryYaml
});
