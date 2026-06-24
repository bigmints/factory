'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Wand2, Search, RefreshCw, AlertCircle } from 'lucide-react';

interface Skill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  trigger: string;
  category: string;
  enabled: boolean;
}

export function SkillsView() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const loadSkills = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/skills');
      const data = await res.json();
      setSkills(data.skills || []);
    } catch {
      toast.error('Failed to load skills');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSkills();
  }, []);

  const filteredSkills = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase()) ||
      s.trigger.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 md:space-y-8 flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm text-muted-foreground border-b border-border/40 pb-4">
        <span className="flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-primary" />
          <span className="font-semibold text-foreground">Custom & MCP Skills</span>
        </span>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search skills..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 w-44 sm:w-60 text-xs"
            />
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={loadSkills}
            disabled={loading}
            className="h-8 w-8 p-0 rounded-md hover:bg-muted"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      ) : filteredSkills.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/60 border border-dashed border-border rounded-xl bg-card/5">
          <AlertCircle className="h-8 w-8 opacity-30 mb-2" />
          <p className="text-xs font-medium">No skills found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredSkills.map((skill) => (
            <Card key={skill.id} className="p-5 border border-border/60 hover:border-border/95 transition-colors flex flex-col justify-between gap-3 shadow-xs bg-card/10">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="text-xs sm:text-sm font-semibold text-foreground truncate">{skill.name}</h3>
                  <Badge variant={skill.category === 'mcp' ? 'default' : 'outline'} className="text-xs px-1.5 py-0 rounded font-semibold uppercase tracking-wider">
                    {skill.category}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                  {skill.description || 'No description provided.'}
                </p>
              </div>

              {skill.trigger && (
                <div className="pt-2 border-t border-border/10 flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                  <span className="font-semibold text-xs uppercase tracking-wide">Trigger:</span>
                  <span className="bg-muted px-1.5 py-0.5 rounded text-foreground truncate max-w-48">{skill.trigger}</span>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
