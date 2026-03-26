import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";

// ─── KPI Card ────────────────────────────────────────────────────
interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  trend?: "up" | "down" | "neutral";
  className?: string;
  isLoading?: boolean;
  valueClassName?: string;
}

export function KPICard({
  title,
  value,
  subtitle,
  icon,
  trend,
  className,
  isLoading,
  valueClassName,
}: KPICardProps) {
  return (
    <Card className={cn("relative overflow-hidden", className)}>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <div
            className={cn(
              "text-xl font-bold font-mono tabular-nums",
              trend === "up" && "text-emerald-500",
              trend === "down" && "text-red-500",
              valueClassName
            )}
          >
            {value}
          </div>
        )}
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Status Badge ────────────────────────────────────────────────
interface StatusBadgeProps {
  status: string;
  variant?: "default" | "outline";
  className?: string;
}

const statusColors: Record<string, string> = {
  // Position/trade statuses
  open: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  closed: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  filled: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  cancelled: "bg-red-500/20 text-red-400 border-red-500/30",
  // Micro statuses
  active: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  "Активен": "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  cooldown: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  "Кулдаун": "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  disabled: "bg-red-500/20 text-red-400 border-red-500/30",
  "Отключён": "bg-red-500/20 text-red-400 border-red-500/30",
  // Pipeline stages
  scanned: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  researched: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  estimated: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  approved: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  rejected: "bg-red-500/20 text-red-400 border-red-500/30",
  executed: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  settled: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  // Trading types
  paper: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  live: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  // Direction
  Up: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  Down: "bg-red-500/20 text-red-400 border-red-500/30",
  Yes: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  No: "bg-red-500/20 text-red-400 border-red-500/30",
  // Outcomes
  Won: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  Lost: "bg-red-500/20 text-red-400 border-red-500/30",
  won: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  lost: "bg-red-500/20 text-red-400 border-red-500/30",
  // Running statuses
  running: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  stopped: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const colorClass = statusColors[status] || "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono text-xs px-2 py-0.5 border",
        colorClass,
        className
      )}
    >
      {status}
    </Badge>
  );
}

// ─── PnL Display ─────────────────────────────────────────────────
export function PnLDisplay({ value, className }: { value: number | null | undefined; className?: string }) {
  const num = value ?? 0;
  const formatted = num >= 0 ? `+$${num.toFixed(2)}` : `-$${Math.abs(num).toFixed(2)}`;
  return (
    <span
      className={cn(
        "font-mono tabular-nums text-sm font-medium",
        num >= 0 ? "text-emerald-500" : "text-red-500",
        className
      )}
    >
      {formatted}
    </span>
  );
}

// ─── Data Table Wrapper ──────────────────────────────────────────
interface DataTableProps {
  headers: string[];
  children: React.ReactNode;
  isLoading?: boolean;
  emptyMessage?: string;
  isEmpty?: boolean;
}

export function DataTable({
  headers,
  children,
  isLoading,
  emptyMessage = "Нет данных",
  isEmpty,
}: DataTableProps) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((h) => (
              <TableHead key={h} className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                {headers.map((h, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : isEmpty ? (
            <TableRow>
              <TableCell
                colSpan={headers.length}
                className="text-center text-muted-foreground py-8"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            children
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Page Header ─────────────────────────────────────────────────
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

// ─── Log Event Panel ─────────────────────────────────────────────
interface LogEntry {
  id: number;
  event: string;
  asset?: string | null;
  details?: string | null;
  createdAt: string;
}

const eventColors: Record<string, string> = {
  TRADE_OPEN: "bg-sky-500/20 text-sky-400",
  TRADE_SETTLED: "bg-emerald-500/20 text-emerald-400",
  TRADE_LOST: "bg-red-500/20 text-red-400",
  CALIBRATION_AUDIT: "bg-purple-500/20 text-purple-400",
  SKIP: "bg-zinc-500/20 text-zinc-400",
  SCHEDULER_START: "bg-sky-500/20 text-sky-400",
  SCHEDULER_STOP: "bg-yellow-500/20 text-yellow-400",
  WINDOW_OPEN: "bg-cyan-500/20 text-cyan-400",
  WINDOW_CLOSE: "bg-zinc-500/20 text-zinc-400",
  ERROR: "bg-red-500/20 text-red-400",
};

export function ModelLogPanel({ entries, isLoading }: { entries: LogEntry[]; isLoading?: boolean }) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  return (
    <ScrollArea className="h-[300px]">
      <div className="space-y-1">
        {entries.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            Нет записей
          </p>
        )}
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center gap-3 text-xs py-1.5 px-2 rounded hover:bg-muted/50"
          >
            <span className="text-muted-foreground font-mono w-[140px] shrink-0">
              {formatDate(entry.createdAt)}
            </span>
            <Badge
              variant="outline"
              className={cn(
                "font-mono text-[10px] px-1.5 py-0 border-0 shrink-0",
                eventColors[entry.event] || "bg-zinc-500/20 text-zinc-400"
              )}
            >
              {entry.event}
            </Badge>
            {entry.asset && (
              <span className="font-mono font-medium text-primary shrink-0">
                {entry.asset.toUpperCase()}
              </span>
            )}
            <span className="text-muted-foreground truncate">
              {entry.details}
            </span>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

// ─── Date formatter ──────────────────────────────────────────────
export function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return "—";
  try {
    // Handle SQLite datetime format ("2026-03-26 10:07:26") and ISO format
    const normalized = dateStr.includes("T") ? dateStr : dateStr.replace(" ", "T") + "Z";
    const d = new Date(normalized);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}
