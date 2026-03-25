import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Scan, RefreshCw, ArrowRight } from "lucide-react";

export default function Scanner() {
  const { toast } = useToast();

  const { data: opportunities, isLoading } = useQuery({
    queryKey: ["/api/opportunities"],
    refetchInterval: 10000,
  });

  const { data: config } = useQuery({
    queryKey: ["/api/config"],
  });

  const scanMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/pipeline/stage/scan"),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: "Сканирование завершено", description: `Найдено ${data.totalDiscovered} новых возможностей` });
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err.message, variant: "destructive" }),
  });

  const researchMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/opportunities/${id}/research`),
    onSuccess: () => {
      toast({ title: "Исследование запущено" });
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
    },
  });

  const estimateMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/opportunities/${id}/estimate`),
    onSuccess: () => {
      toast({ title: "Оценка вероятности завершена" });
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
    },
  });

  const riskMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/opportunities/${id}/risk`),
    onSuccess: () => {
      toast({ title: "Оценка рисков завершена" });
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
    },
  });

  const executeMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/opportunities/${id}/execute`),
    onSuccess: () => {
      toast({ title: "Сделка исполнена" });
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/positions"] });
    },
  });

  const getStageAction = (opp: any) => {
    switch (opp.pipelineStage) {
      case "scan":
        return { label: "Исследовать", fn: () => researchMut.mutate(opp.id), pending: researchMut.isPending };
      case "research":
        return { label: "Оценить P", fn: () => estimateMut.mutate(opp.id), pending: estimateMut.isPending };
      case "probability":
        return { label: "Оценить риск", fn: () => riskMut.mutate(opp.id), pending: riskMut.isPending };
      case "risk":
        return opp.status === "approved" ? { label: "Исполнить", fn: () => executeMut.mutate(opp.id), pending: executeMut.isPending } : null;
      default:
        return null;
    }
  };

  const statusColors: Record<string, string> = {
    discovered: "bg-blue-500/10 text-blue-500",
    researching: "bg-yellow-500/10 text-yellow-500",
    analyzed: "bg-purple-500/10 text-purple-500",
    approved: "bg-green-500/10 text-green-500",
    rejected: "bg-red-500/10 text-red-500",
    settled: "bg-muted text-muted-foreground",
  };

  const stageLabels: Record<string, string> = {
    scan: "Сканирование",
    research: "Исследование",
    probability: "Вероятность",
    risk: "Риск",
    execution: "Исполнение",
    monitoring: "Мониторинг",
    settlement: "Расчёт",
    postmortem: "Пост-мортем",
  };

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6" data-testid="scanner-page">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Сканер рынков</h2>
          <p className="text-sm text-muted-foreground">Поиск и анализ возможностей на прогнозных рынках</p>
        </div>
        <Button onClick={() => scanMut.mutate()} disabled={scanMut.isPending} data-testid="btn-scan">
          <RefreshCw className={`w-4 h-4 mr-2 ${scanMut.isPending ? "animate-spin" : ""}`} />
          {scanMut.isPending ? "Сканирование..." : "Сканировать рынки"}
        </Button>
      </div>

      {/* Active filters */}
      <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
        <span>Фильтры:</span>
        {((config as any)?.pipeline_sectors || "sports,crypto,politics,tech,other").split(",").map((s: string) => (
          <Badge key={s.trim()} variant="outline" className="text-[10px] h-4">{s.trim()}</Badge>
        ))}
        <span>| {(config as any)?.pipeline_min_days || "1"}-{(config as any)?.pipeline_max_days || "90"} дней</span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-6 gap-3">
        {["scan", "research", "probability", "risk", "monitoring", "settlement"].map(stage => {
          const count = (opportunities || []).filter((o: any) => o.pipelineStage === stage).length;
          return (
            <Card key={stage}>
              <CardContent className="py-3 px-3 text-center">
                <div className="text-lg font-semibold">{count}</div>
                <div className="text-[10px] text-muted-foreground">{stageLabels[stage]}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Opportunities Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Все возможности ({(opportunities || []).length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            <div className="grid grid-cols-12 gap-2 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider border-b">
              <div className="col-span-4">Рынок</div>
              <div className="col-span-1">Платформа</div>
              <div className="col-span-1">Цена</div>
              <div className="col-span-1">AI P</div>
              <div className="col-span-1">Edge</div>
              <div className="col-span-1">Стадия</div>
              <div className="col-span-1">Статус</div>
              <div className="col-span-2">Действие</div>
            </div>
            {(opportunities || []).map((opp: any) => {
              const action = getStageAction(opp);
              return (
                <div key={opp.id} className="grid grid-cols-12 gap-2 py-2 items-center border-b border-border/30 hover:bg-muted/30 transition-colors text-xs">
                  <div className="col-span-4 truncate font-medium" title={opp.title}>{opp.title}</div>
                  <div className="col-span-1">
                    <Badge variant="outline" className="text-[10px] h-4">{opp.platform}</Badge>
                  </div>
                  <div className="col-span-1 font-mono">{opp.currentPrice != null ? `${(opp.currentPrice * 100).toFixed(0)}%` : "—"}</div>
                  <div className="col-span-1 font-mono">{opp.aiProbability != null ? `${(opp.aiProbability * 100).toFixed(0)}%` : "—"}</div>
                  <div className={`col-span-1 font-mono ${(opp.edge || 0) > 0 ? "text-green-500" : (opp.edge || 0) < 0 ? "text-red-500" : ""}`}>
                    {opp.edge != null ? `${opp.edge > 0 ? "+" : ""}${(opp.edge * 100).toFixed(1)}%` : "—"}
                  </div>
                  <div className="col-span-1">
                    <Badge variant="secondary" className="text-[10px] h-4">{stageLabels[opp.pipelineStage] || opp.pipelineStage}</Badge>
                  </div>
                  <div className="col-span-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColors[opp.status] || ""}`}>{opp.status}</span>
                  </div>
                  <div className="col-span-2">
                    {action && (
                      <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={action.fn} disabled={action.pending}>
                        {action.pending ? <RefreshCw className="w-3 h-3 animate-spin" /> : (
                          <>
                            {action.label}
                            <ArrowRight className="w-3 h-3 ml-1" />
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
            {(!opportunities || opportunities.length === 0) && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Нет возможностей. Нажмите "Сканировать рынки" для поиска.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
