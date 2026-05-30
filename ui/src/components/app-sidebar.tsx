"use client"

import * as React from "react"
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

import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { ProjectSwitcher } from "@/components/project-switcher"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  activeTab?: string
  onTabChange?: (tab: string) => void
  onAddProject?: () => void
  projectRefreshKey?: number
}

const navMain = [
  { title: "Stories", id: "plan",   icon: LayoutDashboard },
  { title: "Build Pipeline",  id: "build",  icon: Rocket },
  { title: "Validation Gates",id: "test",   icon: FlaskConical },
  { title: "Deploy Workspace",id: "deploy", icon: Globe },
]

const navAnalytics = [
  { title: "Analytics Reports", id: "reports",   icon: BarChart3 },
  { title: "ADRs & Knowledge",  id: "knowledge", icon: Brain },
]

const navSecondary = [
  { title: "Custom Skills",     id: "skills",       icon: Wand2 },
  { title: "Active Projects",   id: "projects",     icon: FolderOpen },
  { title: "Integrations",      id: "integrations", icon: Plug },
  { title: "System Settings",   id: "settings",     icon: Settings },
]

export function AppSidebar({
  activeTab = "plan",
  onTabChange = () => {},
  onAddProject = () => {},
  projectRefreshKey,
  ...props
}: AppSidebarProps) {
  return (
    <Sidebar variant="sidebar" {...props}>
      {/* Header: logo + project switcher */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <div className="cursor-default">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Factory className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Factory</span>
                  <span className="truncate text-xs">Build Engine</span>
                </div>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <ProjectSwitcher onAddProject={onAddProject} refreshKey={projectRefreshKey} />
      </SidebarHeader>

      <SidebarContent>
        <NavMain
          label="Workflow"
          items={navMain}
          activeId={activeTab}
          onSelect={onTabChange}
        />
        <NavMain
          label="Analytics"
          items={navAnalytics}
          activeId={activeTab}
          onSelect={onTabChange}
        />
        <NavSecondary
          label="Configure"
          items={navSecondary}
          activeId={activeTab}
          onSelect={onTabChange}
          className="mt-auto"
        />
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-xs text-muted-foreground font-mono">v1.1.0</span>
              <ThemeToggle />
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
