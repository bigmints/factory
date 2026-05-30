/**
 * GET /api/reports — Computes build analytics statistics and historical entries.
 * Resolves builds from the ~/.factory/builds.yaml file.
 */
import { NextResponse } from 'next/server';
import { getBuildLogs } from '@engine/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const logs = getBuildLogs() || [];
    
    const totalBuilds = logs.length;
    let successfulBuilds = 0;
    let failedBuilds = 0;
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let sumDurationMs = 0;
    
    const uniqueStories = new Set<string>();
    const modelUsageMap = new Map<string, { model: string; provider: string; count: number; tokens_in: number; tokens_out: number }>();
    const errorSourceMap = new Map<string, number>();

    for (const log of logs) {
      if (log.status === 'completed') {
        successfulBuilds++;
      } else if (log.status === 'failed') {
        failedBuilds++;
      }

      if (log.storyFile) {
        uniqueStories.add(log.storyFile);
      }

      totalTokensIn += log.tokensIn || 0;
      totalTokensOut += log.tokensOut || 0;
      sumDurationMs += log.durationMs || 0;

      // Model usage tracking
      if (log.model) {
        const key = `${log.provider || 'unknown'}:${log.model}`;
        const existing = modelUsageMap.get(key) || {
          model: log.model,
          provider: log.provider || 'unknown',
          count: 0,
          tokens_in: 0,
          tokens_out: 0
        };
        existing.count++;
        existing.tokens_in += log.tokensIn || 0;
        existing.tokens_out += log.tokensOut || 0;
        modelUsageMap.set(key, existing);
      }

      // Error source breakdown
      if (log.status === 'failed') {
        const src = log.errorSource || 'unclassified';
        errorSourceMap.set(src, (errorSourceMap.get(src) || 0) + 1);
      }
    }

    const avgDurationMs = totalBuilds > 0 ? Math.round(sumDurationMs / totalBuilds) : 0;
    const modelUsage = Array.from(modelUsageMap.values());
    const errorBreakdown = Array.from(errorSourceMap.entries()).map(([error_source, count]) => ({
      error_source,
      count
    }));

    // Map log entries to match snake_case / camelCase expectations for frontend ReportViewer
    const entries = logs.map(log => ({
      ...log,
      story_file: log.storyFile,
      spec_file: log.storyFile, // fallback matching
      duration_ms: log.durationMs,
      tokens_in: log.tokensIn,
      tokens_out: log.tokensOut,
      error_source: log.errorSource,
    }));

    const stats = {
      totalBuilds,
      successfulBuilds,
      failedBuilds,
      uniqueStories: uniqueStories.size,
      uniqueSpecs: uniqueStories.size,
      totalTokensIn,
      totalTokensOut,
      avgDurationMs,
      modelUsage,
      errorBreakdown
    };

    return NextResponse.json({
      entries,
      stats
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
