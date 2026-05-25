"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import {
  Factory,
  LayoutDashboard,
  Plug,
  Settings,
  Wand2,
  FolderOpen,
  Rocket,
  FlaskConical,
  Globe,
  Brain,
  BarChart3,
} from "lucide-react"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { ProjectSwitcher } from "@/components/project-switcher"
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onAddProject: () => void;
  projectRefreshKey?: number;
}

// ─── SDLC primary workflow nav ───
const sdlcNav = [
  { id: 'plan',   label: 'Plan',   icon: LayoutDashboard },
  { id: 'build',  label: 'Build',  icon: Rocket },
  { id: 'test',   label: 'Test',   icon: FlaskConical },
  { id: 'deploy', label: 'Deploy', icon: Globe },
]

// ─── Secondary / analytics nav ───
const secondaryNav = [
  { id: 'reports',   label: 'Reports',   icon: BarChart3 },
  { id: 'knowledge', label: 'Knowledge', icon: Brain },
]

// ─── Configure nav ───
const manageNav = [
  { id: 'skills',       label: 'Skills',       icon: Wand2 },
  { id: 'projects',     label: 'Projects',     icon: FolderOpen },
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'settings',     label: 'Settings',     icon: Settings },
]

export function Sidebar({
  activeTab,
  onTabChange,
  onAddProject,
  projectRefreshKey,
}: SidebarProps) {
  const { state } = useSidebar()

  return (
    <ShadcnSidebar collapsible="icon" className="border-r border-border bg-sidebar text-sidebar-foreground">
      {/* Header with Logo */}
      <SidebarHeader className="border-b border-border/40 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Factory className="h-4 w-4" />
          </div>
          {state !== "collapsed" && (
            <div>
              <p className="text-sm font-bold tracking-tight">Factory</p>
              <p className="text-[10px] text-muted-foreground font-medium tracking-wide uppercase">Build Engine</p>
            </div>
          )}
        </div>
        
        {state !== "collapsed" && (
          <div className="mt-4">
            <ProjectSwitcher onAddProject={onAddProject} refreshKey={projectRefreshKey} />
          </div>
        )}
      </SidebarHeader>

      <SidebarContent className="px-2 py-4">
        {/* SDLC workflow */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">Workflow</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {sdlcNav.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={activeTab === item.id}
                    onClick={() => onTabChange(item.id)}
                    tooltip={item.label}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Reports & Knowledge */}
        <SidebarGroup className="mt-2">
          <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">Analytics</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {secondaryNav.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={activeTab === item.id}
                    onClick={() => onTabChange(item.id)}
                    tooltip={item.label}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Configure section */}
        <SidebarGroup className="mt-2">
          <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">Configure</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {manageNav.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={activeTab === item.id}
                    onClick={() => onTabChange(item.id)}
                    tooltip={item.label}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-border/40 p-4">
        {state !== "collapsed" ? (
          <div className="flex items-center justify-between w-full">
            <p className="text-[10px] font-mono text-muted-foreground font-semibold">factory v1.1.0</p>
            <ThemeToggle />
          </div>
        ) : (
          <div className="flex justify-center w-full">
            <ThemeToggle />
          </div>
        )}
      </SidebarFooter>
      <SidebarRail />
    </ShadcnSidebar>
  )
}
