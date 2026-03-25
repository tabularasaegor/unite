import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { useState } from "react";

export default function Opportunities() {
  const [stageFilter, setStageFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const { data: opportunities } = useQuery({
    queryKey: ["/api/opportunities"],
    refetchInterval: 10000,
  });

  const filtered = (opportunities || []).filter((o: any) => {
    if (stageFilter && o.pipelineStage !== stageFilter) return false;
    if (statusFilter && o.status !== statusFilter) return false;
    return true;
  });

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

  const statusColors: Record<string, string> = {
    discovered: "bg-blue-500/10 text-blue-500",
    researching: "bg-yellow-500/10 text-yellow-500",
    analyzed: "bg-purple-500/10 text-purple-500",
    approved: "bg-green-500/10 text-green-500",
    rejected: "bg-red-500/10 text-red-500",
    settled: "bg-muted text-muted-foreground",
  };

  const stages = ["scan", "research", "probability", "risk", "monitoring", "settlement"];

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6" data-testid="opportunities-page">
      <div>
        <h2 className="text-xl font-semibold">Возможности</h2>
        <p className="text-sm text-muted-foreground">Все возможности на рынках предсказаний</p>
      </div>

      {/* Stage filters */}
      <div className="flex items-center gap-2">
        <Badge
          variant={stageFilter === "" ? "default" : "outline"}
          className="cursor-pointer"
          onClick={() => setStageFilter("")}
        >
          Все ({(opportunities || []).length})
        </Badge>
        {stages.map(stage => {
          const count = (opportunities || []).filter((o: any) => o.pipelineStage === stage).length;
          if (count === 0) return null;
          return (
            <Badge
              key={stage}
              variant={stageFilter === stage ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setStageFilter(stageFilter === stage ? "" : stage)}
            >
              {stageLabels[stage]} ({count})
            </Badge>
          );
        })}
      </div>

      {/* Status filters */}
      <div className="flex items-center gap-2">
        {["discovered", "analyzed", "approved", "rejected"].map(status => {
          const count = (opportunities || []).filter((o: any) => o.status === status).length;
          if (count === 0) return null;
          return (
            <Badge
              key={status}
              variant={statusFilter === status ? "default" : "secondary"}
              className="cursor-pointer"
              onClick={() => setStatusFilter(statusFilter === status ? "" : status)}
            >
              {status} ({count})
            </Badge>
          );
        })}
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Возможности ({filtered.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            <div className="grid grid-cols-12 gap-2 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider border-b">
              <div className="col-span-4">Рынок</div>
              <div className="col-span-1">Цена</div>
              <div className="col-span-1">AI P</div>
              <div className="col-span-1">Edge</div>
              <div className="col-span-1">Сторона</div>
              <div className="col-span-1">Размер</div>
              <div className="col-span-1">Стадия</div>
              <div className="col-span-2">Статус</div>
            </div>
            {filtered.map((opp: any) => (
              <Link key={opp.id} href={`/opportunities/${opp.id}`}>
                <div className="grid grid-cols-12 gap-2 py-2 items-center border-b border-border/30 hover:bg-muted/30 transition-colors text-xs cursor-pointer">
                  <div className="col-span-4">
                    <p className="truncate font-medium" title={opp.title}>{opp.title}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge variant="outline" className="text-[10px] h-4">{opp.platform}</Badge>
                      <span className="text-[10px] text-muted-foreground">{opp.category}</span>
                    </div>
                  </div>
                  <div className="col-span-1 font-mono tabular-nums">{opp.currentPrice != null ? `${(opp.currentPrice * 100).toFixed(0)}%` : "—"}</div>
                  <div className="col-span-1 font-mono tabular-nums">{opp.aiProbability != null ? `${(opp.aiProbability * 100).toFixed(0)}%` : "—"}</div>
                  <div className={`col-span-1 font-mono tabular-nums ${(opp.edge || 0) > 0 ? "text-green-500" : (opp.edge || 0) < 0 ? "text-red-500" : ""}`}>
                    {opp.edge != null ? `${opp.edge > 0 ? "+" : ""}${(opp.edge * 100).toFixed(1)}%` : "—"}
                  </div>
                  <div className="col-span-1">
                    {opp.recommendedSide ? (
                      <Badge variant={opp.recommendedSide === "YES" ? "default" : "destructive"} className="text-[10px] h-4">{opp.recommendedSide}</Badge>
                    ) : "—"}
                  </div>
                  <div className="col-span-1 font-mono tabular-nums">
                    {opp.recommendedSize != null ? `$${opp.recommendedSize.toFixed(0)}` : "—"}
                  </div>
                  <div className="col-span-1">
                    <Badge variant="secondary" className="text-[10px] h-4">{stageLabels[opp.pipelineStage] || opp.pipelineStage}</Badge>
                  </div>
                  <div className="col-span-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColors[opp.status] || ""}`}>{opp.status}</span>
                  </div>
                </div>
              </Link>
            ))}
            {filtered.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Нет возможностей. Запустите сканирование для поиска.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
