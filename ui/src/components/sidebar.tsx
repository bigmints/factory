'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Factory,
  FileText,
  LayoutDashboard,
  ListOrdered,
  BookOpen,
  Plug,
  Settings,
  Wand2,
  FolderOpen,
  Menu,
  ChevronRight,
  Terminal,
} from 'lucide-react';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { ProjectSwitcher } from '@/components/project-switcher';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onAddProject: () => void;
  projectRefreshKey?: number;
}

const mainNav = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'specs', label: 'Specs', icon: FileText },
  { id: 'queue', label: 'Queue', icon: ListOrdered },
  { id: 'skills', label: 'Skills', icon: Wand2 },
  { id: 'reports', label: 'Reports', icon: BookOpen },
  { id: 'knowledge', label: 'Knowledge', icon: BookOpen },
];

const manageNav = [
  { id: 'projects', label: 'Projects', icon: FolderOpen },
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'settings', label: 'Settings', icon: Settings },
];

function NavItem({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  id: string;
  label: string;
  icon: any;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'tap-shrink flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200',
        active
          ? 'bg-primary text-primary-foreground shadow-md shadow-primary/10 font-semibold'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
      {active && <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-60" />}
    </button>
  );
}

export function Sidebar({
  activeTab,
  onTabChange,
  onAddProject,
  projectRefreshKey,
}: SidebarProps) {
  const handleNavClick = (tab: string) => {
    onTabChange(tab);
  };

  return (
    <aside className="hidden md:flex md:h-screen md:w-64 md:flex-col md:border-r md:border-border/60 md:bg-sidebar/40 md:backdrop-blur-md md:text-sidebar-foreground">
      <div className="flex items-center gap-3 px-6 py-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
          <Factory className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-bold tracking-tight">Factory</p>
          <p className="text-[10px] text-muted-foreground font-medium tracking-wide uppercase">Build Engine</p>
        </div>
      </div>

      <Separator className="opacity-60" />

      <div className="px-4 py-4">
        <ProjectSwitcher onAddProject={onAddProject} refreshKey={projectRefreshKey} />
      </div>

      <Separator className="opacity-60" />

      <nav className="flex-1 overflow-y-auto px-4 py-4 space-y-1.5 scrollbar-thin">
        {mainNav.map((item) => (
          <NavItem
            key={item.id}
            {...item}
            active={activeTab === item.id}
            onClick={() => handleNavClick(item.id)}
          />
        ))}

        <div className="pt-4 pb-2">
          <p className="px-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
            Configure
          </p>
        </div>

        {manageNav.map((item) => (
          <NavItem
            key={item.id}
            {...item}
            active={activeTab === item.id}
            onClick={() => handleNavClick(item.id)}
          />
        ))}
      </nav>

      <div className="border-t border-border/60 px-5 py-4 flex items-center justify-between bg-muted/20">
        <p className="text-[10px] font-mono text-muted-foreground font-semibold">factory v1.1.0</p>
        <ThemeToggle />
      </div>
    </aside>
  );
}

export function MobileNav({
  activeTab,
  onTabChange,
  onAddProject,
  projectRefreshKey,
}: {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onAddProject: () => void;
  projectRefreshKey?: number;
}) {
  const [open, setOpen] = useState(false);

  const primaryTabs = [
    { id: 'dashboard', icon: LayoutDashboard, label: 'Home' },
    { id: 'specs', icon: FileText, label: 'Specs' },
    { id: 'queue', icon: ListOrdered, label: 'Queue' },
    { id: 'skills', icon: Wand2, label: 'Skills' },
  ];

  const moreTabs = [
    { id: 'reports', icon: BookOpen, label: 'Reports', desc: 'Build reports and telemetry' },
    { id: 'knowledge', icon: BookOpen, label: 'Knowledge', desc: 'AI agent conventions & bridge' },
    { id: 'projects', icon: FolderOpen, label: 'Projects', desc: 'Switch or connect codebases' },
    { id: 'integrations', icon: Plug, label: 'Integrations', desc: 'Connect third-party web services' },
    { id: 'settings', icon: Settings, label: 'Settings', desc: 'Builder preferences & system' },
  ];

  const handleTabClick = (tab: string) => {
    onTabChange(tab);
    setOpen(false);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 flex h-16 border-t border-border/50 bg-background/80 backdrop-blur-xl md:hidden pb-safe">
      <div className="flex w-full items-center justify-around px-2">
        {primaryTabs.map((item) => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={cn(
              'tap-shrink flex flex-col items-center justify-center gap-1 py-2 px-3 min-w-[64px] rounded-xl transition-all',
              activeTab === item.id ? 'text-primary font-bold' : 'text-muted-foreground'
            )}
          >
            <item.icon className={cn("h-5 w-5 transition-transform", activeTab === item.id && "scale-110")} />
            <span className="text-[10px] font-medium tracking-tight">{item.label}</span>
          </button>
        ))}

        {/* Unified Mobile Bottom Sheet Trigger */}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button
              className={cn(
                'tap-shrink flex flex-col items-center justify-center gap-1 py-2 px-3 min-w-[64px] rounded-xl transition-all',
                moreTabs.some(t => t.id === activeTab) ? 'text-primary font-bold' : 'text-muted-foreground'
              )}
            >
              <Menu className={cn("h-5 w-5 transition-transform", open && "rotate-90 scale-110")} />
              <span className="text-[10px] font-medium tracking-tight">More</span>
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="rounded-t-3xl border-t border-border/50 px-4 pt-6 pb-8 max-h-[85vh] overflow-y-auto bg-background/95 backdrop-blur-xl">
            <SheetHeader className="mb-6 flex flex-row items-center justify-between space-y-0">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-md shadow-primary/10">
                  <Factory className="h-4 w-4" />
                </div>
                <div>
                  <SheetTitle className="text-sm font-bold text-left">Factory Command Centre</SheetTitle>
                  <p className="text-[10px] text-muted-foreground text-left">Manage codebases and extensions</p>
                </div>
              </div>
              <ThemeToggle />
            </SheetHeader>

            <div className="space-y-6">
              {/* Project selector directly in bottom drawer */}
              <div className="rounded-2xl border border-border/50 bg-muted/30 p-3">
                <div className="flex items-center gap-2 mb-2 px-1">
                  <FolderOpen className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-bold text-foreground">Connected Workspace</span>
                </div>
                <ProjectSwitcher onAddProject={() => { setOpen(false); onAddProject(); }} refreshKey={projectRefreshKey} />
              </div>

              {/* Remaining pages organized in elegant clickable cards */}
              <div className="grid grid-cols-1 gap-2.5">
                {moreTabs.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleTabClick(item.id)}
                      className={cn(
                        'tap-shrink flex w-full items-center gap-4 rounded-2xl p-3 border text-left transition-all duration-200',
                        isActive
                          ? 'bg-primary/5 border-primary/30 text-foreground ring-1 ring-primary/20'
                          : 'bg-card border-border/40 text-muted-foreground hover:bg-muted/40'
                      )}
                    >
                      <div className={cn(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                        isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                      )}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn("text-xs font-bold", isActive ? "text-primary" : "text-foreground")}>{item.label}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{item.desc}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                    </button>
                  );
                })}
              </div>
              
              <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground px-2 pt-2 border-t">
                <span>SYSTEM CORE v1.1</span>
                <span className="flex items-center gap-1"><Terminal className="h-3 w-3" /> ONLINE</span>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
