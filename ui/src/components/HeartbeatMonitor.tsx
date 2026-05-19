'use client';
import { useEffect, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface HeartbeatEntry {
    project: string;
    last_seen: string;
    task: string;
    status: string;
}

export function HeartbeatMonitor() {
    const [heartbeats, setHeartbeats] = useState<HeartbeatEntry[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchHeartbeats = async () => {
            try {
                const res = await fetch('/api/heartbeat');
                const data = await res.json();
                setHeartbeats(data);
            } catch {
                // Ignore errors
            } finally {
                setLoading(false);
            }
        };

        fetchHeartbeats();
        const interval = setInterval(fetchHeartbeats, 30000);
        return () => clearInterval(interval);
    }, []);

    if (loading) return <div className="text-muted-foreground">Loading heartbeats...</div>;

    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Last Seen</TableHead>
                    <TableHead>Task</TableHead>
                    <TableHead>Status</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {heartbeats.map((hb, i) => (
                    <TableRow key={i}>
                        <TableCell>{hb.project}</TableCell>
                        <TableCell>{new Date(hb.last_seen).toLocaleString()}</TableCell>
                        <TableCell>{hb.task}</TableCell>
                        <TableCell>
                            <span className={`inline-flex items-center gap-1.5`}>
                                <span className={`w-2 h-2 rounded-full ${hb.status === 'active' ? 'bg-green-500' : 'bg-yellow-500'}`} />
                                {hb.status}
                            </span>
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}
