import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { DataTable, StatusBadge, PageHeader, formatDate } from "@/components/shared";
import { Search, Loader2 } from "lucide-react";
import type { Opportunity } from "@shared/schema";

export default function Scanner() {
  const { data: opportunities = [], isLoading } = useQuery<Opportunity[]>({
    queryKey: ["/api/opportunities?stage=scanned"],
  });

  const scanMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/pipeline/scan");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pipeline/stats"] });
    },
  });

  const headers = ["ID", "Рынок", "Платформа", "Категория", "Цена", "Объём", "Стадия", "Дата"];

  return (
    <div>
      <PageHeader
        title="Сканер"
        subtitle="Обнаружение рынков Polymarket"
        actions={
          <Button
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
            className="gap-2"
            data-testid="button-run-scan"
          >
            {scanMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Запустить сканирование
          </Button>
        }
      />

      <Card>
        <CardContent className="pt-6">
          <DataTable
            headers={headers}
            isLoading={isLoading}
            isEmpty={opportunities.length === 0}
            emptyMessage="Нет результатов сканирования"
          >
            {opportunities.map((opp) => (
              <TableRow key={opp.id}>
                <TableCell className="font-mono text-xs">{opp.id}</TableCell>
                <TableCell className="max-w-[300px]">
                  <p className="truncate text-sm font-medium">{opp.title}</p>
                </TableCell>
                <TableCell className="text-sm">{opp.platform}</TableCell>
                <TableCell className="text-sm">{opp.category}</TableCell>
                <TableCell className="font-mono text-sm">
                  {opp.currentPrice != null ? `$${opp.currentPrice.toFixed(2)}` : "—"}
                </TableCell>
                <TableCell className="font-mono text-sm">
                  {opp.volume24h != null ? `$${opp.volume24h.toFixed(0)}` : "—"}
                </TableCell>
                <TableCell>
                  <StatusBadge status={opp.pipelineStage} />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground font-mono">
                  {formatDate(opp.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </DataTable>
        </CardContent>
      </Card>
    </div>
  );
}
