'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type Step = 'path' | 'detect' | 'confirm';

interface DetectedStack {
    framework: string;
    packageManager: string;
    linter: string;
    testing: string;
    database: string;
}

export function ProjectInitWizard() {
    const [step, setStep] = useState<Step>('path');
    const [repoPath, setRepoPath] = useState('');
    const [stack, setStack] = useState<DetectedStack | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

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
        } catch (e) {
            setError('Failed to detect stack');
        } finally {
            setLoading(false);
        }
    };

    const handleInit = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/project/init', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repoPath, stack }),
            });
            const data = await res.json();
            if (data.success) {
                setStep('confirm');
            } else {
                setError(data.error || 'Init failed');
            }
        } catch {
            setError('Init failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Card className="w-full max-w-2xl">
            <CardHeader>
                <CardTitle>Add Project</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {step === 'path' && (
                    <>
                        <Input
                            placeholder="/path/to/repo"
                            value={repoPath}
                            onChange={(e) => setRepoPath(e.target.value)}
                        />
                        <Button onClick={handleDetect} disabled={!repoPath || loading}>
                            {loading ? 'Detecting...' : 'Detect Stack'}
                        </Button>
                    </>
                )}

                {step === 'detect' && stack && (
                    <>
                        <div className="space-y-2">
                            <h3 className="font-medium">Detected Stack</h3>
                            <div className="flex flex-wrap gap-2">
                                {Object.entries(stack).map(([key, value]) => (
                                    <Badge key={key} variant="secondary">{key}: {value}</Badge>
                                ))}
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <Button onClick={() => setStep('path')} variant="outline">Back</Button>
                            <Button onClick={handleInit} disabled={loading}>
                                {loading ? 'Initializing...' : 'Initialize Bridge'}
                            </Button>
                        </div>
                    </>
                )}

                {step === 'confirm' && (
                    <div className="text-center space-y-2">
                        <div className="text-2xl">✓</div>
                        <p className="text-muted-foreground">Project initialized successfully!</p>
                        <Button onClick={() => { setStep('path'); setRepoPath(''); setStack(null); }}>
                            Add Another
                        </Button>
                    </div>
                )}

                {error && <p className="text-red-500 text-sm">{error}</p>}
            </CardContent>
        </Card>
    );
}
