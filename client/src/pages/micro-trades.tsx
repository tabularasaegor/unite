import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, ArrowRight, Zap, RefreshCw } from "lucide-react";
import { Link } from "wouter";

function cleanTitle(title: string) {
  return title.replace(/^\[5m\]\s*/, "");
}

export default function MicroTrades() {
  const { data: executions, refetch, isFetching } = useQuery({
    queryKey: ["/api/executions", "micro"],
    queryFn: () => apiRequest("GET", "/api/executions?type=micro").then(r => r.json()),
    refetchInterval: 30000,
  });

  const filled = (executions || []).filter((e: any) => e.status === "filled");
  const failed = (executions || []).filter((e: any) => e.status === "failed");
  const totalSize = filled.reduce((s: number, e: any) => s + (e.size || 0), 0);

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6" data-testid="micro-trades-page">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-500" /> Микро-сделки
          </h2>
          <p className="text-sm text-muted-foreground">История 5-минутных крипто-ордеров</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Обновить
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground">Всего</div>
            <div className="text-lg font-semibold">{(executions || []).length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground">Исполнено</div>
            <div className="text-lg font-semibold text-green-500">{filled.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground">Объём</div>
            <div className="text-lg font-semibold tabular-nums">${totalSize.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground">Ошибки</div>
            <div className={`text-lg font-semibold ${failed.length > 0 ? "text-red-500" : ""}`}>{failed.length}</div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">Все исполнения ({(executions || []).length})</h3>
        {(executions || []).map((ex: any) => (
          <Card key={ex.id} className="hover:bg-accent/30 transition-colors">
            <CardContent className="py-3 px-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs text-muted-foreground">#{ex.id}</span>
                    <span className="text-sm font-medium truncate">{cleanTitle(ex.title || `Opportunity #${ex.opportunityId}`)}</span>
                    {ex.marketUrl && (
                      <a href={ex.marketUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary shrink-0">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={ex.side === "YES" ? "default" : "destructive"} className="text-[10px] h-4">{ex.side}</Badge>
                    {ex.paperTrade ? (
                      <Badge variant="secondary" className="text-[10px] h-4">Paper</Badge>
                    ) : (
                      <Badge className="text-[10px] h-4 bg-primary">Live</Badge>
                    )}
                    <Badge variant={ex.status === "filled" ? "default" : ex.status === "failed" ? "destructive" : "secondary"} className="text-[10px] h-4">
                      {ex.status}
                    </Badge>
                  </div>
                </div>
                <div className="text-right shrink-0 space-y-1">
                  <div className="text-sm font-mono tabular-nums font-semibold">${(ex.size || 0).toFixed(2)}</div>
                  <div className="text-xs text-muted-foreground font-mono tabular-nums">
                    {((ex.executedPrice || ex.requestedPrice || 0) * 100).toFixed(1)}¢ × {(ex.quantity || 0).toFixed(1)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {ex.submittedAt ? new Date(ex.submittedAt).toLocaleString("ru-RU") : "—"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2">
                {ex.positionId && (
                  <Link href="/micro/positions" className="text-[11px] text-primary hover:underline flex items-center gap-0.5">
                    Позиция #{ex.positionId} <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
                {ex.errorMessage && (
                  <span className="text-[11px] text-red-500 truncate" title={ex.errorMessage}>Ошибка: {ex.errorMessage}</span>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {(executions || []).length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">Нет сделок</div>
        )}
      </div>
    </div>
  );
}
