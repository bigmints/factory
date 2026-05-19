'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type DaemonStatus = 'running' | 'stopped' | 'stalled' | 'unknown';

export function DaemonStatus() {
    const [status, setStatus] = useState<DaemonStatus>('unknown');
    const [pid, setPid] = useState<number | null>(null);
    const [pending, setPending] = useState(0);

    const fetchStatus = async () => {
        try {
            const res = await fetch('/api/daemon/status');
            const data = await res.json();
            setStatus(data.status);
            setPid(data.pid || null);
            setPending(data.pending || 0);
        } catch {
            setStatus('unknown');
        }
    };

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 10000);
        return () => clearInterval(interval);
    }, []);

    const statusColor: Record<DaemonStatus, string> = {
        running: 'bg-green-500',
        stopped: 'bg-gray-500',
        stalled: 'bg-red-500',
        unknown: 'bg-yellow-500',
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    Daemon Status
                    <span className={`w-3 h-3 rounded-full ${statusColor[status]}`} />
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                    <Badge variant={status === 'running' ? 'default' : 'secondary'}>
                        {status.toUpperCase()}
                    </Badge>
                    {pid && <span className="text-sm text-muted-foreground">PID: {pid}</span>}
                </div>

                <div className="text-sm">
                    <span className="text-muted-foreground">Pending items: </span>
                    <span className="font-medium">{pending}</span>
                </div>

                <div className="flex gap-2">
                    <Button size="sm" onClick={async () => {
                        await fetch('/api/daemon/start', { method: 'POST' });
                        fetchStatus();
                    }}>
                        Start
                    </Button>
                    <Button size="sm" variant="outline" onClick={async () => {
                        await fetch('/api/daemon/stop', { method: 'POST' });
                        fetchStatus();
                    }}>
                        Stop
                    </Button>
                    <Button size="sm" variant="outline" onClick={async () => {
                        await fetch('/api/daemon/restart', { method: 'POST' });
                        fetchStatus();
                    }}>
                        Restart
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
