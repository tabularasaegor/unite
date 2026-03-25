import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, Check, X, AlertTriangle, ShieldOff } from "lucide-react";

export default function RiskConsole() {
  const { toast } = useToast();

  const { data: opportunities } = useQuery({
    queryKey: ["/api/opportunities"],
    refetchInterval: 5000,
  });

  const { data: positions } = useQuery({
    queryKey: ["/api/positions", "open"],
    queryFn: () => apiRequest("GET", "/api/positions?status=open").then(r => r.json()),
    refetchInterval: 5000,
  });

  const { data: config } = useQuery({
    queryKey: ["/api/config"],
    refetchInterval: 5000,
  });

  const { data: pipelineStatus } = useQuery({
    queryKey: ["/api/pipeline/status"],
    refetchInterval: 5000,
  });

  const killSwitchMut = useMutation({
    mutationFn: (enabled: boolean) => apiRequest("POST", "/api/config/kill-switch", { enabled }),
    onSuccess: () => {
      toast({ title: "Kill Switch обновлён" });
      queryClient.invalidateQueries({ queryKey: ["/api/config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pipeline/status"] });
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err.message, variant: "destructive" }),
  });

  const approveMut = useMutation({
    mutationFn: async (oppId: number) => {
      const riskRes = await apiRequest("GET", `/api/opportunities/${oppId}/risk`).then(r => r.json());
      if (!riskRes?.id) throw new Error("No risk assessment");
      return apiRequest("POST", `/api/risk/${riskRes.id}/approve`);
    },
    onSuccess: () => {
      toast({ title: "Одобрено" });
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
    },
  });

  const rejectMut = useMutation({
    mutationFn: async (oppId: number) => {
      const riskRes = await apiRequest("GET", `/api/opportunities/${oppId}/risk`).then(r => r.json());
      if (!riskRes?.id) throw new Error("No risk assessment");
      return apiRequest("POST", `/api/risk/${riskRes.id}/reject`, { reason: "Отклонено" });
    },
    onSuccess: () => {
      toast({ title: "Отклонено" });
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

  const pendingApproval = (opportunities || []).filter((o: any) => o.pipelineStage === "risk" && o.status === "analyzed");
  const approved = (opportunities || []).filter((o: any) => o.status === "approved" && o.pipelineStage === "risk");
  const openPositions = positions || [];

  const bankroll = parseFloat(config?.bankroll || "10000");
  const totalExposure = openPositions.reduce((s: number, p: any) => s + p.size, 0);
  const exposurePct = bankroll > 0 ? (totalExposure / bankroll) * 100 : 0;
  const totalUnrealizedPnl = openPositions.reduce((s: number, p: any) => s + (p.unrealizedPnl || 0), 0);

  const isKillSwitchActive = config?.kill_switch === "true" || pipelineStatus?.killSwitch;

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6" data-testid="risk-console-page">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Риск-консоль</h2>
          <p className="text-sm text-muted-foreground">Управление рисками, одобрение сделок, мониторинг портфеля</p>
        </div>
      </div>

      {/* Kill Switch Banner */}
      <Card className={isKillSwitchActive ? "border-red-500/50 bg-red-500/5" : "border-green-500/30 bg-green-500/5"}>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {isKillSwitchActive ? (
                <AlertTriangle className="w-5 h-5 text-red-500" />
              ) : (
                <ShieldCheck className="w-5 h-5 text-green-500" />
              )}
              <div>
                <div className="font-medium text-sm">
                  {isKillSwitchActive ? "Kill Switch АКТИВЕН — торговля остановлена" : "Торговля разрешена"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {isKillSwitchActive ? "Все исполнения заблокированы. Нажмите для снятия." : "Система работает в штатном режиме."}
                </div>
              </div>
            </div>
            <Button
              variant={isKillSwitchActive ? "default" : "destructive"}
              size="sm"
              onClick={() => killSwitchMut.mutate(!isKillSwitchActive)}
              disabled={killSwitchMut.isPending}
              data-testid="btn-kill-switch"
            >
              {isKillSwitchActive ? (
                <><ShieldCheck className="w-4 h-4 mr-1.5" /> Снять Kill Switch</>
              ) : (
                <><ShieldOff className="w-4 h-4 mr-1.5" /> Активировать Kill Switch</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Portfolio Risk Overview */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-1">Банкролл</div>
            <div className="text-lg font-semibold tabular-nums">${bankroll.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-1">Экспозиция</div>
            <div className={`text-lg font-semibold tabular-nums ${exposurePct > 50 ? "text-red-500" : exposurePct > 30 ? "text-yellow-500" : "text-green-500"}`}>
              ${totalExposure.toFixed(0)} ({exposurePct.toFixed(1)}%)
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-1">Нереализ. P&L</div>
            <div className={`text-lg font-semibold tabular-nums ${totalUnrealizedPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
              ${totalUnrealizedPnl.toFixed(2)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-1">Открытых позиций</div>
            <div className="text-lg font-semibold">{openPositions.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Pending Approvals */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" />
            Ожидают одобрения ({pendingApproval.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {pendingApproval.map((opp: any) => (
              <div key={opp.id} className="flex items-center justify-between py-2 border-b border-border/30">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{opp.title}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <Badge variant="outline" className="text-[10px]">{opp.platform}</Badge>
                    <span className="text-xs font-mono tabular-nums">Edge: {opp.edge != null ? `${(opp.edge * 100).toFixed(1)}%` : "—"}</span>
                    <span className="text-xs font-mono tabular-nums">Kelly: {opp.kellyFraction != null ? `${(opp.kellyFraction * 100).toFixed(1)}%` : "—"}</span>
                    <span className="text-xs font-mono tabular-nums">Size: ${(opp.recommendedSize || 0).toFixed(0)}</span>
                    <Badge variant={opp.recommendedSide === "YES" ? "default" : "destructive"}>{opp.recommendedSide || "—"}</Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <Button size="sm" onClick={() => approveMut.mutate(opp.id)} disabled={approveMut.isPending} data-testid={`btn-approve-${opp.id}`}>
                    <Check className="w-3.5 h-3.5 mr-1" /> Одобрить
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => rejectMut.mutate(opp.id)} disabled={rejectMut.isPending}>
                    <X className="w-3.5 h-3.5 mr-1" /> Отклонить
                  </Button>
                </div>
              </div>
            ))}
            {pendingApproval.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Нет сделок на одобрение</p>}
          </div>
        </CardContent>
      </Card>

      {/* Approved Ready to Execute */}
      {approved.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Одобрены — готовы к исполнению ({approved.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {approved.map((opp: any) => (
                <div key={opp.id} className="flex items-center justify-between py-2 border-b border-border/30">
                  <div>
                    <p className="text-sm font-medium">{opp.title}</p>
                    <span className="text-xs text-muted-foreground">{opp.recommendedSide} · ${(opp.recommendedSize || 0).toFixed(0)}</span>
                  </div>
                  <Button size="sm" onClick={() => executeMut.mutate(opp.id)} disabled={executeMut.isPending || isKillSwitchActive} data-testid={`btn-execute-${opp.id}`}>
                    Исполнить
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Open Positions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Активные позиции ({openPositions.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {openPositions.map((pos: any) => (
              <div key={pos.id} className="flex items-center justify-between py-2 border-b border-border/30 text-xs">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{pos.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge variant="outline" className="text-[10px]">{pos.platform}</Badge>
                    <Badge variant={pos.side === "YES" ? "default" : "destructive"} className="text-[10px]">{pos.side}</Badge>
                    <span className="font-mono tabular-nums">Вход: {(pos.entryPrice * 100).toFixed(1)}%</span>
                    <span className="font-mono tabular-nums">Текущ: {((pos.currentPrice || 0) * 100).toFixed(1)}%</span>
                  </div>
                </div>
                <div className="text-right ml-4">
                  <div className={`text-sm font-mono font-semibold tabular-nums ${(pos.unrealizedPnl || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                    ${(pos.unrealizedPnl || 0).toFixed(2)}
                  </div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">${pos.size.toFixed(0)}</div>
                </div>
              </div>
            ))}
            {openPositions.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Нет открытых позиций</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
