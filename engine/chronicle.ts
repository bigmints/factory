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

    // 5. Construct input prompt for the LLM
    const systemInstruction = `You are the Factory Knowledge Distiller. Your job is to compile, synthesize, and compress raw logs, ADRs, and build failures into a single high-density markdown document: the REPOSITORY ARCHITECTURAL CHRONICLE (.factory/knowledge/chronicle.md).

This chronicle acts as a structured memory bridge for subsequent AI coding agents so they understand the context, stack decisions, key successes, and previous compile/runtime failures to avoid repeating mistakes.

Strict Rules:
- Keep the document highly dense, professional, and token-efficient.
- Eliminate raw logs, verbose descriptions, or excessive boilerplate.
- Synthesize all compilation or runtime failures into an "Anti-Patterns & Post-Mortems" section showing: what failed, the error/symptom, and the specific fix that resolved it.
- Maintain a running history: do not delete previous milestones or key architectural learnings; merge new updates with the existing chronicle.
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
