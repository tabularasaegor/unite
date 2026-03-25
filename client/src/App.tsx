import { Component, useState, type ReactNode } from "react";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Scanner from "@/pages/scanner";
import Opportunities from "@/pages/opportunities";
import OpportunityDetail from "@/pages/opportunity-detail";
import RiskConsole from "@/pages/risk-console";
import Positions from "@/pages/positions";
import Trades from "@/pages/trades";
import Settlements from "@/pages/settlements";
import PostMortems from "@/pages/post-mortems";
import AuditLogPage from "@/pages/audit-log";
import SettingsPage from "@/pages/settings";
import MicroDashboard from "@/pages/micro-dashboard";
import MicroPositions from "@/pages/micro-positions";
import MicroTrades from "@/pages/micro-trades";
import MicroSettlements from "@/pages/micro-settlements";
import AppSidebar from "@/components/AppSidebar";
import LoginPage from "@/pages/login";
import { useTheme } from "@/hooks/use-theme";
import { isAuthenticated, logout } from "@/lib/auth";

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: "" };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, color: "#ef4444", fontFamily: "sans-serif" }}>
          <h2>Application Error</h2>
          <pre style={{ whiteSpace: "pre-wrap" }}>{this.state.error}</pre>
          <button onClick={() => window.location.reload()} style={{ marginTop: 16, padding: "8px 16px" }}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppLayout({ onLogout }: { onLogout: () => void }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar theme={theme} toggleTheme={toggleTheme} onLogout={onLogout} />
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/scanner" component={Scanner} />
        <Route path="/opportunities/:id" component={OpportunityDetail} />
        <Route path="/opportunities" component={Opportunities} />
        <Route path="/risk-console" component={RiskConsole} />
        <Route path="/positions" component={Positions} />
        <Route path="/trades" component={Trades} />
        <Route path="/settlements" component={Settlements} />
        <Route path="/post-mortems" component={PostMortems} />
        <Route path="/audit-log" component={AuditLogPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/micro/positions" component={MicroPositions} />
        <Route path="/micro/trades" component={MicroTrades} />
        <Route path="/micro/settlements" component={MicroSettlements} />
        <Route path="/micro" component={MicroDashboard} />
        <Route component={NotFound} />
      </Switch>
    </div>
  );
}

function App() {
  const [authed, setAuthed] = useState(isAuthenticated());

  const handleLogout = () => {
    logout();
    setAuthed(false);
  };

  if (!authed) {
    return (
      <ErrorBoundary>
        <LoginPage onLogin={() => setAuthed(true)} />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Router hook={useHashLocation}>
            <AppLayout onLogout={handleLogout} />
          </Router>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
