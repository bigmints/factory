'use client';

import { Badge } from '@/components/ui/badge';

interface StatusBadgeProps {
  status: string;
}

const statusConfig: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
  draft: { variant: 'secondary', label: 'Draft' },
  queued: { variant: 'default', label: 'Queued' },
  running: { variant: 'outline', label: 'Running' },
  review: { variant: 'outline', label: 'Review' },
  failed: { variant: 'destructive', label: 'Failed' },
  done: { variant: 'default', label: 'Done' },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] || { variant: 'secondary' as const, label: status || 'draft' };
  return (
    <Badge variant={config.variant} className="text-xs sm:text-xs px-1.5 sm:px-2 py-0.5">
      {config.label}
    </Badge>
  );
}
