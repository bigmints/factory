/**
 * Chronicle Distillation Engine — dynamically distills worklogs, ADRs, and failures into a high-density, token-efficient repository chronicle.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as yamlParse } from 'yaml';
import { requireActiveProvider, callProviderTextOnly } from './generate.ts';
import { log, logError } from './log.ts';

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
 * into a single high-density chronicle file at `.factory/knowledge/chronicle.md`.
 */
export async function distillChronicle(repoPath: string): Promise<void> {
    const factoryDir = join(repoPath, '.factory');
    if (!existsSync(factoryDir)) {
        log('!', `No .factory bridge directory found in ${repoPath} — skipping chronicle distillation`);
        return;
    }

    const knowledgeDir = join(factoryDir, 'knowledge');
    const logsDir = join(factoryDir, 'logs');
    const chroniclePath = join(knowledgeDir, 'chronicle.md');

    if (!existsSync(knowledgeDir)) {
        try {
            mkdirSync(knowledgeDir, { recursive: true });
        } catch (e) {
            logError(`Failed to create knowledge directory: ${e}`);
            return;
        }
    }

    log('→', 'GATHERING RAW CONTEXT FOR DISTILLATION...');

    // 1. Read existing chronicle (if any)
    let existingChronicle = '';
    if (existsSync(chroniclePath)) {
        try {
            existingChronicle = readFileSync(chroniclePath, 'utf-8');
        } catch { /* ignore */ }
    }

    // 2. Read failures
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

    // 3. Read worklogs
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

    // 4. Read ADRs
    const adrs: AdrRecord[] = [];
    const adrDirs = [join(repoPath, 'docs', 'adr'), knowledgeDir];
    for (const dir of adrDirs) {
        if (existsSync(dir)) {
            try {
                const files = readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'chronicle.md');
                for (const file of files) {
                    const content = readFileSync(join(dir, file), 'utf-8');
                    const titleMatch = content.match(/^# (.+)$/m);
                    const title = titleMatch?.[1] || file.replace('.md', '');
                    adrs.push({ filename: file, title, content });
                }
            } catch { /* ignore */ }
        }
    }

    // 4.5. Read CLI conversation logs (TPM Briefs & CLI Outcomes)
    const conversations = parseCliLogs(repoPath);
    let conversationsBlock = 'No recent CLI conversation history found.';
    if (conversations.length > 0) {
        conversationsBlock = conversations.map(c => {
            const turnBlocks = c.turns.map(t => {
                return `#### Attempt ${t.attempt}
* **TPM Brief / Context**:
${t.tpmBrief}
* **CLI Execution & Outcome**:
${t.cliOutcome}`;
            }).join('\n\n');

            return `### Story Slug: ${c.storySlug}
${turnBlocks}`;
        }).join('\n\n---\n\n');
    }

    // 5. Construct input prompt for the LLM
    const systemInstruction = `You are the Factory Knowledge Distiller. Your job is to compile, synthesize, and compress raw logs, ADRs, and build failures into a single high-density markdown document: the REPOSITORY ARCHITECTURAL CHRONICLE (.factory/knowledge/chronicle.md).

This chronicle acts as a structured memory bridge for subsequent AI coding agents so they understand the context, stack decisions, key successes, and previous compile/runtime failures to avoid repeating mistakes.

Strict Rules:
- Keep the document highly dense, professional, and token-efficient.
- Eliminate raw logs, verbose descriptions, or excessive boilerplate.
- Synthesize all compilation or runtime failures into an "Anti-Patterns & Post-Mortems" section showing: what failed, the error/symptom, and the specific fix that resolved it.
- Maintain a running history: do not delete previous milestones or key architectural learnings; merge new updates with the existing chronicle.
- Use the TPM briefs and CLI outcomes/conversations to reconstruct a high-density, accurate historical overview of what was requested, what decisions/milestones were achieved, what actually worked, and any specific technical paths chosen.
- Output ONLY the markdown document. Do not include introductory or concluding conversational text.`;

    let prompt = `## INPUT DATA FOR SYNTHESIS

### 1. Existing Chronicle (To be updated/merged)
${existingChronicle || 'No existing chronicle.'}

### 2. Recent Worklog Entries (Last 20)
${worklogContent}

### 3. Recent Failures & Post-Mortems
${failures.length === 0 ? 'No failures recorded.' : failures.map(f => `--- FAILURE FILE: ${f.filename} ---\n${f.content}`).join('\n\n')}

### 4. Active Architectural Decision Records (ADRs)
${adrs.length === 0 ? 'No ADRs found.' : adrs.map(a => `* ${a.title} (${a.filename}):\n${a.content.slice(0, 1000)}...`).join('\n\n')}

### 5. CLI Agent Conversation History (TPM Briefs & CLI outcomes)
${conversationsBlock}

---
Please synthesize the above input into a high-density, updated REPOSITORY ARCHITECTURAL CHRONICLE (.factory/knowledge/chronicle.md). Maintain the following markdown sections:
# REPOSITORY ARCHITECTURAL CHRONICLE
## 1. Architectural Context & Key ADR Highlights
## 2. Chronology of Major Milestones & What Worked
## 3. Failure Post-Mortems & Anti-Patterns ("What Didn't Work" and how it was resolved)`;

    try {
        log('→', 'INVOKING ORCHESTRATOR LLM FOR CHRONICLE DISTILLATION...');
        const { provider, model } = requireActiveProvider();
        const distilledText = await callProviderTextOnly(provider, model, systemInstruction, prompt);

        if (distilledText && distilledText.trim().length > 10) {
            writeFileSync(chroniclePath, distilledText.trim() + '\n');
            log('✓', `Repository Architectural Chronicle updated successfully at ${chroniclePath}`);
        } else {
            log('!', 'LLM returned an empty or invalid chronicle response.');
        }
    } catch (e: any) {
        logError(`Chronicle distillation failed: ${e.message}`);
    }
}
