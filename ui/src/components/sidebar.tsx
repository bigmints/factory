'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Factory,
  LayoutDashboard,
  Plug,
  Settings,
  Wand2,
  FolderOpen,
  Menu,
  ChevronLeft,
  ChevronRight,
  Terminal,
  Rocket,
  FlaskConical,
  Globe,
  Brain,
  BarChart3,
  MoreHorizontal,
  X,
  Sparkles,
} from 'lucide-react';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { ProjectSwitcher } from '@/components/project-switcher';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onAddProject: () => void;
  projectRefreshKey?: number;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  tpmChatOpen?: boolean;
  onToggleTpmChat?: () => void;
}

// ─── SDLC primary workflow nav ───
const sdlcNav = [
  { id: 'plan',   label: 'Plan',   icon: LayoutDashboard },
  { id: 'build',  label: 'Build',  icon: Rocket },
  { id: 'test',   label: 'Test',   icon: FlaskConical },
  { id: 'deploy', label: 'Deploy', icon: Globe },
];


// ─── Secondary / analytics nav ───
const secondaryNav = [
  { id: 'reports',   label: 'Reports',   icon: BarChart3 },
  { id: 'knowledge', label: 'Knowledge', icon: Brain },
];

// ─── Configure nav ───
const manageNav = [
  { id: 'skills',       label: 'Skills',       icon: Wand2 },
  { id: 'projects',     label: 'Projects',     icon: FolderOpen },
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'settings',     label: 'Settings',     icon: Settings },
];

function NavItem({
  label,
  icon: Icon,
  active,
  onClick,
  isCollapsed,
}: {
  id: string;
  label: string;
  icon: any;
  active: boolean;
  onClick: () => void;
  isCollapsed?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={isCollapsed ? label : undefined}
      className={cn(
        'tap-shrink flex items-center justify-start rounded-lg transition-all duration-200',
        isCollapsed ? 'w-10 h-10 justify-center p-0 mx-auto' : 'w-full gap-3 px-4 py-2.5 text-sm font-medium',
        active
          ? 'bg-primary text-primary-foreground shadow-sm font-semibold'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      <Icon className={cn("shrink-0", isCollapsed ? "h-5 w-5" : "h-4 w-4")} />
      {!isCollapsed && <span className="truncate">{label}</span>}
      {!isCollapsed && active && <ChevronRight className="ml-auto h-3.5 w-3.5" />}
    </button>
  );
}

function SectionLabel({ label, isCollapsed }: { label: string; isCollapsed?: boolean }) {
  if (isCollapsed) return <div className="py-2"><Separator className="opacity-40" /></div>;
  return (
    <div className="pt-4 pb-1.5">
      <p className="px-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">{label}</p>
    </div>
  );
}

export function Sidebar({
  activeTab,
  onTabChange,
  onAddProject,
  projectRefreshKey,
  isCollapsed = false,
  onToggleCollapse,
  tpmChatOpen,
  onToggleTpmChat,
}: SidebarProps) {
  return (
    <aside className={cn(
      "hidden md:flex md:h-screen md:flex-col md:border-r md:border-border md:bg-sidebar md:text-sidebar-foreground transition-all duration-300",
      isCollapsed ? "md:w-16" : "md:w-60"
    )}>
      {/* Logo */}
      <div className={cn("flex items-center px-6 py-5", isCollapsed && "px-0 justify-center")}>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Factory className="h-4 w-4" />
          </div>
          {!isCollapsed && (
            <div>
              <p className="text-sm font-bold tracking-tight">Factory</p>
              <p className="text-[10px] text-muted-foreground font-medium tracking-wide uppercase">Build Engine</p>
            </div>
          )}
        </div>
      </div>

      {!isCollapsed && (
        <>
          <Separator className="opacity-60" />
          <div className="px-4 py-4">
            <ProjectSwitcher onAddProject={onAddProject} refreshKey={projectRefreshKey} />
          </div>
        </>
      )}

      <Separator className="opacity-60" />

      <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-1 scrollbar-thin">
        {/* SDLC workflow */}
        {!isCollapsed && (
          <p className="px-4 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">Workflow</p>
        )}
        {sdlcNav.map((item) => (
          <NavItem
            key={item.id}
            {...item}
            active={activeTab === item.id}
            onClick={() => onTabChange(item.id)}
            isCollapsed={isCollapsed}
          />
        ))}

        {/* Separator before secondary */}
        <div className="py-2"><Separator className="opacity-40" /></div>

        {/* Reports & Knowledge */}
        {secondaryNav.map((item) => (
          <NavItem
            key={item.id}
            {...item}
            active={activeTab === item.id}
            onClick={() => onTabChange(item.id)}
            isCollapsed={isCollapsed}
          />
        ))}

        {/* Configure section */}
        <SectionLabel label="Configure" isCollapsed={isCollapsed} />
        {manageNav.map((item) => (
          <NavItem
            key={item.id}
            {...item}
            active={activeTab === item.id}
            onClick={() => onTabChange(item.id)}
            isCollapsed={isCollapsed}
          />
        ))}
      </nav>

      <div className={cn(
        "border-t border-border px-5 py-4 flex items-center justify-between bg-muted",
        isCollapsed && "px-0 py-3 flex-col gap-4 justify-center"
      )}>
        {!isCollapsed ? (
          <>
            <p className="text-[10px] font-mono text-muted-foreground font-semibold">factory v1.1.0</p>
            <div className="flex items-center gap-3">
              <ThemeToggle />
              {onToggleCollapse && (
                <button
                  onClick={onToggleCollapse}
                  className="p-1 rounded hover:bg-background transition-colors text-muted-foreground hover:text-foreground"
                  title="Collapse sidebar"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <ThemeToggle />
            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                className="p-1 rounded hover:bg-background transition-colors text-muted-foreground hover:text-foreground"
                title="Expand sidebar"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

// ─── Mobile: Top Header + Bottom Tab Bar ─────────────────────────────────────

export function MobileNav({
  activeTab,
  onTabChange,
  onAddProject,
  projectRefreshKey,
  onNewStory,
  tpmChatOpen,
  onToggleTpmChat,
}: {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onAddProject: () => void;
  projectRefreshKey?: number;
  onNewStory?: () => void;
  tpmChatOpen?: boolean;
  onToggleTpmChat?: () => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [fabPressed, setFabPressed] = useState(false);

  const handleNavChange = (tab: string) => {
    if (tab === 'projects') {
      onAddProject();
    } else if (tab === 'tpm') {
      onToggleTpmChat?.();
    } else {
      onTabChange(tab);
    }
    setDrawerOpen(false);
  };

  // Current active label for header title
  const allNavItems = [...sdlcNav, ...secondaryNav, ...manageNav];
  const activeLabel = allNavItems.find(n => n.id === activeTab)?.label ?? 'Factory';
  const ActiveIcon = allNavItems.find(n => n.id === activeTab)?.icon;

  return (
    <>
      {/* ── Mobile Top Header ── */}
      <header className="fixed top-0 left-0 right-0 z-40 flex h-12 border-b border-border/50 bg-background/80 backdrop-blur-xl md:hidden items-center px-3 gap-3">
        {/* Hamburger */}
        <button
          onClick={() => setDrawerOpen(true)}
          className="tap-shrink h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"
          aria-label="Open menu"
        >
          <Menu className="h-[18px] w-[18px]" strokeWidth={2} />
        </button>

        {/* Active tab indicator — icon + label */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {ActiveIcon && <ActiveIcon className="h-4 w-4 text-primary shrink-0" strokeWidth={2.5} />}
          <span className="text-sm font-bold text-foreground truncate">{activeLabel}</span>
        </div>

        <ThemeToggle />
      </header>

      {/* ── FAB — bottom-right, create new story ── */}
      <button
        onPointerDown={() => setFabPressed(true)}
        onPointerUp={() => setFabPressed(false)}
        onPointerLeave={() => setFabPressed(false)}
        onClick={() => onNewStory?.()}
        aria-label="New Story"
        className="fixed z-[60] md:hidden focus:outline-none rounded-full"
        style={{
          bottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
          right: 20,
          width: 56,
          height: 56,
          background: 'linear-gradient(135deg, hsl(262 83% 58%), hsl(210 98% 55%))',
          boxShadow: '0 8px 32px hsl(262 83% 58% / 0.5), 0 2px 8px rgba(0,0,0,0.4)',
          transform: fabPressed ? 'scale(0.88)' : 'scale(1)',
          transition: 'transform 100ms ease',
        }}
      >
        <span className="absolute inset-0 rounded-full bg-white/10 pointer-events-none" />
        <Sparkles className="h-6 w-6 text-white m-auto" strokeWidth={2} />
      </button>

      {/* ── Left Drawer ── */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="left"
          className="w-[80vw] max-w-[320px] p-0 flex flex-col border-r border-border/50 bg-background/98 backdrop-blur-2xl"
        >
          {/* Drawer header */}
          <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-border/30 shrink-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/30">
              <Factory className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold leading-tight">Factory</p>
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">Build Engine</p>
            </div>
          </div>

          {/* Project Switcher */}
          <div className="px-4 py-3 border-b border-border/30 shrink-0">
            <ProjectSwitcher
              onAddProject={() => { setDrawerOpen(false); onAddProject(); }}
              refreshKey={projectRefreshKey}
            />
          </div>

          {/* Nav */}
          <div className="overflow-y-auto flex-1 px-3 py-3">
            {/* SDLC primary */}
            <p className="px-3 pb-2 pt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40">Workflow</p>
              {sdlcNav.map((item) => {
               const Icon = item.icon;
               const isActive = activeTab === item.id;
               return (
                 <button
                   key={item.id}
                   onClick={() => handleNavChange(item.id)}
                   className={cn(
                     'tap-shrink w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all mb-0.5',
                     isActive ? 'bg-primary/12 text-primary font-semibold' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                   )}
                 >
                   <div className={cn(
                     'h-8 w-8 rounded-lg flex items-center justify-center shrink-0 transition-all',
                     isActive ? 'bg-primary/15' : 'bg-muted/50'
                   )}>
                     <Icon className="h-4 w-4" />
                   </div>
                   <span>{item.label}</span>
                   {isActive && (
                     <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                   )}
                 </button>
               );
             })}

            {/* Secondary nav */}
            <p className="px-3 pb-2 pt-5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40">Analytics</p>
            {secondaryNav.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavChange(item.id)}
                  className={cn(
                    'tap-shrink w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all mb-0.5',
                    isActive ? 'bg-primary/12 text-primary font-semibold' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  )}
                >
                  <div className={cn('h-8 w-8 rounded-lg flex items-center justify-center shrink-0', isActive ? 'bg-primary/15' : 'bg-muted/50')}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <span>{item.label}</span>
                  {isActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
                </button>
              );
            })}

            {/* Manage nav */}
            <p className="px-3 pb-2 pt-5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40">Configure</p>
            {manageNav.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id || (item.id === 'projects' && activeTab === 'projects');
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavChange(item.id)}
                  className={cn(
                    'tap-shrink w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all mb-0.5',
                    isActive ? 'bg-primary/12 text-primary font-semibold' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  )}
                >
                  <div className={cn('h-8 w-8 rounded-lg flex items-center justify-center shrink-0', isActive ? 'bg-primary/15' : 'bg-muted/50')}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <span>{item.label}</span>
                  {isActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div
            className="border-t border-border/30 px-5 py-4 flex items-center justify-between bg-muted/10 shrink-0"
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
          >
            <p className="text-[10px] font-mono text-muted-foreground/50 font-semibold">factory v1.1.0</p>
            <div className="flex items-center gap-1.5 text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[9px] font-bold font-mono uppercase">Online</span>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
