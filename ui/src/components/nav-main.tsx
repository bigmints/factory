"use client"

import { type LucideIcon } from "lucide-react"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function NavMain({
  label,
  items,
  activeId,
  onSelect,
  queueRunning,
  hasLoopWarning,
}: {
  label: string
  items: { title: string; id: string; icon: LucideIcon }[]
  activeId: string
  onSelect: (id: string) => void
  queueRunning?: boolean
  hasLoopWarning?: boolean
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.id}>
            <SidebarMenuButton
              tooltip={item.title}
              isActive={activeId === item.id}
              onClick={() => onSelect(item.id)}
            >
              <item.icon />
              <span>{item.title}</span>
              {item.id === 'build' && queueRunning && (
                <span className="ml-auto flex h-2 w-2 relative">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${hasLoopWarning ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${hasLoopWarning ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                </span>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
