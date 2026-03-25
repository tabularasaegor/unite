import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Activity, TrendingUp, TrendingDown, Target, BarChart3,
  Zap, ShieldCheck, Clock, Play, Pause, RefreshCw, AlertTriangle
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

export default function Dashboard() {
  const { toast } = useToast();

  const { data: stats, isLoading: statsLoading, refetch: refetchStats, isFetching: fetchingStats } = useQuery({
    queryKey: ["/api/dashboard/stats"],
    refetchInterval: 30000,
  });

  const { data: pipelineStatus, refetch: refetchPipeline } = useQuery({
    queryKey: ["/api/pipeline/status"],
    refetchInterval: 5000,
  });

  const { data: performance, refetch: refetchPerf } = useQuery({
    queryKey: ["/api/dashboard/performance"],
  });

  const { data: recentOpps, refetch: refetchOpps } = useQuery({
    queryKey: ["/api/opportunities", { limit: 5 }],
    queryFn: () => apiRequest("GET", "/api/opportunities?limit=10").then(r => r.json()),
  });

  const { data: auditLog, refetch: refetchAudit } = useQuery({
    queryKey: ["/api/audit-log", { limit: 10 }],
    queryFn: () => apiRequest("GET", "/api/audit-log?limit=10").then(r => r.json()),
  });

  const { data: polyStatus } = useQuery({
    queryKey: ["/api/polymarket/status"],
    refetchInterval: 60000,
  });

  const dashFetching = fetchingStats;
  const refreshAll = () => { refetchStats(); refetchPipeline(); refetchPerf(); refetchOpps(); refetchAudit(); };

  const runPipelineMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/pipeline/run"),
    onSuccess: () => {
      toast({ title: "Пайплайн запущен" });
      queryClient.invalidateQueries({ queryKey: ["/api/pipeline/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err.message, variant: "destructive" }),
  });

  const startSchedulerMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/pipeline/scheduler/start", { intervalMinutes: 30 }),
    onSuccess: () => {
      toast({ title: "Планировщик запущен" });
      queryClient.invalidateQueries({ queryKey: ["/api/pipeline/status"] });
    },
  });

  const stopSchedulerMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/pipeline/scheduler/stop"),
    onSuccess: () => {
      toast({ title: "Планировщик остановлен" });
      queryClient.invalidateQueries({ queryKey: ["/api/pipeline/status"] });
    },
  });

  const perfData = (performance || []).slice().reverse().map((p: any, i: number) => ({
    time: new Date(p.timestamp).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
    pnl: p.totalPnl,
    value: p.portfolioValue,
  }));

  const pipelineStages = [
    { label: "Сканирование", key: "totalOpportunities", icon: "🔍" },
    { label: "Исследование", key: "inResearch", icon: "📊" },
    { label: "Анализ", key: "analyzed", icon: "🧠" },
    { label: "Одобрение", key: "pendingApproval", icon: "✅" },
    { label: "Позиции", key: "activePositions", icon: "📈" },
    { label: "Расчёты", key: "settled", icon: "🏁" },
  ];

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6" data-testid="dashboard-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Дашборд</h2>
          <p className="text-sm text-muted-foreground">AI Prediction Market Trading Platform</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refreshAll} disabled={dashFetching} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${dashFetching ? "animate-spin" : ""}`} />
            Обновить
          </Button>
          {pipelineStatus?.schedulerActive ? (
            <Button variant="outline" size="sm" onClick={() => stopSchedulerMut.mutate()} data-testid="btn-stop-scheduler">
              <Pause className="w-3.5 h-3.5 mr-1.5" /> Стоп планировщик
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => startSchedulerMut.mutate()} data-testid="btn-start-scheduler">
              <Play className="w-3.5 h-3.5 mr-1.5" /> Запустить планировщик
            </Button>
          )}
          <Button size="sm" onClick={() => runPipelineMut.mutate()} disabled={runPipelineMut.isPending || pipelineStatus?.running} data-testid="btn-run-pipeline">
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${runPipelineMut.isPending ? "animate-spin" : ""}`} />
            {runPipelineMut.isPending ? "Запуск..." : "Запустить пайплайн"}
          </Button>
        </div>
      </div>

      {/* Wallet Info */}
      {polyStatus?.address && (
        <Card className="bg-muted/30">
          <CardContent className="py-2 px-4 flex items-center justify-between">
            <div className="flex items-center gap-4 text-xs">
              <span className="text-muted-foreground">Polymarket:</span>
              <span className="font-mono">{polyStatus.address.slice(0, 6)}...{polyStatus.address.slice(-4)}</span>
              {polyStatus.balance != null && <span className="font-mono font-semibold">${parseFloat(polyStatus.balance).toFixed(2)}</span>}
              <Badge variant={polyStatus.tradingEnabled ? "default" : "secondary"} className="text-[10px] h-4">
                {polyStatus.tradingEnabled ? "Trading активен" : "Только чтение"}
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pipeline Status Banner */}
      <Card className={`${pipelineStatus?.killSwitch ? "border-red-500/50 bg-red-500/5" : pipelineStatus?.running ? "border-primary/50 bg-primary/5" : pipelineStatus?.schedulerActive ? "border-green-500/30 bg-green-500/5" : ""}`}>
        <CardContent className="py-3 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-2.5 h-2.5 rounded-full ${pipelineStatus?.killSwitch ? "bg-red-500" : pipelineStatus?.running ? "bg-primary animate-pulse" : pipelineStatus?.schedulerActive ? "bg-green-500" : "bg-muted-foreground/30"}`} />
              <span className="text-sm font-medium">
                {pipelineStatus?.killSwitch ? "Kill Switch активен — торговля остановлена" : pipelineStatus?.running ? "Пайплайн работает..." : pipelineStatus?.schedulerActive ? "Планировщик активен" : "Пайплайн остановлен"}
              </span>
            </div>
            {pipelineStatus?.lastRunAt && (
              <span className="text-xs text-muted-foreground">
                Последний запуск: {new Date(pipelineStatus.lastRunAt).toLocaleString("ru-RU")}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard title="Всего возможностей" value={stats?.totalOpportunities ?? 0} icon={Target} loading={statsLoading} />
        <KpiCard title="Активные позиции" value={stats?.activePositions ?? 0} icon={Activity} loading={statsLoading} />
        <KpiCard
          title="Общий P&L"
          value={`$${(stats?.totalPnl ?? 0).toFixed(2)}`}
          icon={stats?.totalPnl >= 0 ? TrendingUp : TrendingDown}
          loading={statsLoading}
          valueColor={stats?.totalPnl >= 0 ? "text-green-500" : "text-red-500"}
        />
        <KpiCard title="Винрейт" value={`${(stats?.winRate ?? 0).toFixed(1)}%`} icon={BarChart3} loading={statsLoading} />
      </div>

      {/* Pipeline Flow */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Пайплайн</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            {pipelineStages.map((stage, i) => (
              <div key={stage.key} className="flex items-center">
                <div className="flex flex-col items-center gap-1.5">
                  <span className="text-lg">{stage.icon}</span>
                  <span className="text-xs text-muted-foreground">{stage.label}</span>
                  <Badge variant="secondary" className="text-xs">
                    {pipelineStatus?.stats?.[stage.key as keyof typeof pipelineStatus.stats] ?? 0}
                  </Badge>
                </div>
                {i < pipelineStages.length - 1 && (
                  <div className="w-8 h-px bg-border mx-2" />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-6">
        {/* P&L Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">P&L динамика</CardTitle>
          </CardHeader>
          <CardContent>
            {perfData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={perfData}>
                  <defs>
                    <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="pnl" stroke="hsl(var(--primary))" fill="url(#pnlGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
                Нет данных. Запустите пайплайн для сбора данных.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Opportunities */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Последние возможности</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(recentOpps || []).slice(0, 6).map((opp: any) => (
                <div key={opp.id} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{opp.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="outline" className="text-[10px] h-4">{opp.platform}</Badge>
                      <span className="text-[10px] text-muted-foreground">{opp.category}</span>
                    </div>
                  </div>
                  <div className="text-right ml-2">
                    {opp.edge != null && (
                      <span className={`text-xs font-mono ${opp.edge > 0 ? "text-green-500" : "text-red-500"}`}>
                        {opp.edge > 0 ? "+" : ""}{(opp.edge * 100).toFixed(1)}%
                      </span>
                    )}
                    <Badge variant={opp.status === "approved" ? "default" : "secondary"} className="text-[10px] ml-2">
                      {opp.status}
                    </Badge>
                  </div>
                </div>
              ))}
              {(!recentOpps || recentOpps.length === 0) && (
                <p className="text-xs text-muted-foreground text-center py-4">Запустите сканирование для поиска возможностей</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Audit Log */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Журнал действий</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            {(auditLog || []).slice(0, 8).map((entry: any) => (
              <div key={entry.id} className="flex items-center gap-3 py-1 text-xs">
                <span className="text-muted-foreground w-16 flex-shrink-0">
                  {new Date(entry.timestamp).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <Badge variant="outline" className="text-[10px] h-4 w-16 justify-center flex-shrink-0">{entry.action}</Badge>
                <span className="text-muted-foreground truncate">{entry.actor}</span>
                <span className="truncate flex-1">{tryParseDetails(entry.details)}</span>
              </div>
            ))}
            {(!auditLog || auditLog.length === 0) && (
              <p className="text-xs text-muted-foreground text-center py-4">Нет записей</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ title, value, icon: Icon, loading, valueColor }: {
  title: string; value: string | number; icon: any; loading?: boolean; valueColor?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground">{title}</span>
          <Icon className="w-4 h-4 text-muted-foreground" />
        </div>
        {loading ? (
          <Skeleton className="h-7 w-20" />
        ) : (
          <span className={`text-xl font-semibold ${valueColor || ""}`}>{value}</span>
        )}
      </CardContent>
    </Card>
  );
}

function tryParseDetails(details: string | null): string {
  if (!details) return "";
  try {
    const obj = JSON.parse(details);
    return Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join(", ").slice(0, 80);
  } catch {
    return details.slice(0, 80);
  }
}
