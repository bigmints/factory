'use client';
import { Badge } from '@/components/ui/badge';
import { Settings, Hammer, HelpCircle } from 'lucide-react';

type EngineType = 'factory' | 'worker' | 'unknown';

const ENGINE_COLORS: Record<EngineType, string> = {
    factory: 'bg-blue-500 hover:bg-blue-600',
    worker: 'bg-purple-500 hover:bg-purple-600',
    unknown: 'bg-gray-500 hover:bg-gray-600',
};

export function EngineBadge({ engine }: { engine: EngineType }) {
    return (
        <Badge variant="outline" className={`${ENGINE_COLORS[engine]} text-white`}>
            {engine === 'factory' ? (
                <span className="flex items-center gap-1"><Settings className="h-3 w-3" /> Factory</span>
            ) : engine === 'worker' ? (
                <span className="flex items-center gap-1"><Hammer className="h-3 w-3" /> Worker</span>
            ) : (
                <span className="flex items-center gap-1"><HelpCircle className="h-3 w-3" /> Unknown</span>
            )}
        </Badge>
    );
}
