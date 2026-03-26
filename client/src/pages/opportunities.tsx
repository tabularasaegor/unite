import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { DataTable, StatusBadge, PageHeader, formatDate } from "@/components/shared";
import { PlayCircle } from "lucide-react";
import type { Opportunity } from "@shared/schema";

const headers = ["Рынок", "Платформа", "Цена", "Объём", "AI Вероятность", "Edge", "Стадия", "Действия"];

export default function Opportunities() {
  const { data: opportunities = [], isLoading } = useQuery<Opportunity[]>({
    queryKey: ["/api/opportunities"],
  });

  const advanceMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/pipeline/advance/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
    },
  });

  return (
    <div>
      <PageHeader title="Возможности" subtitle="Список обнаруженных рынков" />
      <Card>
        <CardContent className="pt-6">
          <DataTable
            headers={headers}
            isLoading={isLoading}
            isEmpty={opportunities.length === 0}
            emptyMessage="Нет возможностей"
          >
            {opportunities.map((opp) => (
              <TableRow key={opp.id}>
                <TableCell className="max-w-[250px]">
                  <p className="truncate text-sm font-medium">{opp.title}</p>
                  <p className="text-xs text-muted-foreground">{opp.category}</p>
                </TableCell>
                <TableCell className="text-sm">{opp.platform}</TableCell>
                <TableCell className="font-mono text-sm">
                  {opp.currentPrice != null ? `$${opp.currentPrice.toFixed(2)}` : "—"}
                </TableCell>
                <TableCell className="font-mono text-sm">
                  {opp.volume24h != null ? `$${opp.volume24h.toFixed(0)}` : "—"}
                </TableCell>
                <TableCell className="font-mono text-sm">
                  {opp.aiProbability != null ? `${(opp.aiProbability * 100).toFixed(1)}%` : "—"}
                </TableCell>
                <TableCell>
                  {opp.edge != null ? (
                    <span className={`font-mono text-sm ${opp.edge > 0 ? "text-emerald-500" : "text-red-500"}`}>
                      {opp.edge > 0 ? "+" : ""}{(opp.edge * 100).toFixed(1)}%
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  <StatusBadge status={opp.pipelineStage} />
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => advanceMutation.mutate(opp.id)}
                    disabled={advanceMutation.isPending}
                    data-testid={`button-advance-${opp.id}`}
                  >
                    <PlayCircle className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </DataTable>
        </CardContent>
      </Card>
    </div>
  );
}
