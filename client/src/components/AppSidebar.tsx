import { useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth-context";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  Search,
  Lightbulb,
  Shield,
  Briefcase,
  ArrowLeftRight,
  CheckCircle,
  BookOpen,
  Zap,
  Target,
  TrendingUp,
  Award,
  FlaskConical,
  ScrollText,
  Settings,
  Moon,
  Sun,
  LogOut,
} from "lucide-react";
import { useState, useEffect } from "react";

const pipelineItems = [
  { label: "Дашборд", href: "/pipeline", icon: LayoutDashboard },
  { label: "Сканер", href: "/pipeline/scanner", icon: Search },
  { label: "Возможности", href: "/pipeline/opportunities", icon: Lightbulb },
  { label: "Риск-консоль", href: "/pipeline/risk", icon: Shield },
  { label: "Позиции", href: "/pipeline/positions", icon: Briefcase },
  { label: "Сделки", href: "/pipeline/trades", icon: ArrowLeftRight },
  { label: "Расчёты", href: "/pipeline/settlements", icon: CheckCircle },
  { label: "Пост-мортем", href: "/pipeline/postmortems", icon: BookOpen },
];

const microItems = [
  { label: "Панель управления", href: "/micro", icon: Zap },
  { label: "Позиции", href: "/micro/positions", icon: Target },
  { label: "Сделки", href: "/micro/trades", icon: TrendingUp },
  { label: "Расчёты", href: "/micro/settlements", icon: Award },
  { label: "Бэктестинг", href: "/backtest", icon: FlaskConical },
];

const bottomItems = [
  { label: "Аудит", href: "/audit", icon: ScrollText },
  { label: "Настройки", href: "/settings", icon: Settings },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { logout } = useAuth();
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    if (next) {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.classList.add("light");
    }
  };

  const handleLogout = async () => {
    await logout();
  };

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-4">
        <Link href="/">
          <div className="flex items-center gap-2 cursor-pointer" data-testid="logo-link">
            <svg
              width="28"
              height="28"
              viewBox="0 0 28 28"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-label="AlgoTrader"
            >
              <rect width="28" height="28" rx="6" fill="currentColor" className="text-primary" />
              <path
                d="M6 20L10 12L14 16L18 8L22 14"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="10" cy="12" r="1.5" fill="white" />
              <circle cx="18" cy="8" r="1.5" fill="white" />
            </svg>
            <div>
              <span className="font-semibold text-sm tracking-tight">AlgoTrader</span>
              <span className="text-[10px] ml-1.5 text-muted-foreground font-mono">v3</span>
            </div>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {/* Pipeline section */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
            Пайплайн
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {pipelineItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.href}
                    tooltip={item.label}
                  >
                    <Link href={item.href} data-testid={`nav-${item.href.replace(/\//g, "-")}`}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        {/* Micro section */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
            Крипто 5-мин
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {microItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.href}
                    tooltip={item.label}
                  >
                    <Link href={item.href} data-testid={`nav-${item.href.replace(/\//g, "-")}`}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarSeparator />
        <SidebarMenu>
          {bottomItems.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                asChild
                isActive={location === item.href}
                tooltip={item.label}
              >
                <Link href={item.href} data-testid={`nav-${item.href.replace(/\//g, "-")}`}>
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
          <SidebarMenuItem>
            <SidebarMenuButton onClick={toggleTheme} tooltip="Тема" data-testid="button-theme-toggle">
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span>{isDark ? "Светлая тема" : "Тёмная тема"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleLogout} tooltip="Выйти" data-testid="button-logout">
              <LogOut className="h-4 w-4" />
              <span>Выйти</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

export function MobileHeader() {
  return (
    <div className="flex items-center gap-2 p-3 border-b border-border md:hidden">
      <SidebarTrigger data-testid="button-mobile-menu" />
      <span className="font-semibold text-sm">AlgoTrader</span>
      <span className="text-[10px] text-muted-foreground font-mono">v3</span>
    </div>
  );
}
