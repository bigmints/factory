'use client';

import { Badge } from '@/components/ui/badge';

interface StatusBadgeProps {
  status: string;
}

const statusConfig: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
  draft: { variant: 'secondary', label: 'Draft' },
  ready: { variant: 'default', label: 'Ready' },
  'in-progress': { variant: 'outline', label: 'In Progress' },
  validation: { variant: 'outline', label: 'Validating' },
  review: { variant: 'outline', label: 'Review' },
  done: { variant: 'default', label: 'Done' },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] || { variant: 'secondary' as const, label: status };
  return (
    <Badge variant={config.variant} className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5">
      {config.label}
    </Badge>
  );
}
