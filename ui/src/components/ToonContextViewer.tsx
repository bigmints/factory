'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function ToonContextViewer() {
    const [context, setContext] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/toon-context')
            .then(res => res.json())
            .then(setContext)
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="text-muted-foreground">Loading context...</div>;

    return (
        <Card>
            <CardHeader>
                <CardTitle>TOON Context</CardTitle>
            </CardHeader>
            <CardContent>
                <pre className="text-sm bg-muted p-4 rounded overflow-auto max-h-96">
                    {JSON.stringify(context, null, 2)}
                </pre>
            </CardContent>
        </Card>
    );
}
