/**
 * Auto-fix broken YAML stories using the configured LLM.
 * When the factory encounters a story that fails to parse,
 * this module sends the broken YAML + error to the LLM
 * and writes the corrected version back.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { requireActiveProvider, callProvider } from './generate.ts';

const log = (icon: string, msg: string) => console.log(`  ${icon} ${msg}`);

/**
 * Attempt to fix a broken YAML story file using the LLM.
 * Returns { fixed: true, tokensIn, tokensOut } if successful, { fixed: false } otherwise.
 * The file is overwritten in-place with the corrected YAML.
 */
export async function autoFixStory(
    storyPath: string,
    error: string,
): Promise<{ fixed: boolean; tokensIn?: number; tokensOut?: number }> {
    const MAX_ATTEMPTS = 2;

    let rawYaml: string;
    try {
        rawYaml = readFileSync(storyPath, 'utf-8');
    } catch {
        return { fixed: false };
    }

    log('🔧', `Auto-fixing story: ${storyPath.split('/').pop()}`);
    log('→', `Error: ${error.slice(0, 120)}`);

    let totalTokensIn = 0;
    let totalTokensOut = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const { provider, model } = requireActiveProvider();

            const prompt = `You are a YAML story fixer for an autonomous code factory.

The following YAML story file failed to parse. Fix the YAML so it parses correctly.
Keep ALL the original content and meaning — only fix syntax issues like:
- Unquoted strings containing special YAML characters ({ } [ ] : , # & * ? | - < > = ! % @ \`)
- Incorrect indentation
- Missing quotes around values
- Duplicate keys
- Invalid YAML constructs

IMPORTANT RULES:
1. Return ONLY the corrected YAML — no explanations, no markdown fences, no commentary
2. Preserve all original field names, values, and structure
3. If a string value contains special characters, wrap it in single quotes
4. Make sure all indentation is consistent (2 spaces)

## Error Message
${error}

## Broken YAML
${rawYaml}

Return the fixed YAML now:`;

            log('→', `Attempt ${attempt}/${MAX_ATTEMPTS} — calling ${provider.name} (${model})...`);
            const response = await callProvider(provider, model, prompt);
            totalTokensIn += response.tokensIn;
            totalTokensOut += response.tokensOut;

            // Clean up LLM response — strip markdown fences if present
            let fixedYaml = response.text.trim();
            if (fixedYaml.startsWith('```')) {
                fixedYaml = fixedYaml.replace(/^```(?:ya?ml)?\s*\n?/, '').replace(/\n?```\s*$/, '');
            }

            // Validate the fixed YAML parses
            const parsed = parseYaml(fixedYaml);
            if (!parsed || typeof parsed !== 'object') {
                log('✗', `Attempt ${attempt}: LLM returned invalid YAML structure`);
                rawYaml = fixedYaml; // Use LLM output as input for next attempt
                continue;
            }

            // Basic sanity checks
            const isFeature = !!parsed.feature;
            if (isFeature && (!parsed.feature?.name || !parsed.target?.app)) {
                log('✗', `Attempt ${attempt}: Fixed YAML missing required fields (feature.name or target.app)`);
                continue;
            }
            if (!isFeature && !parsed.appName) {
                log('✗', `Attempt ${attempt}: Fixed YAML missing appName`);
                continue;
            }

            // Write the fixed YAML back
            writeFileSync(storyPath, fixedYaml + '\n', 'utf-8');
            log('✓', `Auto-fixed successfully on attempt ${attempt}`);
            log('→', `Tokens: ${totalTokensIn} in / ${totalTokensOut} out`);
            return { fixed: true, tokensIn: totalTokensIn, tokensOut: totalTokensOut };
        } catch (llmErr) {
            const msg = llmErr instanceof Error ? llmErr.message : String(llmErr);
            log('✗', `Attempt ${attempt} failed: ${msg}`);
        }
    }

    log('✗', `Could not auto-fix after ${MAX_ATTEMPTS} attempts`);
    return { fixed: false, tokensIn: totalTokensIn, tokensOut: totalTokensOut };
}
