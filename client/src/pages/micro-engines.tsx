import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Play, Square, Zap, Power } from "lucide-react";
import MicroDashboard from "./micro-dashboard";

const ENGINE_META: Record<string, { label: string; color: string }> = {
  A: { label: "Арена", color: "bg-blue-500" },
  B: { label: "Байес", color: "bg-purple-500" },
  C: { label: "Latency", color: "bg-amber-500" },
  D: { label: "ARIMA", color: "bg-emerald-500" },
  E: { label: "Киты", color: "bg-cyan-500" },
};

function EngineToggle({ engineId, enabled, schedulerActive }: { engineId: string; enabled: boolean; schedulerActive: boolean }) {
  const { toast } = useToast();
  const meta = ENGINE_META[engineId] || { label: engineId, color: "bg-gray-500" };

  const toggle = useMutation({
    mutationFn: () => apiRequest("POST", "/api/micro/engine", { engine: engineId, enabled: !enabled }),
    onSuccess: () => {
      toast({ title: `${meta.label} ${!enabled ? "включена" : "выключена"}` });
      queryClient.invalidateQueries({ queryKey: ["/api/micro/status"] });
    },
  });

  return (
    <Button
      size="sm"
      variant={enabled ? "default" : "outline"}
      className={`h-7 text-xs gap-1.5 ${enabled ? "" : "opacity-50"}`}
      onClick={() => toggle.mutate()}
      disabled={toggle.isPending}
    >
      <div className={`w-2 h-2 rounded-full ${enabled ? meta.color : "bg-gray-400"}`} />
      {meta.label}
      <span className="text-[10px] opacity-70">{enabled ? "ON" : "OFF"}</span>
    </Button>
  );
}

function SchedulerBar() {
  const { toast } = useToast();
  const { data: status } = useQuery({
    queryKey: ["/api/micro/status"],
    refetchInterval: 5000,
  });

  const s = status as any;
  const active = s?.active;
  const engines = s?.engines || { A: true, B: true, C: true, D: true, E: true };

  const start = useMutation({
    mutationFn: () => apiRequest("POST", "/api/micro/start"),
    onSuccess: () => {
      toast({ title: "Планировщик запущен" });
      queryClient.invalidateQueries({ queryKey: ["/api/micro/status"] });
    },
  });

  const stop = useMutation({
    mutationFn: () => apiRequest("POST", "/api/micro/stop"),
    onSuccess: () => {
      toast({ title: "Планировщик остановлен" });
      queryClient.invalidateQueries({ queryKey: ["/api/micro/status"] });
    },
  });

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border/30 flex-wrap">
      <Badge variant={active ? "default" : "secondary"} className="gap-1 shrink-0">
        <div className={`w-1.5 h-1.5 rounded-full ${active ? "bg-green-400 animate-pulse" : "bg-gray-400"}`} />
        {active ? "Активен" : "Стоп"}
      </Badge>

      {/* Per-engine toggles */}
      <div className="flex items-center gap-1">
        {(["A", "B", "C", "D"] as const).map(id => (
          <EngineToggle key={id} engineId={id} enabled={engines[id] ?? true} schedulerActive={active} />
        ))}
      </div>

      <div className="flex-1" />

      {/* Global start/stop */}
      {!active ? (
        <Button size="sm" variant="default" className="h-7 text-xs gap-1" onClick={() => start.mutate()} disabled={start.isPending}>
          <Play className="h-3 w-3" /> Запустить
        </Button>
      ) : (
        <Button size="sm" variant="destructive" className="h-7 text-xs gap-1" onClick={() => stop.mutate()} disabled={stop.isPending}>
          <Square className="h-3 w-3" /> Стоп
        </Button>
      )}
    </div>
  );
}

export default function MicroEngines() {
  const [engineTab, setEngineTab] = useState("all");
  const currentEngine = engineTab === "all" ? undefined : engineTab;

  return (
    <div className="flex-1 overflow-auto">
      <div className="border-b border-border bg-background/95 backdrop-blur sticky top-0 z-10 px-4 pt-3 space-y-2 pb-2">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-amber-500" />
          <h2 className="text-lg font-semibold">Крипто торговля</h2>
        </div>
        {/* Row 1: Engine filter */}
        <Tabs value={engineTab} onValueChange={setEngineTab}>
          <TabsList className="grid w-full max-w-2xl grid-cols-6">
            <TabsTrigger value="all" className="text-xs">Все</TabsTrigger>
            <TabsTrigger value="A" className="text-xs">Арена</TabsTrigger>
            <TabsTrigger value="B" className="text-xs">Байес</TabsTrigger>
            <TabsTrigger value="C" className="text-xs">Latency</TabsTrigger>
            <TabsTrigger value="D" className="text-xs">ARIMA</TabsTrigger>
            <TabsTrigger value="E" className="text-xs">Киты</TabsTrigger>
          </TabsList>
        </Tabs>
        {/* Timeframe: 5m only */}
      </div>

      {/* Scheduler + engine toggles */}
      <SchedulerBar />

      {/* Dashboard filtered by selected engine + timeframe */}
      <MicroDashboard engine={currentEngine} />
    </div>
  );
}
