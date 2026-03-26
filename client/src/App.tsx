import { Switch, Route, Router, Redirect } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar, MobileHeader } from "@/components/AppSidebar";
import { Loader2 } from "lucide-react";

// Pages
import LoginPage from "@/pages/login";
import MicroDashboard from "@/pages/micro-dashboard";
import MicroPositions from "@/pages/micro-positions";
import MicroTrades from "@/pages/micro-trades";
import MicroSettlements from "@/pages/micro-settlements";
import PipelineDashboard from "@/pages/pipeline-dashboard";
import Scanner from "@/pages/scanner";
import Opportunities from "@/pages/opportunities";
import RiskConsole from "@/pages/risk-console";
import PipelinePositions from "@/pages/pipeline-positions";
import PipelineTrades from "@/pages/pipeline-trades";
import PipelineSettlements from "@/pages/pipeline-settlements";
import PostMortems from "@/pages/postmortems";
import AuditLog from "@/pages/audit";
import BacktestPage from "@/pages/backtest";
import SettingsPage from "@/pages/settings";
import NotFound from "@/pages/not-found";

function AuthenticatedApp() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <MobileHeader />
        <div className="flex-1 overflow-auto p-4 md:p-6">
          <Switch>
            <Route path="/" component={MicroDashboard} />
            <Route path="/micro" component={MicroDashboard} />
            <Route path="/micro/positions" component={MicroPositions} />
            <Route path="/micro/trades" component={MicroTrades} />
            <Route path="/micro/settlements" component={MicroSettlements} />
            <Route path="/backtest" component={BacktestPage} />
            <Route path="/pipeline" component={PipelineDashboard} />
            <Route path="/pipeline/scanner" component={Scanner} />
            <Route path="/pipeline/opportunities" component={Opportunities} />
            <Route path="/pipeline/risk" component={RiskConsole} />
            <Route path="/pipeline/positions" component={PipelinePositions} />
            <Route path="/pipeline/trades" component={PipelineTrades} />
            <Route path="/pipeline/settlements" component={PipelineSettlements} />
            <Route path="/pipeline/postmortems" component={PostMortems} />
            <Route path="/audit" component={AuditLog} />
            <Route path="/settings" component={SettingsPage} />
            <Route component={NotFound} />
          </Switch>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function AppRouter() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route>
          <Redirect to="/login" />
        </Route>
      </Switch>
    );
  }

  return (
    <Switch>
      <Route path="/login">
        <Redirect to="/" />
      </Route>
      <Route>
        <AuthenticatedApp />
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <Toaster />
          <Router hook={useHashLocation}>
            <AppRouter />
          </Router>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
