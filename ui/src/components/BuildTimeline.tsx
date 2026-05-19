'use client';
import { useEffect, useState } from 'react';

interface BuildEvent {
    type: string;
    data: any;
    timestamp: string;
}

export function BuildTimeline({ project }: { project: string }) {
    const [events, setEvents] = useState<BuildEvent[]>([]);
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        const evtSource = new EventSource(`/api/build-events?project=${project}`);
        setConnected(true);

        evtSource.onmessage = (event) => {
            const parsed = JSON.parse(event.data);
            setEvents(prev => [...prev, { ...parsed, timestamp: new Date().toISOString() }]);
        };

        evtSource.onerror = () => {
            setConnected(false);
            evtSource.close();
        };

        return () => evtSource.close();
    }, [project]);

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-sm text-muted-foreground">
                    {connected ? 'Connected' : 'Disconnected'}
                </span>
            </div>
            <div className="space-y-1 max-h-96 overflow-y-auto">
                {events.map((event, i) => (
                    <div key={i} className="text-sm p-2 bg-muted rounded">
                        <span className="text-xs text-muted-foreground">{event.timestamp}</span>
                        <span className="ml-2">{event.type}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
