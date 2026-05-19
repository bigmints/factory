'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Skill {
    name: string;
    path: string;
    description: string;
}

export function SkillRegistry() {
    const [skills, setSkills] = useState<Skill[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/skills')
            .then(res => res.json())
            .then(data => setSkills(data.skills || []))
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="text-muted-foreground">Loading skills...</div>;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Skill Registry</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
                {skills.map((skill, i) => (
                    <div key={i} className="p-3 bg-muted rounded">
                        <div className="font-medium">{skill.name}</div>
                        <div className="text-sm text-muted-foreground">{skill.description}</div>
                        <div className="text-xs text-muted-foreground mt-1">{skill.path}</div>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}
