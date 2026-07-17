/**
 * Chronicle Distillation Engine — dynamically distills worklogs, ADRs, and failures into a high-density, token-efficient repository chronicle.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as yamlParse } from 'yaml';
import { requireActiveProvider, callProviderTextOnly } from './generate.ts';
import { buildFileTree } from './init.ts';
import { log, logError } from './log.ts';

const CHRONICLE_TEXT_TIMEOUT_MS = 90_000;

interface FailureRecord {
    filename: string;
    content: string;
}

interface AdrRecord {
    filename: string;
    title: string;
    content: string;
}

interface CliTurn {
    attempt: number;
    tpmBrief: string;
    cliOutcome: string;
}

interface CliConversation {
    storySlug: string;
    turns: CliTurn[];
}

/**
 * Parses all CLI story execution logs inside .factory/logs/cli-*.log to extract TPM Briefs and CLI outcomes.
 */
export function parseCliLogs(repoPath: string): CliConversation[] {
    const logsDir = join(repoPath, '.factory', 'logs');
    if (!existsSync(logsDir)) return [];

    const conversations: CliConversation[] = [];
    try {
        const files = readdirSync(logsDir).filter(f => f.startsWith('cli-') && f.endsWith('.log'));
        for (const file of files) {
            const storySlug = file.replace(/^cli-/, '').replace(/\.log$/, '');
            const content = readFileSync(join(logsDir, file), 'utf-8');

            const turns: CliTurn[] = [];
            const briefMarkerStart = '### TPM_BRIEF_START ###';
            const briefMarkerEnd = '### TPM_BRIEF_END ###';
            const outputMarkerStart = '### CLI_OUTPUT_START ###';
            const outputMarkerEnd = '### CLI_OUTPUT_END ###';

            let searchPos = 0;
            let attempt = 1;

            if (content.includes(briefMarkerStart)) {
                // Modern structure with explicit TPM/CLI markers
                while (true) {
                    const tpmStartIdx = content.indexOf(briefMarkerStart, searchPos);
                    if (tpmStartIdx === -1) break;

                    const tpmEndIdx = content.indexOf(briefMarkerEnd, tpmStartIdx);
                    if (tpmEndIdx === -1) break;

                    const tpmBrief = content.slice(tpmStartIdx + briefMarkerStart.length, tpmEndIdx).trim();

                    let cliOutcome = '';
                    const outStartIdx = content.indexOf(outputMarkerStart, tpmEndIdx);
                    if (outStartIdx !== -1) {
                        const outEndIdx = content.indexOf(outputMarkerEnd, outStartIdx);
                        const rawOutput = outEndIdx !== -1 
                            ? content.slice(outStartIdx + outputMarkerStart.length, outEndIdx).trim()
                            : content.slice(outStartIdx + outputMarkerStart.length).trim();
                        
                        // Extract final section or delivery completion summary
                        const completeIdx = rawOutput.toUpperCase().lastIndexOf('DELIVERY COMPLETE');
                        if (completeIdx !== -1) {
                            cliOutcome = rawOutput.slice(completeIdx).trim();
                        } else {
                            const maxLength = 1500;
                            if (rawOutput.length > maxLength) {
                                cliOutcome = '... [truncated] ...\n' + rawOutput.slice(-maxLength).trim();
                            } else {
                                cliOutcome = rawOutput;
                            }
                        }
                    }

                    turns.push({
                        attempt: attempt++,
                        tpmBrief: tpmBrief.slice(0, 2000),
                        cliOutcome: cliOutcome.slice(0, 2000),
                    });

                    searchPos = tpmEndIdx + briefMarkerEnd.length;
                }
            } else {
                // Fallback: older structure or logs without explicit TPM markers
                const parts = content.split(/={10,}/);
                if (parts.length >= 3) {
                    for (let i = 1; i < parts.length; i += 2) {
                        const metadata = parts[i]?.trim() || '';
                        const rawOutput = parts[i + 1]?.trim() || '';
                        if (!metadata && !rawOutput) continue;

                        let cliOutcome = '';
                        const completeIdx = rawOutput.toUpperCase().lastIndexOf('DELIVERY COMPLETE');
                        if (completeIdx !== -1) {
                            cliOutcome = rawOutput.slice(completeIdx).trim();
                        } else {
                            const maxLength = 1500;
                            if (rawOutput.length > maxLength) {
                                cliOutcome = '... [truncated] ...\n' + rawOutput.slice(-maxLength).trim();
                            } else {
                                cliOutcome = rawOutput;
                            }
                        }

                        turns.push({
                            attempt: attempt++,
                            tpmBrief: `TPM Delegated run metadata: ${metadata}`,
                            cliOutcome: cliOutcome.slice(0, 2000),
                        });
                    }
                } else if (content.trim().length > 0) {
                    // Raw fallback
                    let cliOutcome = '';
                    const maxLength = 1500;
                    if (content.length > maxLength) {
                        cliOutcome = '... [truncated] ...\n' + content.slice(-maxLength).trim();
                    } else {
                        cliOutcome = content.trim();
                    }
                    turns.push({
                        attempt: 1,
                        tpmBrief: 'No TPM brief parsed.',
                        cliOutcome,
                    });
                }
            }

            if (turns.length > 0) {
                conversations.push({
                    storySlug,
                    turns,
                });
            }
        }
    } catch (e) {
        log('!', `Error parsing CLI logs: ${e}`);
    }

    return conversations;
}

/**
 * Distills the raw repository logs, failures, and architectural decision records (ADRs)
 * into two distinct files:
 * 1. knowledge.md (Bird's eye view of approach, tech stack, architecture)
 * 2. chronicles.md (Append-only notes of story completions: Action, What, Because, So that)
 */
export async function distillKnowledgeAndChronicles(repoPath: string): Promise<void> {
    const factoryDir = join(repoPath, '.factory');
    if (!existsSync(factoryDir)) {
        log('!', `No .factory bridge directory found in ${repoPath} — skipping knowledge distillation`);
        return;
    }

    const knowledgeDir = join(factoryDir, 'knowledge');
    const logsDir = join(factoryDir, 'logs');
    const blueprintPath = join(knowledgeDir, 'blueprint.md');
    const knowledgePath = join(knowledgeDir, 'knowledge.md');
    const chroniclesPath = join(knowledgeDir, 'chronicles.md');

    if (!existsSync(knowledgeDir)) {
        try {
            mkdirSync(knowledgeDir, { recursive: true });
        } catch (e) {
            logError(`Failed to create knowledge directory: ${e}`);
            return;
        }
    }

    log('→', 'GATHERING RAW CONTEXT FOR KNOWLEDGE & CHRONICLES...');

    // 1. Existing contents
    let existingKnowledge = '';
    if (existsSync(knowledgePath)) existingKnowledge = readFileSync(knowledgePath, 'utf-8');
    let existingChronicles = '';
    if (existsSync(chroniclesPath)) existingChronicles = readFileSync(chroniclesPath, 'utf-8');

    // 2. Project Tree, README, and Package.json (for Knowledge)
    const fileTree = buildFileTree(repoPath, 4);
    let readme = '';
    for (const f of ['README.md', 'readme.md', 'README.txt']) {
        const p = join(repoPath, f);
        if (existsSync(p)) {
            readme = readFileSync(p, 'utf-8').slice(0, 5000);
            break;
        }
    }
    let pkg = '';
    const pkgPath = join(repoPath, 'package.json');
    if (existsSync(pkgPath)) pkg = readFileSync(pkgPath, 'utf-8').slice(0, 3000);

    // 3. Failures
    const failures: FailureRecord[] = [];
    const failDirs = [join(logsDir, 'failures'), join(knowledgeDir, 'failures')];
    for (const failDir of failDirs) {
        if (existsSync(failDir)) {
            try {
                const files = readdirSync(failDir).filter(f => f.endsWith('.md'));
                for (const file of files) {
                    failures.push({
                        filename: file,
                        content: readFileSync(join(failDir, file), 'utf-8'),
                    });
                }
            } catch { /* ignore */ }
        }
    }

    // 4. Worklogs
    let worklogContent = 'No worklog entries found.';
    const worklogCandidates = [
        join(logsDir, 'worklog.yaml'),
        join(factoryDir, 'context', 'worklog.yaml'),
    ];
    for (const path of worklogCandidates) {
        if (existsSync(path)) {
            try {
                const raw = yamlParse(readFileSync(path, 'utf-8'));
                if (Array.isArray(raw)) {
                    worklogContent = raw.slice(-20).map((e: any) => `[${e.date}] ${e.message}`).join('\n');
                } else {
                    const entries = (raw as any)?.entries;
                    if (Array.isArray(entries)) {
                        worklogContent = entries.slice(-20).map((e: any) => `[${e.date}] ${e.message}`).join('\n');
                    } else {
                        worklogContent = readFileSync(path, 'utf-8').slice(-2000); // fallback raw text snippet
                    }
                }
                break;
            } catch { /* ignore */ }
        }
    }

    // 5. ADRs
    const adrs: AdrRecord[] = [];
    const adrDirs = [
        join(repoPath, 'docs', 'adr'), 
        join(knowledgeDir, 'ADRs'), 
        join(knowledgeDir, 'design-system')
    ];
    for (const dir of adrDirs) {
        if (existsSync(dir)) {
            try {
                const files = readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'blueprint.md' && f !== 'knowledge.md' && f !== 'chronicles.md');
                for (const file of files) {
                    const content = readFileSync(join(dir, file), 'utf-8');
                    const titleMatch = content.match(/^# (.+)$/m);
                    const title = titleMatch?.[1] || file.replace('.md', '');
                    adrs.push({ filename: file, title, content });
                }
            } catch { /* ignore */ }
        }
    }

    // 6. CLI Conversations
    const conversations = parseCliLogs(repoPath);
    let conversationsBlock = 'No recent CLI conversation history found.';
    if (conversations.length > 0) {
        conversationsBlock = conversations.map(c => {
            const turnBlocks = c.turns.map(t => {
                return `#### Attempt ${t.attempt}\n* **TPM Brief**: ${t.tpmBrief}\n* **CLI Outcome**: ${t.cliOutcome}`;
            }).join('\n\n');
            return `### Story Slug: ${c.storySlug}\n${turnBlocks}`;
        }).join('\n\n---\n\n');
    }

    try {
        const { provider, model } = requireActiveProvider();
        
        // --- LLM CALL 1: BLUEPRINT (Tech Stack & Structure) ---
        log('→', "DISTILLING BLUEPRINT (TECH STACK & STRUCTURE)...");
        
        const blueprintSysInstr = `You are the Factory Blueprint Architect. Your job is to synthesize the repository architecture, tech stack, and directory structure into a single document: blueprint.md.

Strict Rules:
- Output the Tech Stack, Framework Configurations, Directory Structure Map, and Active Integrations.
- Do NOT include history, approach changes, or post-mortems (that goes in knowledge.md).
- Output ONLY the markdown document. Do not wrap in markdown code blocks (\`\`\`markdown).`;

        const blueprintPrompt = `## INPUT DATA FOR BLUEPRINT
### 1. Project File Tree
${fileTree.join('\n')}

### 2. Package.json
${pkg}

### 3. README
${readme}

---
Synthesize the above into the high-density BLUEPRINT document detailing the immutable tech stack and structure.`;

        let blueprintText = await callProviderTextOnly(provider, model, blueprintSysInstr, blueprintPrompt, CHRONICLE_TEXT_TIMEOUT_MS);
        blueprintText = blueprintText.replace(/^\s*```(?:markdown)?\s*([\s\S]*?)```\s*$/, '$1').trim();
        if (blueprintText && blueprintText.length > 10) {
            writeFileSync(blueprintPath, blueprintText + '\n');
            log('✓', `Blueprint updated successfully at ${blueprintPath}`);
        } else {
            log('!', 'LLM returned an empty blueprint response.');
        }

        // --- LLM CALL 2: KNOWLEDGE (Strategy & Learnings) ---
        log('→', "DISTILLING KNOWLEDGE (STRATEGY & LEARNINGS)...");
        
        const knowledgeSysInstr = `You are the Factory Knowledge Distiller. Your job is to synthesize the strategic approach, architectural paradigms, new features, and post-mortems into a single high-level document: knowledge.md.

Strict Rules:
- This is a "Bird's eye view". Focus on what changed in the overall approach, architectural paradigms, new features added, and anti-patterns.
- Do NOT list the basic tech stack or directory structure (that is in the Blueprint).
- Maintain a running history: do not delete previous key learnings; merge new updates with the existing knowledge.
- Include an "Anti-Patterns & Post-Mortems" section summarizing what didn't work and the established fixes.
- Output ONLY the markdown document. Do not wrap in markdown code blocks (\`\`\`markdown).`;

        const knowledgePrompt = `## INPUT DATA FOR KNOWLEDGE SYNTHESIS

### 1. Existing Knowledge
${existingKnowledge || 'No existing knowledge.'}

### 2. Architectural Decision Records (ADRs)
${adrs.length === 0 ? 'No ADRs found.' : adrs.map(a => `* ${a.title} (${a.filename}):\n${a.content.slice(0, 1000)}...`).join('\n\n')}

### 3. Recent Failures & Post-Mortems
${failures.length === 0 ? 'No failures recorded.' : failures.map(f => `--- FAILURE FILE: ${f.filename} ---\n${f.content}`).join('\n\n')}

---
Synthesize the above into the high-density KNOWLEDGE document. Maintain sections like Architectural Paradigm, New Features / Approach Changes, and Anti-Patterns.`;

        let knowledgeText = await callProviderTextOnly(provider, model, knowledgeSysInstr, knowledgePrompt, CHRONICLE_TEXT_TIMEOUT_MS);
        knowledgeText = knowledgeText.replace(/^\s*```(?:markdown)?\s*([\s\S]*?)```\s*$/, '$1').trim();

        if (knowledgeText && knowledgeText.length > 10) {
            writeFileSync(knowledgePath, knowledgeText + '\n');
            log('✓', `Knowledge updated successfully at ${knowledgePath}`);
        } else {
            log('!', 'LLM returned an empty knowledge response.');
        }

        // --- LLM CALL 2: CHRONICLES (Story Completions) ---
        log('→', 'EXTRACTING CHRONICLES (STORY NOTES)...');
        
        const chronicleSysInstr = `You are the Factory Chronicle Extractor. Your job is to extract story completion notes from CLI logs and worklogs, and APPEND them to the existing chronicles list.

Strict Rules:
- The chronicles MUST strictly be an append-only list of notes captured at the end of story completions.
- The output format for EACH item MUST be strictly:
  * **[Datestamp] [Commit Number if available]**
    * **Action**: <Created | changed | removed | fixed>
    * **What**: <file, feature, bug, module, db table, etc>
    * **Because**: <the reason>
    * **So that**: <the benefit>
- ONLY return the newly extracted items formatted exactly as above. Do not rewrite the existing chronicle.
- If there is no new information to extract, return an empty string.
- Output ONLY the markdown text. Do not wrap in markdown code blocks.`;

        const chroniclePrompt = `## INPUT DATA FOR EXTRACTION

### 1. Existing Chronicles (For Context - DO NOT REPEAT THESE)
${existingChronicles || 'No existing chronicles.'}

### 2. Recent Worklog Entries
${worklogContent}

### 3. CLI Agent Conversation History (Story Outcomes)
${conversationsBlock}

---
Extract the NEW story completion notes from the Worklog Entries and CLI Conversation History. Return ONLY the new appendable list items matching the exact format. If nothing new, return "NO_UPDATE".`;

        let chronicleText = await callProviderTextOnly(provider, model, chronicleSysInstr, chroniclePrompt, CHRONICLE_TEXT_TIMEOUT_MS);
        chronicleText = chronicleText.replace(/^\s*```(?:markdown)?\s*([\s\S]*?)```\s*$/, '$1').trim();

        if (chronicleText && chronicleText.length > 10 && chronicleText !== 'NO_UPDATE') {
            const finalChronicles = (existingChronicles + '\n\n' + chronicleText).trim();
            writeFileSync(chroniclesPath, finalChronicles + '\n');
            log('✓', `Chronicles appended successfully at ${chroniclesPath}`);
        } else {
            log('!', 'No new chronicles to append.');
        }

    } catch (e: any) {
        logError(`Knowledge/Chronicle distillation failed: ${e.message}`);
    }
}
