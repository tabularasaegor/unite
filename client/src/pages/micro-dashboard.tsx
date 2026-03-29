import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Zap, Square, ExternalLink, ArrowRight, TrendingUp, TrendingDown, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Cell } from "recharts";

function MicroSchedulerControls() {
  const { toast } = useToast();
  const { data: status, refetch } = useQuery({
    queryKey: ["/api/micro/status"],
    refetchInterval: 5000,
  });

  const startMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/micro/start"),
    onSuccess: () => { refetch(); toast({ title: "Микро-планировщик запущен" }); },
  });

  const stopMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/micro/stop"),
    onSuccess: () => { refetch(); toast({ title: "Микро-планировщик остановлен" }); },
  });

  const s = status as any;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-500" />
          Управление планировщиком
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
          <div className="flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full ${s?.active ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
            <div>
              <span className="text-sm font-medium">{s?.active ? "Активен" : "Остановлен"}</span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-muted-foreground">Циклов: {s?.totalCycles || 0}</span>
                <span className="text-[10px] text-muted-foreground">Сделок: {s?.totalTrades || 0}</span>
                <span className={`text-[10px] font-mono ${(s?.totalPnl || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                  P&L: ${(s?.totalPnl || 0).toFixed(2)}
                </span>
                {s?.enabledAssets && (
                  <span className="text-[10px] text-muted-foreground">
                    [{(s.enabledAssets as string[]).map((a: string) => a.toUpperCase()).join(", ")}]
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {!s?.active ? (
              <Button size="sm" onClick={() => startMut.mutate()} disabled={startMut.isPending} className="gap-1">
                <Zap className="h-3 w-3" /> Запустить
              </Button>
            ) : (
              <Button size="sm" variant="destructive" onClick={() => stopMut.mutate()} disabled={stopMut.isPending} className="gap-1">
                <Square className="h-3 w-3" /> Остановить
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function detectAsset(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("ethereum") || t.includes("eth")) return "ETH";
  if (t.includes("solana") || t.includes("sol")) return "SOL";
  if (t.includes("xrp")) return "XRP";
  return "BTC";
}

export default function MicroDashboard({ engine, timeframe }: { engine?: string; timeframe?: string }) {
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const params = [engine ? `engine=${engine}` : "", timeframe ? `tf=${timeframe}` : ""].filter(Boolean).join("&");
  const qp = params ? `?${params}` : "";
  const amp = params ? `&${params}` : "";

  const { data: stats, refetch: refetchStats, isFetching: fetchingStats } = useQuery({
    queryKey: ["/api/micro/stats", engine || "all", timeframe || "all"],
    queryFn: () => apiRequest("GET", `/api/micro/stats${qp}`).then(r => r.json()),
    refetchInterval: 30000,
  });

  const { data: executions, refetch: refetchExec, isFetching: fetchingExec } = useQuery({
    queryKey: ["/api/executions", "micro", engine || "all", timeframe || "all"],
    queryFn: () => apiRequest("GET", `/api/executions?type=micro${amp}`).then(r => r.json()),
    refetchInterval: 30000,
  });

  const { data: positions, refetch: refetchPos, isFetching: fetchingPos } = useQuery({
    queryKey: ["/api/positions", "micro", "open", engine || "all", timeframe || "all"],
    queryFn: () => apiRequest("GET", `/api/positions?type=micro&status=open${amp}`).then(r => r.json()),
    refetchInterval: 30000,
  });

  const { data: modelLog } = useQuery({
    queryKey: ["/api/micro/model-log"],
    refetchInterval: 10000,
  });

  const { data: learningMatrix } = useQuery({
    queryKey: ["/api/micro/learning-matrix"],
    refetchInterval: 30000,
  });

  const { data: strategyPerfData } = useQuery({
    queryKey: ["/api/micro/strategy-perf"],
    refetchInterval: 30000,
  });

  const isFetching = fetchingStats || fetchingExec || fetchingPos;
  const refreshAll = () => { refetchStats(); refetchExec(); refetchPos(); };

  const s = stats || {} as any;
  const timeSeries: any[] = s.timeSeries || [];
  const assetStats: any[] = s.assetStats || [];
  const recentTrades = (executions || []).slice(0, 20);

  const filteredTimeSeries = selectedAsset
    ? timeSeries.filter((t: any) => t.asset === selectedAsset)
    : timeSeries;

  const cumulativeData = filteredTimeSeries.reduce((acc: any[], t: any) => {
    const prev = acc.length > 0 ? acc[acc.length - 1].cumPnl : 0;
    acc.push({ ...t, cumPnl: Math.round((prev + t.pnl) * 100) / 100 });
    return acc;
  }, []);

  const streakText = (s.currentStreak || 0) > 0
    ? `+${s.currentStreak}`
    : s.currentStreak < 0
    ? `${s.currentStreak}`
    : "0";

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6" data-testid="micro-dashboard-page">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-500" /> {engine === "A" ? "Арена" : engine === "B" ? "Bayesian" : engine === "C" ? "Latency" : engine === "D" ? "VWAP/Momentum" : engine === "F" ? "ML/RF" : "Все модели"}{timeframe ? ` [${timeframe}]` : ""}
          </h2>
          <p className="text-sm text-muted-foreground">{[engine && `Модель ${engine}`, timeframe || "Все таймфреймы", "BTC/ETH/SOL/XRP"].filter(Boolean).join(" — ")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={refreshAll} disabled={isFetching} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Обновить
        </Button>
      </div>

      {/* Row 1: KPI Cards */}
      <div className="grid grid-cols-6 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground">Винрейт</div>
            <div className={`text-lg font-semibold tabular-nums ${(s.winRate || 0) >= 50 ? "text-green-500" : "text-red-500"}`}>
              {(s.winRate || 0).toFixed(1)}%
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground">Всего сделок</div>
            <div className="text-lg font-semibold tabular-nums">
              {s.totalTrades || 0}
              <span className="text-xs font-normal text-muted-foreground ml-1">
                ({s.totalWins || 0}/{s.totalLosses || 0})
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground">P&L</div>
            <div className={`text-lg font-semibold tabular-nums ${(s.totalPnl || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
              ${(s.totalPnl || 0).toFixed(2)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground">Ср. ставка</div>
            <div className="text-lg font-semibold tabular-nums">${(s.avgSize || 0).toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground">Ср. увер. AI</div>
            <div className="text-lg font-semibold tabular-nums">{s.avgConfidence || 0}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground">Текущая серия</div>
            <div className={`text-lg font-semibold tabular-nums flex items-center gap-1 ${(s.currentStreak || 0) > 0 ? "text-green-500" : (s.currentStreak || 0) < 0 ? "text-red-500" : ""}`}>
              {(s.currentStreak || 0) > 0 ? <TrendingUp className="h-4 w-4" /> : (s.currentStreak || 0) < 0 ? <TrendingDown className="h-4 w-4" /> : null}
              {streakText}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Engine breakdown (only in aggregate "Все" view) */}
      {!engine && (s.engineBreakdown || []).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Сравнение моделей</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">Модель</th>
                    <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">Сделки</th>
                    <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">WR%</th>
                    <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">P&L</th>
                    <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">Ср. ставка</th>
                  </tr>
                </thead>
                <tbody>
                  {(s.engineBreakdown as any[]).map((e: any) => (
                    <tr key={e.engine} className="border-b border-border/20 hover:bg-muted/30">
                      <td className="py-1.5 px-2 font-medium">
                        <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${
                          e.engine === 'A' ? 'bg-blue-500' : e.engine === 'B' ? 'bg-purple-500' : e.engine === 'C' ? 'bg-amber-500' : e.engine === 'D' ? 'bg-emerald-500' : 'bg-cyan-500'
                        }`} />
                        {e.label} ({e.engine})
                      </td>
                      <td className="text-right py-1.5 px-2 tabular-nums">{e.trades}</td>
                      <td className={`text-right py-1.5 px-2 tabular-nums font-medium ${e.winRate >= 55 ? 'text-green-500' : e.winRate >= 45 ? 'text-foreground' : 'text-red-500'}`}>
                        {e.winRate}%
                      </td>
                      <td className={`text-right py-1.5 px-2 tabular-nums font-medium ${e.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        ${e.pnl.toFixed(2)}
                      </td>
                      <td className="text-right py-1.5 px-2 tabular-nums">${e.avgSize.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Row 2: Scheduler Controls */}
      <MicroSchedulerControls />

      {/* Learning: Strategy Performance + Learning Matrix */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Эффективность стратегий</CardTitle>
          </CardHeader>
          <CardContent>
            {(strategyPerfData as any[] || []).length > 0 ? (
              <div className="space-y-2">
                {(strategyPerfData as any[] || []).map((sp: any) => (
                  <div key={sp.strategy} className="flex items-center justify-between text-xs">
                    <span className="font-mono font-semibold">{sp.strategy}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground">{sp.wins}/{sp.trades}</span>
                      <span className={`font-mono tabular-nums font-medium ${sp.winRate >= 60 ? "text-green-500" : sp.winRate < 45 ? "text-red-500" : ""}`}>{sp.winRate}%</span>
                      <span className={`font-mono tabular-nums text-[10px] ${sp.recentWR >= 60 ? "text-green-500" : sp.recentWR < 45 ? "text-red-500" : "text-muted-foreground"}`}>(посл.{sp.recentWR}%)</span>
                      <span className={`font-mono tabular-nums ${sp.pnl >= 0 ? "text-green-500" : "text-red-500"}`}>${sp.pnl}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-2">Нет данных</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Матрица обучения (веса)</CardTitle>
          </CardHeader>
          <CardContent>
            {(learningMatrix as any[] || []).length > 0 ? (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {(learningMatrix as any[] || []).filter((lw: any) => !lw.key.includes("|") || lw.key.split("|").length === 2).map((lw: any) => {
                  const parts = lw.key.split("|");
                  const label = `${parts[0]?.toUpperCase()} ${parts[1]}`;
                  const barWidth = Math.min(100, Math.max(5, lw.weight * 50));
                  return (
                    <div key={lw.key} className="flex items-center gap-2 text-xs">
                      <span className="font-mono w-16 shrink-0">{label}</span>
                      <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${lw.weight >= 1.2 ? "bg-green-500" : lw.weight < 0.7 ? "bg-red-500" : "bg-muted-foreground/50"}`}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                      <span className="font-mono tabular-nums w-8 text-right">{lw.weight}</span>
                      <span className="text-muted-foreground w-12 text-right">{lw.winRate}%({lw.trades})</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-2">Нет данных</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Model Log */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Лог модели ({(modelLog as any[] || []).length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {(modelLog as any[] || []).slice().reverse().map((entry: any, i: number) => {
              const ev = entry.event || "";
              const color = ev.includes("LOSS") || ev.includes("✗") ? "text-red-500"
                : ev.includes("WIN") || ev.includes("RECOVERY") || ev.includes("✓") ? "text-green-500"
                : ev.includes("DRAWDOWN") ? "text-orange-500"
                : ev.includes("COOLDOWN") ? "text-yellow-500"
                : ev.includes("РЕШЕНИЕ") ? "text-blue-400"
                : ev.includes("СЕТЛМЕНТ") ? (entry.detail?.includes("✓") ? "text-green-500" : "text-red-500")
                : ev.includes("ОБУЧЕНИЕ") ? "text-purple-400"
                : ev.includes("КАЛИБРОВКА") || ev.includes("REBUILD") ? "text-cyan-400"
                : ev.includes("СТРАТЕГИИ") ? "text-amber-400"
                : "text-muted-foreground";
              return (
                <div key={i} className="flex items-start gap-2 text-xs py-1 border-b border-border/20">
                  <span className="text-muted-foreground shrink-0 w-14">{new Date(entry.ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                  <span className={`font-mono font-semibold shrink-0 min-w-[80px] ${color}`}>{ev}</span>
                  <span className="text-muted-foreground break-all">{entry.detail}</span>
                </div>
              );
            })}
            {(!modelLog || (modelLog as any[]).length === 0) && (
              <p className="text-sm text-muted-foreground text-center py-2">Нет событий модели</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Row 3: Per-asset stats table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Статистика по активам</CardTitle>
            {selectedAsset && (
              <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => setSelectedAsset(null)}>
                Все
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            <div className="grid grid-cols-8 gap-2 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider border-b">
              <div>Актив</div>
              <div>Сделок</div>
              <div>Побед</div>
              <div>Пораж.</div>
              <div>WR%</div>
              <div>P&L</div>
              <div>Ср.ставка</div>
              <div>Ср.увер.</div>
            </div>
            {assetStats.length > 0 ? assetStats.map((a: any) => (
              <div
                key={a.asset}
                className={`grid grid-cols-8 gap-2 py-2 items-center border-b border-border/30 text-xs cursor-pointer transition-colors hover:bg-muted/30 ${selectedAsset === a.asset ? "bg-primary/10" : ""}`}
                onClick={() => setSelectedAsset(selectedAsset === a.asset ? null : a.asset)}
              >
                <div className="font-semibold">{a.asset}</div>
                <div className="font-mono tabular-nums">{a.trades}</div>
                <div className="font-mono tabular-nums text-green-500">{a.wins}</div>
                <div className="font-mono tabular-nums text-red-500">{a.losses}</div>
                <div className={`font-mono tabular-nums font-medium ${a.winRate >= 50 ? "text-green-500" : "text-red-500"}`}>
                  {a.winRate}%
                </div>
                <div className={`font-mono tabular-nums font-medium ${a.pnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                  ${a.pnl.toFixed(2)}
                </div>
                <div className="font-mono tabular-nums">${a.avgSize.toFixed(2)}</div>
                <div className="font-mono tabular-nums">{a.avgConfidence}%</div>
              </div>
            )) : (
              <div className="py-4 text-center text-sm text-muted-foreground">Нет данных</div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Row 4: P&L Bar Chart */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">
            P&L по сделкам {selectedAsset && <Badge variant="outline" className="ml-2 text-[10px]">{selectedAsset}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredTimeSeries.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={filteredTimeSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="time"
                  tickFormatter={(t) => new Date(t).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                  fontSize={10}
                  stroke="hsl(var(--muted-foreground))"
                />
                <YAxis
                  fontSize={10}
                  tickFormatter={(v) => `$${v}`}
                  stroke="hsl(var(--muted-foreground))"
                />
                <Tooltip
                  formatter={(v: number) => [`$${v.toFixed(2)}`, "P&L"]}
                  labelFormatter={(t) => new Date(t).toLocaleString("ru-RU")}
                  contentStyle={{ fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                />
                <Bar dataKey="pnl" radius={[2, 2, 0, 0]}>
                  {filteredTimeSeries.map((entry: any, i: number) => (
                    <Cell key={i} fill={entry.won ? "#22c55e" : "#ef4444"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">Нет данных для графика</div>
          )}
        </CardContent>
      </Card>

      {/* Row 5: Cumulative P&L + streaks */}
      <div className="grid grid-cols-4 gap-4">
        <div className="col-span-3">
          <Card className="h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">
                Кумулятивный P&L {selectedAsset && <Badge variant="outline" className="ml-2 text-[10px]">{selectedAsset}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {cumulativeData.length > 0 ? (
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={cumulativeData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="time"
                      tickFormatter={(t) => new Date(t).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                      fontSize={10}
                      stroke="hsl(var(--muted-foreground))"
                    />
                    <YAxis
                      fontSize={10}
                      tickFormatter={(v) => `$${v}`}
                      stroke="hsl(var(--muted-foreground))"
                    />
                    <Tooltip
                      formatter={(v: number) => [`$${v.toFixed(2)}`, "Кумул. P&L"]}
                      labelFormatter={(t) => new Date(t).toLocaleString("ru-RU")}
                      contentStyle={{ fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="cumPnl"
                      stroke={cumulativeData.length > 0 && cumulativeData[cumulativeData.length - 1].cumPnl >= 0 ? "#22c55e" : "#ef4444"}
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="py-8 text-center text-sm text-muted-foreground">Нет данных для графика</div>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-xs text-muted-foreground">Макс. серия побед</div>
              <div className="text-lg font-semibold tabular-nums text-green-500">{s.maxWinStreak || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-xs text-muted-foreground">Макс. серия пораж.</div>
              <div className="text-lg font-semibold tabular-nums text-red-500">{s.maxLossStreak || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-xs text-muted-foreground">Открытых позиций</div>
              <div className="text-lg font-semibold">{s.openPositions || 0}</div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Row 6: Open Positions */}
      {(positions || []).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Открытые позиции ({(positions || []).length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(positions || []).map((pos: any) => (
                <div key={pos.id} className="flex items-center justify-between py-2 border-b border-border/30">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium truncate">{pos.title.replace(/^\[5m\]\s*/, "")}</span>
                      {pos.marketUrl && (
                        <a href={pos.marketUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant={pos.side === "YES" ? "default" : "destructive"} className="text-[10px] h-4">{pos.side}</Badge>
                      <span className="text-xs font-mono tabular-nums">Вход: {(pos.entryPrice * 100).toFixed(1)}¢</span>
                      <span className="text-xs font-mono tabular-nums">Текущ: {((pos.currentPrice || 0) * 100).toFixed(1)}¢</span>
                      <span className="text-xs font-mono tabular-nums">${pos.size.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className={`text-sm font-mono font-semibold tabular-nums ${(pos.unrealizedPnl || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                    ${(pos.unrealizedPnl || 0).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Row 7: Direction + Strategy + Hourly Analytics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Direction Stats */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Направление (Up vs Down)</CardTitle>
          </CardHeader>
          <CardContent>
            {s.directionStats ? (
              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-medium text-green-500">Up (YES)</span>
                  <span className="font-mono tabular-nums">
                    {s.directionStats.up.wins}/{s.directionStats.up.trades} ({s.directionStats.up.trades > 0 ? Math.round(s.directionStats.up.wins/s.directionStats.up.trades*100) : 0}%)
                  </span>
                  <span className={`font-mono tabular-nums font-medium ${s.directionStats.up.pnl >= 0 ? "text-green-500" : "text-red-500"}`}>${s.directionStats.up.pnl}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-medium text-red-500">Down (NO)</span>
                  <span className="font-mono tabular-nums">
                    {s.directionStats.down.wins}/{s.directionStats.down.trades} ({s.directionStats.down.trades > 0 ? Math.round(s.directionStats.down.wins/s.directionStats.down.trades*100) : 0}%)
                  </span>
                  <span className={`font-mono tabular-nums font-medium ${s.directionStats.down.pnl >= 0 ? "text-green-500" : "text-red-500"}`}>${s.directionStats.down.pnl}</span>
                </div>
              </div>
            ) : <p className="text-xs text-muted-foreground">Нет данных</p>}
          </CardContent>
        </Card>

        {/* Strategy Stats */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Стратегии</CardTitle>
          </CardHeader>
          <CardContent>
            {(s.strategyBreakdown || []).length > 0 ? (
              <div className="space-y-1">
                {(s.strategyBreakdown || []).map((st: any) => (
                  <div key={st.strategy} className="flex justify-between items-center text-xs">
                    <span className="font-medium capitalize">{st.strategy}</span>
                    <span className="font-mono tabular-nums">{st.wins}/{st.trades} ({st.winRate}%)</span>
                    <span className={`font-mono tabular-nums font-medium ${st.pnl >= 0 ? "text-green-500" : "text-red-500"}`}>${st.pnl}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-muted-foreground">Нет данных</p>}
          </CardContent>
        </Card>

        {/* Hourly Performance */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">По часам (UTC)</CardTitle>
          </CardHeader>
          <CardContent>
            {(s.hourlyBreakdown || []).length > 0 ? (
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {(s.hourlyBreakdown || []).map((h: any) => (
                  <div key={h.hour} className="flex justify-between items-center text-xs">
                    <span className="font-mono">{h.hour}</span>
                    <span className={`font-mono tabular-nums ${h.winRate >= 60 ? "text-green-500" : h.winRate < 45 ? "text-red-500" : ""}`}>{h.winRate}%</span>
                    <span className={`font-mono tabular-nums ${h.pnl >= 0 ? "text-green-500" : "text-red-500"}`}>${h.pnl}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-muted-foreground">Нет данных</p>}
          </CardContent>
        </Card>
      </div>

      {/* Row 8: Asset+Direction Matrix */}
      {(s.assetDirectionMatrix || []).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Матрица Актив × Направление</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider border-b">
              <div>Актив</div><div>Напр.</div><div>Сделок</div><div>Побед</div><div>WR%</div><div>P&L</div><div>Сигнал</div>
            </div>
            {(s.assetDirectionMatrix || []).sort((a: any, b: any) => b.pnl - a.pnl).map((m: any, i: number) => (
              <div key={i} className="grid grid-cols-7 gap-2 py-1.5 items-center border-b border-border/20 text-xs">
                <div className="font-semibold">{m.asset}</div>
                <div>{m.direction === "Up" ? <span className="text-green-500">Up</span> : <span className="text-red-500">Down</span>}</div>
                <div className="font-mono tabular-nums">{m.trades}</div>
                <div className="font-mono tabular-nums">{m.wins}</div>
                <div className={`font-mono tabular-nums font-medium ${m.winRate >= 60 ? "text-green-500" : m.winRate < 45 ? "text-red-500" : ""}`}>{m.winRate}%</div>
                <div className={`font-mono tabular-nums font-medium ${m.pnl >= 0 ? "text-green-500" : "text-red-500"}`}>${m.pnl}</div>
                <div className="text-muted-foreground">{m.winRate >= 55 ? "✓" : m.winRate < 45 ? "✗" : "—"}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Row 9: Recent Trades Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Последние сделки ({recentTrades.length})</CardTitle>
            <Link href="/micro/trades" className="text-xs text-primary hover:underline flex items-center gap-0.5">
              Все сделки <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            <div className="grid grid-cols-12 gap-2 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider border-b">
              <div className="col-span-1">Актив</div>
              <div className="col-span-3">Рынок</div>
              <div className="col-span-1">Сторона</div>
              <div className="col-span-2">Размер</div>
              <div className="col-span-1">Цена</div>
              <div className="col-span-1">Статус</div>
              <div className="col-span-3">Время</div>
            </div>
            {recentTrades.map((ex: any) => {
              const asset = detectAsset(ex.title || "");
              return (
                <div key={ex.id} className="grid grid-cols-12 gap-2 py-2 items-center border-b border-border/30 text-xs">
                  <div className="col-span-1">
                    <Badge variant="outline" className="text-[10px] h-4">{asset}</Badge>
                  </div>
                  <div className="col-span-3 truncate">{(ex.title || "").replace(/^\[5m\]\s*/, "")}</div>
                  <div className="col-span-1">
                    <Badge variant={ex.side === "YES" ? "default" : "destructive"} className="text-[10px] h-4">{ex.side}</Badge>
                  </div>
                  <div className="col-span-2 font-mono tabular-nums">${(ex.size || 0).toFixed(2)}</div>
                  <div className="col-span-1 font-mono tabular-nums">{((ex.executedPrice || ex.requestedPrice || 0) * 100).toFixed(1)}¢</div>
                  <div className="col-span-1">
                    <Badge variant={ex.status === "filled" ? "default" : ex.status === "failed" ? "destructive" : "secondary"} className="text-[10px] h-4">
                      {ex.status}
                    </Badge>
                  </div>
                  <div className="col-span-3 text-muted-foreground">
                    {ex.submittedAt ? new Date(ex.submittedAt).toLocaleString("ru-RU") : "—"}
                  </div>
                </div>
              );
            })}
            {recentTrades.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">Нет сделок</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
