import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setToken } from "@/lib/auth";

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Ошибка авторизации");
        return;
      }
      setToken(data.token);
      onLogin();
    } catch {
      setError("Ошибка подключения к серверу");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">AlgoTrader</CardTitle>
          <p className="text-sm text-muted-foreground">AI Prediction Market Platform</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Логин</Label>
            <Input
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="username"
              onKeyDown={e => e.key === "Enter" && handleLogin()}
              data-testid="input-username"
            />
          </div>
          <div>
            <Label>Пароль</Label>
            <Input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••"
              onKeyDown={e => e.key === "Enter" && handleLogin()}
              data-testid="input-password"
            />
          </div>
          {error && <p className="text-sm text-red-500" data-testid="text-error">{error}</p>}
          <Button className="w-full" onClick={handleLogin} disabled={loading} data-testid="button-submit">
            {loading ? "Вход..." : "Войти"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
