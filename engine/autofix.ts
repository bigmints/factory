/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * autofix.ts — DEPRECATED.
 *
 * The LLM orchestrator (orchestrate.ts) handles story validation and
 * self-healing via re-delegation to the configured CLI agent.
 * This module is kept as a stub to satisfy imports that haven't been cleaned up.
 */

export async function autoFixStory(
    _storyPath: string,
    _error: string,
): Promise<{ fixed: boolean; tokensIn?: number; tokensOut?: number }> {
    // No-op: the orchestrator delegates self-healing to the CLI agent.
    return { fixed: false };
}
