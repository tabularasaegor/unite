import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { KPICard, StatusBadge, PageHeader } from "@/components/shared";
import {
  Search,
  FileText,
  Briefcase,
  DollarSign,
  ArrowRight,
} from "lucide-react";
import type { Opportunity } from "@shared/schema";

interface PipelineStats {
  scanCount: number;
  researchCount: number;
  positionCount: number;
  totalPnl: number;
}

const stages = [
  { key: "scanned", label: "Сканирование" },
  { key: "researched", label: "Исследование" },
  { key: "estimated", label: "Оценка" },
  { key: "risk_assessed", label: "Риск" },
  { key: "approved", label: "Одобрено" },
  { key: "executed", label: "Исполнено" },
  { key: "settled", label: "Расчёт" },
];

export default function PipelineDashboard() {
  const { data: stats, isLoading } = useQuery<PipelineStats>({
    queryKey: ["/api/pipeline/stats"],
  });

  const { data: opportunities = [] } = useQuery<Opportunity[]>({
    queryKey: ["/api/opportunities?limit=10"],
  });

  return (
    <div>
      <PageHeader
        title="Пайплайн"
        subtitle="Полный конвейер обработки prediction market событий"
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="Просканировано"
          value={stats?.scanCount ?? 0}
          icon={<Search className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <KPICard
          title="Исследовано"
          value={stats?.researchCount ?? 0}
          icon={<FileText className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <KPICard
          title="Позиций"
          value={stats?.positionCount ?? 0}
          icon={<Briefcase className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <KPICard
          title="P&L"
          value={`$${(stats?.totalPnl ?? 0).toFixed(2)}`}
          icon={<DollarSign className="h-4 w-4" />}
          trend={(stats?.totalPnl ?? 0) >= 0 ? "up" : "down"}
          isLoading={isLoading}
        />
      </div>

      {/* Pipeline Flow */}
      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Поток пайплайна</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            {stages.map((stage, i) => (
              <div key={stage.key} className="flex items-center gap-2">
                <div className="flex flex-col items-center">
                  <Badge
                    variant="outline"
                    className="text-xs px-3 py-1 whitespace-nowrap"
                  >
                    {stage.label}
                  </Badge>
                  <span className="text-[10px] font-mono text-muted-foreground mt-1">
                    {opportunities.filter((o) => o.pipelineStage === stage.key).length}
                  </span>
                </div>
                {i < stages.length - 1 && (
                  <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent Opportunities */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Последние возможности</CardTitle>
        </CardHeader>
        <CardContent>
          {opportunities.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Нет возможностей. Запустите сканирование.
            </p>
          ) : (
            <div className="space-y-2">
              {opportunities.slice(0, 10).map((opp) => (
                <div
                  key={opp.id}
                  className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/50 text-sm"
                >
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium">{opp.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {opp.platform} · {opp.category}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 ml-4 shrink-0">
                    {opp.currentPrice != null && (
                      <span className="font-mono text-xs">${opp.currentPrice.toFixed(2)}</span>
                    )}
                    {opp.edge != null && (
                      <span className={`font-mono text-xs ${opp.edge > 0 ? "text-emerald-500" : "text-red-500"}`}>
                        {(opp.edge * 100).toFixed(1)}%
                      </span>
                    )}
                    <StatusBadge status={opp.pipelineStage} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
