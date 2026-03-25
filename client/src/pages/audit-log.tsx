import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function AuditLogPage() {
  const { data: auditLog } = useQuery({
    queryKey: ["/api/audit-log"],
  });

  const actionColors: Record<string, string> = {
    scan: "bg-blue-500/10 text-blue-500",
    research: "bg-purple-500/10 text-purple-500",
    predict: "bg-indigo-500/10 text-indigo-500",
    assess_risk: "bg-yellow-500/10 text-yellow-500",
    approve: "bg-green-500/10 text-green-500",
    execute: "bg-primary/10 text-primary",
    settle: "bg-emerald-500/10 text-emerald-500",
    postmortem: "bg-orange-500/10 text-orange-500",
  };

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6" data-testid="audit-log-page">
      <div>
        <h2 className="text-xl font-semibold">Журнал аудита</h2>
        <p className="text-sm text-muted-foreground">Все действия системы и агентов</p>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="space-y-1">
            <div className="grid grid-cols-12 gap-2 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider border-b">
              <div className="col-span-2">Время</div>
              <div className="col-span-1">Действие</div>
              <div className="col-span-2">Тип</div>
              <div className="col-span-2">Актор</div>
              <div className="col-span-5">Детали</div>
            </div>
            {(auditLog || []).map((entry: any) => (
              <div key={entry.id} className="grid grid-cols-12 gap-2 py-2 items-center border-b border-border/30 text-xs">
                <div className="col-span-2 text-muted-foreground">
                  {new Date(entry.timestamp).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </div>
                <div className="col-span-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${actionColors[entry.action] || ""}`}>
                    {entry.action}
                  </span>
                </div>
                <div className="col-span-2">
                  <Badge variant="outline" className="text-[10px]">{entry.entityType}</Badge>
                  {entry.entityId && <span className="text-muted-foreground ml-1">#{entry.entityId}</span>}
                </div>
                <div className="col-span-2 font-mono text-muted-foreground">{entry.actor}</div>
                <div className="col-span-5 truncate text-muted-foreground">
                  {tryParseDetails(entry.details)}
                </div>
              </div>
            ))}
            {(!auditLog || auditLog.length === 0) && (
              <div className="py-8 text-center text-sm text-muted-foreground">Нет записей в журнале</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function tryParseDetails(details: string | null): string {
  if (!details) return "";
  try {
    const obj = JSON.parse(details);
    return Object.entries(obj).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(", ").slice(0, 120);
  } catch {
    return (details || "").slice(0, 120);
  }
}
