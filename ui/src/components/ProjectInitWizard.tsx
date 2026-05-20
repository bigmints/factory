'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type Step = 'path' | 'detect' | 'init' | 'confirm';

interface DetectedStack {
    framework: string;
    packageManager: string;
    linter: string;
    testing: string;
    database: string;
}

interface FileEvent {
    file: string;
    action: 'created' | 'patched' | 'skipped';
}

const ACTION_ICON: Record<string, string> = {
    created: '✅',
    patched: '🔧',
    skipped: '⏭️',
};

export function ProjectInitWizard() {
    const [step, setStep] = useState<Step>('path');
    const [repoPath, setRepoPath] = useState('');
    const [stack, setStack] = useState<DetectedStack | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [fileEvents, setFileEvents] = useState<FileEvent[]>([]);
    const [initSummary, setInitSummary] = useState<{ created: number; skipped: number } | null>(null);

    const handleDetect = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await fetch('/api/project/detect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repoPath }),
            });
            const data = await res.json();
            if (data.error) {
                setError(data.error);
            } else {
                setStack(data.stack);
                setStep('detect');
            }
        } catch {
            setError('Failed to detect stack');
        } finally {
            setLoading(false);
        }
    };

    const handleInit = async () => {
        setLoading(true);
        setFileEvents([]);
        setInitSummary(null);
        setStep('init');

        try {
            const res = await fetch('/api/project/init', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repoPath, stack }),
            });

            if (!res.body) throw new Error('No response stream');

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const event = JSON.parse(line.slice(6));
                        if (event.done) {
                            setInitSummary({ created: event.created, skipped: event.skipped });
                            if (event.success) {
                                setStep('confirm');
                            } else {
                                setError(event.error || 'Init failed');
                                setStep('detect');
                            }
                        } else if (event.file) {
                            setFileEvents(prev => [...prev, { file: event.file, action: event.action }]);
                        }
                    } catch { /* ignore malformed lines */ }
                }
            }
        } catch (e) {
            setError('Init failed: ' + String(e));
            setStep('detect');
        } finally {
            setLoading(false);
        }
    };

    const reset = () => {
        setStep('path');
        setRepoPath('');
        setStack(null);
        setError('');
        setFileEvents([]);
        setInitSummary(null);
    };

    return (
        <Card className="w-full max-w-2xl">
            <CardHeader>
                <CardTitle>Add Project</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">

                {/* Step 1: Enter path */}
                {step === 'path' && (
                    <>
                        <p className="text-sm text-muted-foreground">
                            Enter the absolute path to a local repository to connect it to Factory.
                        </p>
                        <Input
                            id="project-path-input"
                            placeholder="/path/to/repo"
                            value={repoPath}
                            onChange={(e) => setRepoPath(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && repoPath && handleDetect()}
                        />
                        <Button id="detect-stack-btn" onClick={handleDetect} disabled={!repoPath || loading}>
                            {loading ? 'Detecting…' : 'Detect Stack →'}
                        </Button>
                    </>
                )}

                {/* Step 2: Show detected stack */}
                {step === 'detect' && stack && (
                    <>
                        <div className="space-y-2">
                            <h3 className="font-medium">Detected Stack</h3>
                            <div className="flex flex-wrap gap-2">
                                {Object.entries(stack)
                                    .filter(([, v]) => v)
                                    .map(([key, value]) => (
                                        <Badge key={key} variant="secondary">{key}: {value}</Badge>
                                    ))}
                            </div>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Factory will create a <code>.factory/</code> bridge scaffold, analyze the codebase,
                            copy workflow docs, and patch <code>AGENTS.md</code>.
                        </p>
                        <div className="flex gap-2">
                            <Button id="back-to-path-btn" onClick={() => setStep('path')} variant="outline">Back</Button>
                            <Button id="init-bridge-btn" onClick={handleInit} disabled={loading}>
                                Initialize Bridge →
                            </Button>
                        </div>
                    </>
                )}

                {/* Step 3: SSE streaming progress */}
                {step === 'init' && (
                    <div className="space-y-3">
                        <h3 className="font-medium text-sm">Initializing bridge…</h3>
                        <div className="max-h-64 overflow-y-auto space-y-1 rounded-md border p-3 bg-muted/30 font-mono text-xs">
                            {fileEvents.length === 0 && (
                                <p className="text-muted-foreground animate-pulse">Starting…</p>
                            )}
                            {fileEvents.map((ev, i) => (
                                <div key={i} className="flex items-center gap-2 animate-in fade-in slide-in-from-bottom-1 duration-200">
                                    <span>{ACTION_ICON[ev.action] ?? '⬜'}</span>
                                    <span className={ev.action === 'skipped' ? 'text-muted-foreground' : ''}>
                                        {ev.file}
                                    </span>
                                    <span className="ml-auto text-muted-foreground">{ev.action}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Step 4: Done */}
                {step === 'confirm' && (
                    <div className="text-center space-y-3">
                        <div className="text-4xl">🏭</div>
                        <p className="font-medium">Bridge initialized!</p>
                        {initSummary && (
                            <p className="text-sm text-muted-foreground">
                                {initSummary.created} files created · {initSummary.skipped} already existed
                            </p>
                        )}
                        {fileEvents.length > 0 && (
                            <div className="max-h-40 overflow-y-auto rounded-md border p-3 bg-muted/30 font-mono text-xs text-left space-y-1">
                                {fileEvents.map((ev, i) => (
                                    <div key={i} className="flex items-center gap-2">
                                        <span>{ACTION_ICON[ev.action] ?? '⬜'}</span>
                                        <span className={ev.action === 'skipped' ? 'text-muted-foreground' : ''}>{ev.file}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        <Button id="add-another-btn" onClick={reset}>Add Another</Button>
                    </div>
                )}

                {error && <p className="text-red-500 text-sm">{error}</p>}
            </CardContent>
        </Card>
    );
}
