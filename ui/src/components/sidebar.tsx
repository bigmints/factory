'use client';

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
} from 'lucide-react';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetClose,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { ProjectSwitcher } from '@/components/project-switcher';
import { Button } from '@/components/ui/button';

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
  id,
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
        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
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
    <>
      {/* Desktop sidebar — always visible */}
      <aside className="hidden md:flex md:h-screen md:w-60 md:flex-col md:border-r md:border-border md:bg-sidebar md:text-sidebar-foreground">
        <div className="flex items-center gap-3 px-5 py-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Factory className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">Factory</p>
            <p className="text-[11px] text-muted-foreground">Autonomous Builder</p>
          </div>
        </div>

        <Separator />

        <div className="px-3 py-3">
          <ProjectSwitcher onAddProject={onAddProject} refreshKey={projectRefreshKey} />
        </div>

        <Separator />

        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
          {mainNav.map((item) => (
            <NavItem
              key={item.id}
              {...item}
              active={activeTab === item.id}
              onClick={() => handleNavClick(item.id)}
            />
          ))}

          <div className="pt-3 pb-1">
            <p className="px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
              Manage
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

        <div className="border-t border-border px-4 py-3 flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">factory v1.0.0</p>
          <ThemeToggle />
        </div>
      </aside>

      {/* Mobile sidebar — Sheet drawer */}
      <Sheet>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="fixed left-4 top-4 z-50 h-9 w-9 md:hidden"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="4" x2="20" y1="12" y2="12" />
              <line x1="4" x2="20" y1="6" y2="6" />
              <line x1="4" x2="20" y1="18" y2="18" />
            </svg>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-[280px] sm:w-[300px] p-0">
          <div className="flex h-screen flex-col">
            <div className="flex items-center gap-3 px-5 py-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Factory className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold tracking-tight">Factory</p>
                <p className="text-[11px] text-muted-foreground">Autonomous Builder</p>
              </div>
            </div>

            <Separator />

            <div className="px-3 py-3">
              <ProjectSwitcher onAddProject={onAddProject} refreshKey={projectRefreshKey} />
            </div>

            <Separator />

            <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
              {mainNav.map((item) => (
                <SheetClose key={item.id} asChild>
                  <NavItem
                    {...item}
                    active={activeTab === item.id}
                    onClick={() => handleNavClick(item.id)}
                  />
                </SheetClose>
              ))}

              <div className="pt-3 pb-1">
                <p className="px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                  Manage
                </p>
              </div>

              {manageNav.map((item) => (
                <SheetClose key={item.id} asChild>
                  <NavItem
                    {...item}
                    active={activeTab === item.id}
                    onClick={() => handleNavClick(item.id)}
                  />
                </SheetClose>
              ))}
            </nav>

            <div className="border-t border-border px-5 py-3 flex items-center justify-between">
              <p className="text-[11px] text-muted-foreground">factory v1.0.0</p>
              <ThemeToggle />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

// Mobile bottom navigation bar
export function MobileNav({
  activeTab,
  onTabChange,
}: {
  activeTab: string;
  onTabChange: (tab: string) => void;
}) {
  const tabs = [
    { id: 'dashboard', icon: LayoutDashboard, label: 'Home' },
    { id: 'specs', icon: FileText, label: 'Specs' },
    { id: 'queue', icon: ListOrdered, label: 'Queue' },
    { id: 'skills', icon: Wand2, label: 'Skills' },
    { id: 'settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 flex h-14 border-t border-border bg-background/95 backdrop-blur-sm md:hidden">
      <div className="flex w-full items-center justify-around px-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={cn(
              'flex flex-col items-center gap-0.5 py-1.5 px-3 min-w-[56px] transition-all',
              activeTab === item.id ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            <item.icon className="h-5 w-5" />
            <span className="text-[10px] font-medium">{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
