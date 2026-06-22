"use client"

import * as React from "react"
import {
  Factory,
  LayoutDashboard,
  Brain,
  Wand2,
  FolderOpen,
  Plug,
  Settings,
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
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar"

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  activeTab?: string
  onTabChange?: (tab: string) => void
  onAddProject?: () => void
  projectRefreshKey?: number
  queueRunning?: boolean
  hasLoopWarning?: boolean
}

const navMain = [
  { title: "Stories", id: "plan",   icon: LayoutDashboard },
  { title: "Knowledge",  id: "knowledge", icon: Brain },
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
  queueRunning = false,
  hasLoopWarning = false,
  ...props
}: AppSidebarProps) {
  const { setOpenMobile } = useSidebar()

  const handleTabChange = (tab: string) => {
    onTabChange(tab)
    setOpenMobile(false)
  }

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
          onSelect={handleTabChange}
          queueRunning={queueRunning}
          hasLoopWarning={hasLoopWarning}
        />
        <SidebarSeparator />
        <NavSecondary
          label="Configure"
          items={navSecondary}
          activeId={activeTab}
          onSelect={handleTabChange}
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
