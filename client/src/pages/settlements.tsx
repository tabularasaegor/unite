import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExternalLink, ArrowRight, RefreshCw } from "lucide-react";
import { Link } from "wouter";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch { return "—"; }
}

function getDaysRemaining(endDate: string | null) {
  if (!endDate) return null;
  try {
    const days = Math.ceil((new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (days < 0) return <Badge variant="destructive" className="text-[10px] h-4">Просрочен</Badge>;
    if (days < 7) return <Badge variant="destructive" className="text-[10px] h-4">{days}д</Badge>;
    if (days < 30) return <Badge className="text-[10px] h-4 bg-yellow-500">{days}д</Badge>;
    return <Badge variant="secondary" className="text-[10px] h-4">{days}д</Badge>;
  } catch { return null; }
}

function renderSettlement(s: any) {
  return (
    <Card key={s.id} className="hover:bg-accent/30 transition-colors">
      <CardContent className="py-3 px-4">
        <div className="flex items-start justify-between gap-4">
          {/* Left: title + meta */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs text-muted-foreground">#{s.id}</span>
              <span className="text-sm font-medium truncate">{s.title || `Opportunity #${s.opportunityId}`}</span>
              {s.marketUrl && (
                <a href={s.marketUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary shrink-0">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {s.positionSide && (
                <Badge variant={s.positionSide === "YES" ? "default" : "destructive"} className="text-[10px] h-4">{s.positionSide}</Badge>
              )}
              {s.category && <Badge variant="outline" className="text-[10px] h-4">{s.category}</Badge>}
              {s.status === "settled" && s.outcome && (
                <Badge variant={s.outcome === "YES" ? "default" : "destructive"} className="text-[10px] h-4">
                  Исход: {s.outcome}
                </Badge>
              )}
              {s.status === "monitoring" && <Badge variant="secondary" className="text-[10px] h-4">Мониторинг</Badge>}
              {s.status === "settled" && s.wasCorrect === 1 && <Badge className="text-[10px] h-4 bg-green-500">Верно</Badge>}
              {s.status === "settled" && s.wasCorrect === 0 && <Badge variant="destructive" className="text-[10px] h-4">Неверно</Badge>}
              {s.endDate && getDaysRemaining(s.endDate)}
            </div>
          </div>

          {/* Right: numbers */}
          <div className="text-right shrink-0 space-y-1">
            {s.status === "settled" && (
              <div className={`text-sm font-mono tabular-nums font-semibold ${(s.realizedPnl || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                ${(s.realizedPnl || 0).toFixed(2)}
              </div>
            )}
            <div className="text-xs text-muted-foreground font-mono tabular-nums">
              Наша: {s.ourPrediction != null ? `${(s.ourPrediction * 100).toFixed(1)}%` : "—"}
              {" / "}Вход: {s.marketPriceAtEntry != null ? `${(s.marketPriceAtEntry * 100).toFixed(1)}%` : "—"}
            </div>
            {s.status === "settled" && s.finalPrice != null && (
              <div className="text-xs text-muted-foreground font-mono tabular-nums">
                Итог: {(s.finalPrice * 100).toFixed(1)}%
              </div>
            )}
          </div>
        </div>

        {/* Cross-links */}
        <div className="flex items-center gap-3 mt-2">
          {s.positionId && (
            <Link href={`/positions`} className="text-[11px] text-primary hover:underline flex items-center gap-0.5">
              Позиция #{s.positionId} <ArrowRight className="h-3 w-3" />
            </Link>
          )}
          {s.executionId && (
            <Link href={`/trades`} className="text-[11px] text-primary hover:underline flex items-center gap-0.5">
              Сделка #{s.executionId} <ArrowRight className="h-3 w-3" />
            </Link>
          )}
          {s.positionSize != null && s.positionEntryPrice != null && (
            <span className="text-[11px] text-muted-foreground">
              Вход: ${s.positionSize.toFixed(2)} @ {(s.positionEntryPrice * 100).toFixed(1)}¢
            </span>
          )}
          {s.endDate && (
            <span className="text-[11px] text-muted-foreground">Дедлайн: {formatDate(s.endDate)}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Settlements() {
  const { data: settlements, refetch, isFetching } = useQuery({
    queryKey: ["/api/settlements?type=regular"],
    refetchInterval: 30000,
  });

  const monitoring = (settlements || []).filter((s: any) => s.status === "monitoring");
  const settled = (settlements || []).filter((s: any) => s.status === "settled");

  const totalRealized = settled.reduce((s: number, t: any) => s + (t.realizedPnl || 0), 0);
  const wins = settled.filter((s: any) => s.wasCorrect === 1).length;
  const winRate = settled.length > 0 ? (wins / settled.length * 100) : 0;

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6" data-testid="settlements-page">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Расчёты</h2>
          <p className="text-sm text-muted-foreground">Мониторинг разрешения рынков и расчёт P&L</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Обновить
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground">Мониторинг</div>
            <div className="text-lg font-semibold">{monitoring.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground">Рассчитано</div>
            <div className="text-lg font-semibold">{settled.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground">Реализов. P&L</div>
            <div className={`text-lg font-semibold tabular-nums ${totalRealized >= 0 ? "text-green-500" : "text-red-500"}`}>
              ${totalRealized.toFixed(2)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground">Винрейт</div>
            <div className="text-lg font-semibold tabular-nums">{winRate.toFixed(1)}%</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="monitoring">
        <TabsList>
          <TabsTrigger value="monitoring">Мониторинг ({monitoring.length})</TabsTrigger>
          <TabsTrigger value="settled">Рассчитано ({settled.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="monitoring" className="mt-4 space-y-3">
          {monitoring.length > 0 ? (
            monitoring.map((s: any) => renderSettlement(s))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">Нет активных мониторингов</p>
          )}
        </TabsContent>

        <TabsContent value="settled" className="mt-4 space-y-3">
          {settled.length > 0 ? (
            settled.map((s: any) => renderSettlement(s))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">Нет рассчитанных сделок</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
