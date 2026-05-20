/**
 * Task Classifier — analyzes a story and determines which pipeline stages to run.
 *
 * Instead of running the full plan → build → install → tsc → lint → test cycle
 * for every story, the classifier determines the minimum set of stages needed.
 */

import type { AppStory, TaskProfile } from './types.ts';
import { log } from './log.ts';

/** Static/vanilla frameworks that don't need npm install */
const STATIC_FRAMEWORKS = new Set(['html', 'vanilla', 'static', 'none', '']);

/**
 * Classify an app story into a task profile that controls which pipeline stages run.
 *
 * Task types:
 *   full-app  — framework + (testing or database/auth) → all stages
 *   frontend  — framework + UI, no testing configured   → skip tests
 *   scaffold  — framework, no linter or testing          → install only
 *   static    — no framework (HTML/CSS/JS)               → no toolchain
 *   config    — no pages, no data, no auth               → just write files
 */
export function classifyTask(story: AppStory): TaskProfile {
    const fw = story.stack.framework?.toLowerCase() ?? '';
    const hasFramework = fw.length > 0 && !STATIC_FRAMEWORKS.has(fw);
    const hasTesting = !!story.stack.testing && story.stack.testing.toLowerCase() !== 'none';
    const hasLinter = !!story.stack.linter && story.stack.linter.toLowerCase() !== 'none';
    const hasDatabase = !!story.stack.database && story.stack.database.toLowerCase() !== 'none';
    const hasAuth = !!story.auth?.provider;
    const hasPages = !!(story.pages?.dashboard?.length || story.pages?.crud?.length || story.pages?.custom?.length);
    const hasData = !!(story.data?.tables?.length);
    const isTypeScript = (story.stack.language?.toLowerCase() ?? 'typescript') !== 'javascript';

    let profile: TaskProfile;

    if (!hasFramework) {
        // No framework = static site or config-only
        if (!hasPages && !hasData && !hasAuth) {
            profile = {
                type: 'config',
                needsPlan: false,
                needsInstall: false,
                needsTypeCheck: false,
                needsLint: false,
                needsTest: false,
                needsRuntimeTest: false,
                maxIterations: 0,
            };
        } else {
            profile = {
                type: 'static',
                needsPlan: false,
                needsInstall: false,
                needsTypeCheck: false,
                needsLint: false,
                needsTest: false,
                needsRuntimeTest: false,
                maxIterations: 0,
            };
        }
    } else if (hasTesting && (hasDatabase || hasAuth)) {
        // Full app: framework + tests + backend concerns
        profile = {
            type: 'full-app',
            needsPlan: true,
            needsInstall: true,
            needsTypeCheck: isTypeScript,
            needsLint: hasLinter,
            needsTest: true,
            needsRuntimeTest: true,
            maxIterations: 5,
        };
    } else if (hasLinter || hasTesting) {
        // Frontend app: framework + linter/testing but no heavy backend
        profile = {
            type: 'frontend',
            needsPlan: true,
            needsInstall: true,
            needsTypeCheck: isTypeScript,
            needsLint: hasLinter,
            needsTest: hasTesting,
            needsRuntimeTest: true,
            maxIterations: 4,
        };
    } else {
        // Scaffold: just framework, no linter/testing
        profile = {
            type: 'scaffold',
            needsPlan: true,
            needsInstall: true,
            needsTypeCheck: false,
            needsLint: false,
            needsTest: false,
            needsRuntimeTest: false,
            maxIterations: 2,
        };
    }

    // Log the classification
    const flags = [
        profile.needsInstall ? 'install ✓' : 'install ✗',
        profile.needsTypeCheck ? 'tsc ✓' : 'tsc ✗',
        profile.needsLint ? 'lint ✓' : 'lint ✗',
        profile.needsTest ? 'test ✓' : 'test ✗',
    ].join(', ');
    log('●', `Task type: ${profile.type} (${flags})`);

    return profile;
}

/**
 * Return a strict task profile for feature builds.
 * Features always get full validation — install, typecheck, lint, and iteration.
 */
export function classifyFeatureTask(): TaskProfile {
    const profile: TaskProfile = {
        type: 'full-app',
        needsPlan: false,          // Feature stories already have enough detail
        needsInstall: true,
        needsTypeCheck: true,
        needsLint: true,
        needsTest: false,          // Features usually can't run tests in isolation
        needsRuntimeTest: true,
        maxIterations: 5,
    };

    const flags = [
        'install ✓', 'tsc ✓', 'lint ✓', 'test ✗',
    ].join(', ');
    log('●', `Feature task profile: ${profile.type} (${flags})`);

    return profile;
}
