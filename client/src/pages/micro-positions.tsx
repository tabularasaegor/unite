import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { X, ExternalLink, Zap, RefreshCw } from "lucide-react";

function cleanTitle(title: string) {
  return title.replace(/^\[5m(-[AB])?\]\s*/, "");
}

function getEngineTag(title: string): string {
  if (title.startsWith("[5m-A]")) return "A";
  if (title.startsWith("[5m-B]")) return "B";
  return "";
}

export default function MicroPositions() {
  const { toast } = useToast();

  const { data: openPositions, refetch: refetchOpen, isFetching: fetchingOpen } = useQuery({
    queryKey: ["/api/positions", "micro", "open"],
    queryFn: () => apiRequest("GET", "/api/positions?type=micro&status=open").then(r => r.json()),
    refetchInterval: 30000,
  });

  const { data: closedPositions, refetch: refetchClosed, isFetching: fetchingClosed } = useQuery({
    queryKey: ["/api/positions", "micro", "closed"],
    queryFn: () => apiRequest("GET", "/api/positions?type=micro&status=closed").then(r => r.json()),
  });

  const isFetching = fetchingOpen || fetchingClosed;
  const refreshAll = () => { refetchOpen(); refetchClosed(); };

  const closeMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/positions/${id}/close`),
    onSuccess: () => {
      toast({ title: "Позиция закрыта" });
      queryClient.invalidateQueries({ queryKey: ["/api/positions"] });
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err.message, variant: "destructive" }),
  });

  const totalPnl = (openPositions || []).reduce((s: number, p: any) => s + (p.unrealizedPnl || 0), 0);
  const totalSize = (openPositions || []).reduce((s: number, p: any) => s + p.size, 0);

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6" data-testid="micro-positions-page">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-500" /> Микро-позиции
          </h2>
          <p className="text-sm text-muted-foreground">5-минутные крипто-позиции</p>
        </div>
        <Button variant="outline" size="sm" onClick={refreshAll} disabled={isFetching} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Обновить
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground">Открытых</div>
            <div className="text-lg font-semibold">{(openPositions || []).length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground">Общий размер</div>
            <div className="text-lg font-semibold tabular-nums">${totalSize.toFixed(0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground">Нереализ. P&L</div>
            <div className={`text-lg font-semibold tabular-nums ${totalPnl >= 0 ? "text-green-500" : "text-red-500"}`}>${totalPnl.toFixed(2)}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="open">
        <TabsList>
          <TabsTrigger value="open">Открытые ({(openPositions || []).length})</TabsTrigger>
          <TabsTrigger value="closed">Закрытые ({(closedPositions || []).length})</TabsTrigger>
        </TabsList>

        <TabsContent value="open" className="mt-4">
          <Card>
            <CardContent className="pt-4">
              <div className="space-y-2">
                {(openPositions || []).map((pos: any) => (
                  <div key={pos.id} className="flex items-center justify-between py-2 border-b border-border/30">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {pos.marketUrl ? (
                          <a href={pos.marketUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium truncate hover:text-primary transition-colors flex items-center gap-1">
                            {cleanTitle(pos.title)}
                            <ExternalLink className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
                          </a>
                        ) : (
                          <p className="text-sm font-medium truncate">{cleanTitle(pos.title)}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant={pos.side === "YES" ? "default" : "destructive"} className="text-[10px]">{pos.side}</Badge>
                        <span className="text-xs font-mono tabular-nums">Вход: {(pos.entryPrice * 100).toFixed(1)}¢</span>
                        <span className="text-xs font-mono tabular-nums">Текущ: {((pos.currentPrice || 0) * 100).toFixed(1)}¢</span>
                        <span className="text-xs font-mono tabular-nums">${pos.size.toFixed(2)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 ml-4">
                      <div className="text-right">
                        <div className={`text-sm font-mono font-semibold tabular-nums ${(pos.unrealizedPnl || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                          ${(pos.unrealizedPnl || 0).toFixed(2)}
                        </div>
                        <div className="text-[10px] text-muted-foreground tabular-nums">
                          {(pos.unrealizedPnlPercent || 0).toFixed(1)}%
                        </div>
                      </div>
                      <Button size="sm" variant="destructive" onClick={() => closeMut.mutate(pos.id)} disabled={closeMut.isPending}>
                        <X className="w-3 h-3 mr-1" /> Закрыть
                      </Button>
                    </div>
                  </div>
                ))}
                {(openPositions || []).length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Нет открытых позиций</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="closed" className="mt-4">
          <Card>
            <CardContent className="pt-4">
              <div className="space-y-2">
                {(closedPositions || []).map((pos: any) => (
                  <div key={pos.id} className="flex items-center justify-between py-2 border-b border-border/30 text-xs">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {pos.marketUrl ? (
                          <a href={pos.marketUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium truncate hover:text-primary transition-colors flex items-center gap-1">
                            {cleanTitle(pos.title)}
                            <ExternalLink className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
                          </a>
                        ) : (
                          <p className="text-sm font-medium truncate">{cleanTitle(pos.title)}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant={pos.side === "YES" ? "default" : "destructive"} className="text-[10px]">{pos.side}</Badge>
                        <span className="font-mono tabular-nums">Закрыта: {pos.closedAt ? new Date(pos.closedAt).toLocaleDateString("ru-RU") : "—"}</span>
                      </div>
                    </div>
                    <div className={`text-sm font-mono font-semibold tabular-nums ${(pos.unrealizedPnl || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                      ${(pos.unrealizedPnl || 0).toFixed(2)}
                    </div>
                  </div>
                ))}
                {(closedPositions || []).length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Нет закрытых позиций</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
