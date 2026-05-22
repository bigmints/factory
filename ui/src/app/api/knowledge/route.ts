/**
 * Knowledge API — retrieve build history, search, and aggregate stats.
 */
import { NextResponse } from 'next/server';
import { getBuildLogs } from '@engine/db';

/** GET — retrieve build history + aggregate stats */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const storyFile = url.searchParams.get('storyFile') || url.searchParams.get('specFile');
    const query = url.searchParams.get('q');
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);

    const allLogs = getBuildLogs();

    let rows = allLogs;

    // Filter by query
    if (query) {
      const q = query.toLowerCase();
      rows = allLogs.filter(log =>
        (log.storyFile || '').toLowerCase().includes(q) ||
        (log.output || '').toLowerCase().includes(q) ||
        (log.notes || '').toLowerCase().includes(q)
      );
    } else if (storyFile) {
      rows = allLogs.filter(log => log.storyFile === storyFile);
    }

    // Limit the results
    const limitedRows = rows.slice(0, limit);

    // Compute stats on ALL logs
    const totalCount = allLogs.length;
    const successfulCount = allLogs.filter(log => log.status === 'completed').length;
    const failedCount = allLogs.filter(log => log.status === 'failed').length;
    const uniqueStoriesCount = new Set(allLogs.map(log => log.storyFile)).size;

    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalDurationMs = 0;

    for (const log of allLogs) {
      totalTokensIn += log.tokensIn || 0;
      totalTokensOut += log.tokensOut || 0;
      totalDurationMs += log.durationMs || 0;
    }

    const avgDurationMs = totalCount > 0 ? Math.round(totalDurationMs / totalCount) : 0;

    // Model usage breakdown
    const usageMap = new Map<string, { model: string; provider: string; count: number; tokens_in: number; tokens_out: number }>();
    for (const log of allLogs) {
      if (log.model) {
        const providerName = log.provider || 'unknown';
        const key = `${providerName}:${log.model}`;
        let existing = usageMap.get(key);
        if (!existing) {
          existing = { model: log.model, provider: providerName, count: 0, tokens_in: 0, tokens_out: 0 };
          usageMap.set(key, existing);
        }
        existing.count++;
        existing.tokens_in += log.tokensIn || 0;
        existing.tokens_out += log.tokensOut || 0;
      }
    }
    const modelUsage = Array.from(usageMap.values()).sort((a, b) => b.count - a.count);

    // Error breakdown
    const errorMap = new Map<string, number>();
    for (const log of allLogs) {
      if (log.status === 'failed' && log.errorSource) {
        errorMap.set(log.errorSource, (errorMap.get(log.errorSource) || 0) + 1);
      }
    }
    const errorBreakdown = Array.from(errorMap.entries()).map(([error_source, count]) => ({
      error_source,
      count
    }));

    // Map to API backward-compatible response fields
    const entries = limitedRows.map((row) => ({
      id: row.id,
      storyFile: row.storyFile,
      specFile: row.storyFile,
      story_file: row.storyFile,
      spec_file: row.storyFile,
      kind: row.kind,
      timestamp: row.timestamp,
      durationMs: row.durationMs,
      duration_ms: row.durationMs,
      status: row.status,
      filesGenerated: row.filesGenerated || [],
      files_generated: JSON.stringify(row.filesGenerated || []),
      output: row.output,
      summary: row.output || '',
      notes: row.notes,
      model: row.model,
      provider: row.provider,
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      tokens_in: row.tokensIn,
      tokens_out: row.tokensOut,
      errorSource: row.errorSource,
      error_source: row.errorSource,
      errorCategory: row.errorCategory,
      engine: row.engine
    }));

    return NextResponse.json({
      entries,
      stats: {
        totalBuilds: totalCount,
        successfulBuilds: successfulCount,
        failedBuilds: failedCount,
        uniqueStories: uniqueStoriesCount,
        uniqueSpecs: uniqueStoriesCount,
        totalTokensIn,
        totalTokensOut,
        avgDurationMs,
        modelUsage,
        errorBreakdown,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
