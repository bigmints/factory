'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function ToonBlueprintViewer() {
    const [blueprint, setBlueprint] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/toon-blueprint')
            .then(res => res.json())
            .then(setBlueprint)
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="text-muted-foreground">Loading blueprint...</div>;

    return (
        <Card>
            <CardHeader>
                <CardTitle>TOON Blueprint</CardTitle>
            </CardHeader>
            <CardContent>
                <pre className="text-sm bg-muted p-4 rounded overflow-auto max-h-96">
                    {JSON.stringify(blueprint, null, 2)}
                </pre>
            </CardContent>
        </Card>
    );
}
