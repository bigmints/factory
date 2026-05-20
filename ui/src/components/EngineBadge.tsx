'use client';
import { Badge } from '@/components/ui/badge';

type EngineType = 'factory' | 'worker' | 'unknown';

const ENGINE_COLORS: Record<EngineType, string> = {
    factory: 'bg-blue-500 hover:bg-blue-600',
    worker: 'bg-purple-500 hover:bg-purple-600',
    unknown: 'bg-gray-500 hover:bg-gray-600',
};

export function EngineBadge({ engine }: { engine: EngineType }) {
    return (
        <Badge variant="outline" className={`${ENGINE_COLORS[engine]} text-white`}>
            {engine === 'factory' ? '⚙ Factory' : engine === 'worker' ? '👷 Worker' : '❓ Unknown'}
        </Badge>
    );
}
