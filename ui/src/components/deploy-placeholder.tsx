'use client';

import { Globe, CloudUpload, GitBranch, ShieldCheck, Activity, Server } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const upcomingFeatures = [
  { icon: CloudUpload, label: 'Cloud Deploy',      desc: 'Push built apps to Vercel, Railway, or Fly.io with one click', tag: 'Cloud' },
  { icon: GitBranch,   label: 'Git Integration',   desc: 'Auto-commit, branch, and open a PR after every successful build', tag: 'Git' },
  { icon: ShieldCheck, label: 'Pre-deploy Gates',  desc: 'Require all tests to pass before any deployment is allowed', tag: 'Gating' },
  { icon: Activity,    label: 'Health Checks',     desc: 'Post-deploy HTTP probe with rollback on failure', tag: 'Runtime' },
  { icon: Server,      label: 'Self-hosted',       desc: 'Deploy to your own infrastructure via SSH or Docker', tag: 'Infra' },
  { icon: Globe,       label: 'Custom Domains',    desc: 'Map custom domains and configure SSL automatically', tag: 'DNS' },
];

export function DeployPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] py-16 text-center space-y-8 px-4">
      {/* Icon */}
      <div className="relative">
        <div className="h-20 w-20 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto">
          <Globe className="h-9 w-9 text-emerald-400" />
        </div>
        <span className="absolute -top-2 -right-2 text-xs font-semibold bg-amber-500 text-white px-2 py-0.5 rounded-full uppercase tracking-wider">
          Soon
        </span>
      </div>

      {/* Heading */}
      <div className="space-y-2 max-w-lg">
        <h1 className="text-xl font-semibold tracking-tight">Deploy</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          One-click deployment pipeline — push your generated apps straight to production with pre-deploy gates, health checks, and automatic rollback. Full CI/CD orchestration is coming soon.
        </p>
      </div>

      {/* CTA placeholder */}
      <Button disabled variant="outline" className="gap-2 opacity-60 cursor-not-allowed">
        <CloudUpload className="h-4 w-4" />
        Deploy to Production
      </Button>

      {/* Feature grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-3xl w-full mt-2">
        {upcomingFeatures.map(({ icon: Icon, label, desc, tag }) => (
          <div
            key={label}
            className="p-4 rounded-xl border border-border/60 bg-muted/20 text-left space-y-2 hover:bg-muted/40 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <Icon className="h-4 w-4 text-emerald-400" />
              </div>
              <Badge variant="outline" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {tag}
              </Badge>
            </div>
            <p className="text-sm font-semibold text-foreground">{label}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
