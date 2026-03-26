import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import { DataTable, PageHeader, formatDate } from "@/components/shared";
import { Search } from "lucide-react";
import type { AuditLogEntry } from "@shared/schema";

export default function AuditLog() {
  const [search, setSearch] = useState("");

  const { data: entries = [], isLoading } = useQuery<AuditLogEntry[]>({
    queryKey: ["/api/audit"],
  });

  const filtered = search
    ? entries.filter(
        (e) =>
          e.action.toLowerCase().includes(search.toLowerCase()) ||
          (e.details ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : entries;

  const headers = ["Время", "Действие", "Детали", "Пользователь"];

  return (
    <div>
      <PageHeader title="Аудит" subtitle="Журнал действий системы" />

      <Card>
        <CardContent className="pt-6">
          <div className="mb-4 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск по действию или деталям..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-audit-search"
            />
          </div>

          <DataTable
            headers={headers}
            isLoading={isLoading}
            isEmpty={filtered.length === 0}
            emptyMessage="Нет записей"
          >
            {filtered.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                  {formatDate(entry.createdAt)}
                </TableCell>
                <TableCell className="text-sm font-medium">{entry.action}</TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[400px] truncate">
                  {entry.details ?? "—"}
                </TableCell>
                <TableCell className="text-sm font-mono">{entry.userId ?? "system"}</TableCell>
              </TableRow>
            ))}
          </DataTable>
        </CardContent>
      </Card>
    </div>
  );
}
