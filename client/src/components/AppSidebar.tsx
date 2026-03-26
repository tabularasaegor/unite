import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Scan,
  Search,
  ShieldCheck,
  Play,
  Eye,
  BookOpen,
  Settings,
  Sun,
  Moon,
  Activity,
  ScrollText,
  FileBarChart,
  Zap,
  Gauge,
} from "lucide-react";

const pipelineItems = [
  { href: "/", label: "Дашборд", icon: LayoutDashboard },
  { href: "/scanner", label: "Сканер рынков", icon: Scan },
  { href: "/opportunities", label: "Возможности", icon: Search },
  { href: "/risk-console", label: "Риск-консоль", icon: ShieldCheck },
  { href: "/positions", label: "Позиции", icon: Play },
  { href: "/trades", label: "Сделки", icon: FileBarChart },
  { href: "/settlements", label: "Расчёты", icon: Eye },
  { href: "/post-mortems", label: "Пост-мортем", icon: BookOpen },
];

const microItems = [
  { href: "/micro", label: "Панель управления", icon: Gauge },
  { href: "/micro/positions", label: "Позиции", icon: Play },
  { href: "/micro/trades", label: "Сделки", icon: FileBarChart },
  { href: "/micro/settlements", label: "Расчёты", icon: Eye },
];

const bottomItems = [
  { href: "/audit-log", label: "Аудит", icon: ScrollText },
  { href: "/settings", label: "Настройки", icon: Settings },
];

interface AppSidebarProps {
  theme: "light" | "dark";
  toggleTheme: () => void;
}

function NavItem({ item, location }: { item: { href: string; label: string; icon: any }; location: string }) {
  // Exact match for most items. Only /opportunities allows prefix matching
  // for its detail pages (/opportunities/123). This prevents /micro from
  // lighting up when on /micro/positions, etc.
  const active = location === item.href ||
    (item.href === "/opportunities" && location.startsWith("/opportunities/"));
  const Icon = item.icon;
  return (
    <Link href={item.href}>
      <div
        className={`flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm cursor-pointer transition-colors ${
          active
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
}

export default function AppSidebar({ theme, toggleTheme }: AppSidebarProps) {
  const [location] = useLocation();

  return (
    <aside className="flex flex-col w-56 border-r border-border bg-sidebar h-screen flex-shrink-0" data-testid="sidebar">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-border">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary">
          <Activity className="w-4.5 h-4.5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-foreground tracking-tight leading-none">AlgoTrader</h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">AI Prediction Platform</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 overflow-y-auto">
        {/* Pipeline section */}
        <div className="px-3 mb-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Пайплайн</span>
        </div>
        <div className="space-y-0.5 mb-4">
          {pipelineItems.map((item) => (
            <NavItem key={item.href} item={item} location={location} />
          ))}
        </div>

        {/* Micro section */}
        <div className="px-3 mb-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1">
            <Zap className="w-3 h-3 text-amber-500" /> Крипто 5-мин
          </span>
        </div>
        <div className="space-y-0.5 mb-4">
          {microItems.map((item) => (
            <NavItem key={item.href} item={item} location={location} />
          ))}
        </div>

        {/* Separator */}
        <div className="mx-3 border-t border-border mb-3" />

        {/* Bottom items */}
        <div className="space-y-0.5">
          {bottomItems.map((item) => (
            <NavItem key={item.href} item={item} location={location} />
          ))}
        </div>
      </nav>

      {/* Bottom controls */}
      <div className="px-3 py-3 border-t border-border space-y-1">
        <button
          onClick={toggleTheme}
          className="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors w-full"
          data-testid="theme-toggle"
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          {theme === "dark" ? "Светлая тема" : "Тёмная тема"}
        </button>

      </div>
    </aside>
  );
}
