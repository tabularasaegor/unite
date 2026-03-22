import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  BarChart3,
  Crosshair,
  History,
  Brain,
  Settings,
  Sun,
  Moon,
  Activity,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/markets", label: "Markets", icon: BarChart3 },
  { href: "/positions", label: "Positions", icon: Crosshair },
  { href: "/trades", label: "Trades", icon: History },
  { href: "/predictions", label: "AI Predictions", icon: Brain },
  { href: "/settings", label: "Settings", icon: Settings },
];

interface AppSidebarProps {
  theme: "light" | "dark";
  toggleTheme: () => void;
}

export default function AppSidebar({ theme, toggleTheme }: AppSidebarProps) {
  const [location] = useLocation();

  return (
    <aside className="flex flex-col w-56 border-r border-border bg-sidebar h-screen" data-testid="sidebar">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-border">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary">
          <Activity className="w-4.5 h-4.5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-foreground tracking-tight leading-none">AlgoTrader</h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">AI Ensemble Bot</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href}>
              <div
                className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm cursor-pointer transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
                data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {item.label}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Bottom controls */}
      <div className="px-3 py-3 border-t border-border">
        <button
          onClick={toggleTheme}
          className="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors w-full"
          data-testid="theme-toggle"
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          {theme === "dark" ? "Light Mode" : "Dark Mode"}
        </button>
      </div>
    </aside>
  );
}
