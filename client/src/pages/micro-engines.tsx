import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Play, Square, Zap } from "lucide-react";
import MicroDashboard from "./micro-dashboard";

function EngineControl({ engine, label }: { engine: string; label: string }) {
  const { toast } = useToast();
  const { data: status } = useQuery({
    queryKey: ["/api/micro/status"],
    refetchInterval: 10000,
  });

  const schedulerActive = (status as any)?.active;

  const toggleEngine = useMutation({
    mutationFn: (enabled: boolean) =>
      apiRequest("POST", "/api/micro/engine", { engine, enabled }),
    onSuccess: () => {
      toast({ title: `Модель ${engine} обновлена` });
      queryClient.invalidateQueries({ queryKey: ["/api/micro/status"] });
    },
  });

  const startScheduler = useMutation({
    mutationFn: () => apiRequest("POST", "/api/micro/start"),
    onSuccess: () => {
      toast({ title: "Планировщик запущен" });
      queryClient.invalidateQueries({ queryKey: ["/api/micro/status"] });
    },
  });

  const stopScheduler = useMutation({
    mutationFn: () => apiRequest("POST", "/api/micro/stop"),
    onSuccess: () => {
      toast({ title: "Планировщик остановлен" });
      queryClient.invalidateQueries({ queryKey: ["/api/micro/status"] });
    },
  });

  // Read engine enabled state from status
  const engineKey = `engine_${engine.toLowerCase()}_enabled`;
  const isEnabled = true; // default on

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border/30">
      <Badge variant={schedulerActive ? "default" : "secondary"} className="gap-1">
        <div className={`w-1.5 h-1.5 rounded-full ${schedulerActive ? "bg-green-400" : "bg-gray-400"}`} />
        {schedulerActive ? "Активен" : "Остановлен"}
      </Badge>
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex-1" />
      {!schedulerActive ? (
        <Button size="sm" variant="default" className="h-7 text-xs gap-1" onClick={() => startScheduler.mutate()}>
          <Play className="h-3 w-3" /> Запустить всё
        </Button>
      ) : (
        <Button size="sm" variant="destructive" className="h-7 text-xs gap-1" onClick={() => stopScheduler.mutate()}>
          <Square className="h-3 w-3" /> Остановить всё
        </Button>
      )}
    </div>
  );
}

export default function MicroEngines() {
  const [engineTab, setEngineTab] = useState("all");
  const [tfTab, setTfTab] = useState(""); // "" = all timeframes

  const engineLabels: Record<string, string> = {
    all: "Все модели",
    A: "Arena — 5 TA-моделей",
    B: "Bayesian Edge — adaptive base rate",
    C: "Latency Arbitrage — спот vs Polymarket",
    D: "ARIMA(3,1,1) — статпрогноз",
  };

  const currentEngine = engineTab === "all" ? undefined : engineTab;
  const currentTf = tfTab || undefined;

  return (
    <div className="flex-1 overflow-auto">
      <div className="border-b border-border bg-background/95 backdrop-blur sticky top-0 z-10 px-4 pt-3 space-y-2 pb-2">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-amber-500" />
          <h2 className="text-lg font-semibold">Крипто торговля</h2>
        </div>
        {/* Row 1: Engine tabs */}
        <Tabs value={engineTab} onValueChange={setEngineTab}>
          <TabsList className="grid w-full max-w-xl grid-cols-5">
            <TabsTrigger value="all" className="text-xs">Все</TabsTrigger>
            <TabsTrigger value="A" className="text-xs">Арена</TabsTrigger>
            <TabsTrigger value="B" className="text-xs">Байес</TabsTrigger>
            <TabsTrigger value="C" className="text-xs">Latency</TabsTrigger>
            <TabsTrigger value="D" className="text-xs">ARIMA</TabsTrigger>
          </TabsList>
        </Tabs>
        {/* Row 2: Timeframe tabs */}
        <Tabs value={tfTab} onValueChange={setTfTab}>
          <TabsList className="grid w-full max-w-xs grid-cols-4">
            <TabsTrigger value="" className="text-xs">Все TF</TabsTrigger>
            <TabsTrigger value="5m" className="text-xs">5 мин</TabsTrigger>
            <TabsTrigger value="15m" className="text-xs">15 мин</TabsTrigger>
            <TabsTrigger value="1h" className="text-xs">1 час</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <EngineControl engine={engineTab === "all" ? "ALL" : engineTab} label={engineLabels[engineTab] || ""} />
      <MicroDashboard engine={currentEngine} timeframe={currentTf} />
    </div>
  );
}
