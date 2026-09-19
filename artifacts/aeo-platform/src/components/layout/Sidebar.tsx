import { Link, useLocation, useSearch } from "wouter";
import { 
  Home, 
  BarChart2, 
  MessageSquare, 
  Search, 
  Globe, 
  Link2, 
  TrendingUp, 
  Settings, 
  UserCircle,
  Briefcase,
  BookOpen,
  Zap,
  Target,
  LineChart,
  ShieldCheck
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ProductLogo } from "./ProductLogo";

interface NavItem {
  label: string;
  href: string;
  icon: typeof Home;
  badge?: string;
}

interface NavGroup {
  label?: string;
  badge?: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { label: "Dashboard", href: "/", icon: BarChart2 },
      { label: "Home", href: "/home", icon: Home },
      { label: "Overview", href: "/overview", icon: TrendingUp },
      { label: "Progress", href: "/progress", icon: LineChart },
    ]
  },
  {
    label: "Brand",
    items: [
      { label: "Insights", href: "/insights", icon: Zap },
      { label: "Brand Audit", href: "/audit", icon: ShieldCheck },
      { label: "Perception", href: "/perception", icon: Target, badge: "Beta" },
    ]
  },
  {
    label: "Prompts",
    items: [
      { label: "All prompts", href: "/prompts", icon: MessageSquare },
      { label: "Discovery", href: "/discovery", icon: Search },
    ]
  },
  {
    label: "Sources",
    items: [
      { label: "Gap Analysis", href: "/gap-analysis", icon: TrendingUp },
      { label: "Domains", href: "/domains", icon: Globe },
      { label: "URLs", href: "/urls", icon: Link2 },
    ]
  },
  {
    label: "Actions",
    badge: "Beta",
    items: [
      { label: "Earned · Off-page", href: "/signals?category=off_page", icon: Globe },
      { label: "Owned · On-page", href: "/signals?category=on_page", icon: Briefcase },
    ]
  },
  {
    items: [
      { label: "Site Lab", href: "/lab", icon: Target },
      { label: "All chats", href: "/chats", icon: MessageSquare },
    ]
  }
];

export function Sidebar() {
  return (
    <aside className="hidden md:flex w-[240px] flex-col border-r border-border bg-fog h-screen sticky top-0 shrink-0">
      <div className="h-14 flex items-center px-4 shrink-0">
        <ProductLogo size={17} />
      </div>
      <SidebarNav />
    </aside>
  );
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  const search = useSearch();
  const current = search ? `${location}?${search}` : location;

  const isActive = (href: string) => {
    if (href.includes("?")) return current === href;
    return location === href || (href !== "/" && location.startsWith(href));
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {NAV_GROUPS.map((group, i) => (
          <div key={i} className="space-y-1">
            {group.label && (
              <div className="px-2 text-[11px] font-medium text-ash uppercase tracking-widest mb-2 flex items-center justify-between">
                {group.label}
                {group.badge && <span className="text-[9px] bg-mist px-1.5 py-0.5 rounded-full text-slate-quiet">{group.badge}</span>}
              </div>
            )}
            {group.items.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center justify-between px-2.5 py-1.5 rounded-full text-[13px] font-normal m1-sidebar-link group",
                    active ? "bg-[rgba(23,25,28,0.05)] text-foreground font-medium" : "text-slate-quiet"
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className={cn("w-4 h-4", active ? "text-foreground" : "text-smoke group-hover:text-foreground")} strokeWidth={1.5} />
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
                    <span className="text-[9px] font-medium tracking-wider text-ash uppercase">{item.badge}</span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
      <div className="p-3 border-t border-border shrink-0 space-y-1">
        <Link href="/settings" onClick={onNavigate} className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-full text-[13px] font-normal text-slate-quiet m1-sidebar-link group">
          <Settings className="w-4 h-4 group-hover:text-foreground" strokeWidth={1.5} />
          <span>Settings</span>
        </Link>
        <Link href="/settings/case-studies" onClick={onNavigate} data-testid="link-case-studies" className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-full text-[13px] font-normal text-slate-quiet m1-sidebar-link group">
          <BookOpen className="w-4 h-4 group-hover:text-foreground" strokeWidth={1.5} />
          <span>Case Studies</span>
        </Link>
        <button className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-full text-[13px] font-normal text-foreground m1-sidebar-link group mt-2">
          <UserCircle className="w-4 h-4" />
          <span className="flex-1 text-left">Workspace user</span>
        </button>
      </div>
    </>
  );
}
