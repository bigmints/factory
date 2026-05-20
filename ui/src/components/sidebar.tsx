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
  { id: 'stories', label: 'Stories', icon: FileText },
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
        'tap-shrink flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-200',
        active
          ? 'bg-primary text-primary-foreground shadow-sm font-semibold'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
      {active && <ChevronRight className="ml-auto h-3.5 w-3.5" />}
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
    <aside className="hidden md:flex md:h-screen md:w-64 md:flex-col md:border-r md:border-border md:bg-sidebar md:text-sidebar-foreground">
      <div className="flex items-center gap-3 px-6 py-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
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

      <div className="border-t border-border px-5 py-4 flex items-center justify-between bg-muted">
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

  return (
    <>
      {/* Top Mobile Header */}
      <header className="fixed top-0 left-0 right-0 z-40 flex h-16 border-b border-border bg-background/80 backdrop-blur-md md:hidden items-center justify-between px-4">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button className="tap-shrink flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted/30 hover:bg-accent text-foreground focus:outline-none">
              <Menu className="h-5 w-5" />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[280px] sm:w-[320px] p-0 flex flex-col h-full bg-background border-r border-border">
            <div className="flex items-center gap-3 px-6 py-5 shrink-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
                <Factory className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-bold tracking-tight text-foreground">Factory</p>
                <p className="text-[10px] text-muted-foreground font-medium tracking-wide uppercase">Build Engine</p>
              </div>
            </div>

            <Separator className="opacity-60 shrink-0" />

            <div className="px-4 py-4 shrink-0">
              <ProjectSwitcher 
                onAddProject={() => { 
                  setOpen(false); 
                  onAddProject(); 
                }} 
                refreshKey={projectRefreshKey} 
              />
            </div>

            <Separator className="opacity-60 shrink-0" />

            <nav className="flex-1 overflow-y-auto px-4 py-4 space-y-1.5 scrollbar-thin">
              {mainNav.map((item) => (
                <NavItem
                  key={item.id}
                  {...item}
                  active={activeTab === item.id}
                  onClick={() => {
                    onTabChange(item.id);
                    setOpen(false);
                  }}
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
                  onClick={() => {
                    if (item.id === 'projects') {
                      onAddProject();
                    } else {
                      onTabChange(item.id);
                    }
                    setOpen(false);
                  }}
                />
              ))}
            </nav>

            <div className="border-t border-border px-5 py-4 flex items-center justify-between bg-muted shrink-0">
              <p className="text-[10px] font-mono text-muted-foreground font-semibold">factory v1.1.0</p>
              <div className="flex items-center gap-1.5 text-[9px] font-bold font-mono text-muted-foreground uppercase">
                <Terminal className="h-3 w-3" /> ONLINE
              </div>
            </div>
          </SheetContent>
        </Sheet>

        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Factory className="h-4 w-4" />
          </div>
          <span className="font-bold text-sm tracking-tight text-foreground">Factory</span>
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
        </div>
      </header>
    </>
  );
}
