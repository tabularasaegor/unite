import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KPICard, StatusBadge, PnLDisplay, ModelLogPanel, PageHeader } from "@/components/shared";
import {
  TrendingUp,
  DollarSign,
  BarChart3,
  Activity,
  Play,
  Square,
  Clock,
} from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { useState, useEffect } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface MicroStats {
  winRate: number;
  totalPnl: number;
  totalTrades: number;
  openPositions: number;
  assetStats: Array<{
    asset: string;
    trades: number;
    winRate: number;
    pnl: number;
    status: string;
  }>;
  pnlByAsset: Array<{ asset: string; pnl: number }>;
  cumulativePnl: Array<{ date: string; pnl: number }>;
  schedulerRunning: boolean;
  nextWindow: string | null;
  currentWindow: string | null;
}

interface ModelLogEntry {
  id: number;
  event: string;
  asset: string | null;
  details: string | null;
  createdAt: string;
}

export default function MicroDashboard() {
  const { data: stats, isLoading } = useQuery<MicroStats>({
    queryKey: ["/api/micro/stats"],
  });

  const { data: logs, isLoading: logsLoading } = useQuery<ModelLogEntry[]>({
    queryKey: ["/api/micro/logs"],
  });

  const toggleMutation = useMutation({
    mutationFn: async (action: "start" | "stop") => {
      await apiRequest("POST", `/api/micro/scheduler/${action}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/micro/stats"] });
    },
  });

  const isRunning = stats?.schedulerRunning ?? false;

  // Countdown timer
  const [countdown, setCountdown] = useState("—");
  useEffect(() => {
    if (!stats?.nextWindow) {
      setCountdown("—");
      return;
    }
    const target = new Date(stats.nextWindow).getTime();
    const interval = setInterval(() => {
      const diff = target - Date.now();
      if (diff <= 0) {
        setCountdown("00:00:00");
        queryClient.invalidateQueries({ queryKey: ["/api/micro/stats"] });
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdown(
        `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [stats?.nextWindow]);

  const winRate = stats?.winRate ?? 0;
  const winRateColor =
    winRate > 55 ? "text-emerald-500" : winRate >= 50 ? "text-yellow-500" : "text-red-500";

  return (
    <div>
      <PageHeader
        title="Крипто 5-мин"
        subtitle="Автоматическая торговля 5-минутными Up/Down рынками"
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="Win Rate"
          value={`${winRate.toFixed(1)}%`}
          icon={<TrendingUp className="h-4 w-4" />}
          isLoading={isLoading}
          valueClassName={winRateColor}
        />
        <KPICard
          title="Всего P&L"
          value={`$${(stats?.totalPnl ?? 0).toFixed(2)}`}
          icon={<DollarSign className="h-4 w-4" />}
          trend={(stats?.totalPnl ?? 0) >= 0 ? "up" : "down"}
          isLoading={isLoading}
        />
        <KPICard
          title="Сделок"
          value={stats?.totalTrades ?? 0}
          icon={<BarChart3 className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <KPICard
          title="Открытых"
          value={stats?.openPositions ?? 0}
          icon={<Activity className="h-4 w-4" />}
          isLoading={isLoading}
        />
      </div>

      {/* Scheduler Control */}
      <Card className="mb-6">
        <CardContent className="py-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <Button
              size="lg"
              variant={isRunning ? "destructive" : "default"}
              onClick={() => toggleMutation.mutate(isRunning ? "stop" : "start")}
              disabled={toggleMutation.isPending}
              className="gap-2 min-w-[160px]"
              data-testid="button-scheduler-toggle"
            >
              {isRunning ? (
                <>
                  <Square className="h-4 w-4" /> Остановить
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" /> Запустить
                </>
              )}
            </Button>
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  isRunning ? "bg-emerald-500 animate-pulse" : "bg-zinc-500"
                }`}
              />
              <span className="text-sm text-muted-foreground">
                {isRunning ? "Работает" : "Остановлен"}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>Следующее окно:</span>
              <span className="font-mono font-medium text-foreground" data-testid="text-countdown">
                {countdown}
              </span>
            </div>
            {stats?.currentWindow && (
              <Badge variant="outline" className="font-mono text-xs">
                Окно: {stats.currentWindow}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* P&L by asset */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">P&L по активам</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats?.pnlByAsset ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 30% 18%)" />
                  <XAxis dataKey="asset" tick={{ fontSize: 12 }} stroke="hsl(215 14% 46%)" />
                  <YAxis tick={{ fontSize: 12 }} stroke="hsl(215 14% 46%)" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(222 40% 10%)",
                      border: "1px solid hsl(222 30% 18%)",
                      borderRadius: "6px",
                      fontSize: "12px",
                    }}
                    formatter={(value: number) => [`$${value.toFixed(2)}`, "P&L"]}
                  />
                  <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                    {(stats?.pnlByAsset ?? []).map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.pnl >= 0 ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Cumulative P&L */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Кумулятивный P&L</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stats?.cumulativePnl ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 30% 18%)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(215 14% 46%)" />
                  <YAxis tick={{ fontSize: 12 }} stroke="hsl(215 14% 46%)" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(222 40% 10%)",
                      border: "1px solid hsl(222 30% 18%)",
                      borderRadius: "6px",
                      fontSize: "12px",
                    }}
                    formatter={(value: number) => [`$${value.toFixed(2)}`, "P&L"]}
                  />
                  <Line
                    type="monotone"
                    dataKey="pnl"
                    stroke="hsl(199 89% 48%)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Asset Stats Table */}
      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Статистика по активам</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Актив</TableHead>
                  <TableHead className="text-xs">Сделок</TableHead>
                  <TableHead className="text-xs">Win Rate</TableHead>
                  <TableHead className="text-xs">P&L</TableHead>
                  <TableHead className="text-xs">Статус</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }).map((_, j) => (
                        <TableCell key={j}>
                          <div className="h-4 w-16 bg-muted animate-pulse rounded" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (stats?.assetStats ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                      Нет данных
                    </TableCell>
                  </TableRow>
                ) : (
                  (stats?.assetStats ?? []).map((row) => (
                    <TableRow key={row.asset}>
                      <TableCell className="font-mono font-medium text-primary">
                        {row.asset.toUpperCase()}
                      </TableCell>
                      <TableCell className="font-mono">{row.trades}</TableCell>
                      <TableCell>
                        <span
                          className={`font-mono ${
                            row.winRate > 55
                              ? "text-emerald-500"
                              : row.winRate >= 50
                                ? "text-yellow-500"
                                : "text-red-500"
                          }`}
                        >
                          {row.winRate.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell>
                        <PnLDisplay value={row.pnl} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={row.status} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Model Log */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Журнал модели</CardTitle>
        </CardHeader>
        <CardContent>
          <ModelLogPanel entries={logs ?? []} isLoading={logsLoading} />
        </CardContent>
      </Card>
    </div>
  );
}
