import * as React from "react"
import { type LucideIcon } from "lucide-react"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function NavSecondary({
  label,
  items,
  activeId,
  onSelect,
  ...props
}: {
  label: string
  items: { title: string; id: string; icon: LucideIcon }[]
  activeId: string
  onSelect: (id: string) => void
} & Omit<React.ComponentPropsWithoutRef<typeof SidebarGroup>, 'onSelect'>) {
  return (
    <SidebarGroup {...props}>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.id}>
              <SidebarMenuButton
                size="sm"
                tooltip={item.title}
                isActive={activeId === item.id}
                onClick={() => onSelect(item.id)}
              >
                <item.icon />
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
