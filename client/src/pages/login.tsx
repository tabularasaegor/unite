import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setToken } from "@/lib/auth";

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    setError("");

    if (mode === "register" && password !== confirmPassword) {
      setError("Пароли не совпадают");
      setLoading(false);
      return;
    }

    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Ошибка");
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

  const switchMode = () => {
    setMode(mode === "login" ? "register" : "login");
    setError("");
    setConfirmPassword("");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
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
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
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
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
              data-testid="input-password"
            />
          </div>
          {mode === "register" && (
            <div>
              <Label>Подтвердите пароль</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="••••••"
                onKeyDown={e => e.key === "Enter" && handleSubmit()}
                data-testid="input-confirm-password"
              />
            </div>
          )}
          {error && <p className="text-sm text-red-500" data-testid="text-error">{error}</p>}
          <Button className="w-full" onClick={handleSubmit} disabled={loading} data-testid="button-submit">
            {loading ? (mode === "login" ? "Вход..." : "Регистрация...") : (mode === "login" ? "Войти" : "Зарегистрироваться")}
          </Button>
          <div className="text-center">
            <button
              type="button"
              onClick={switchMode}
              className="text-sm text-primary hover:underline"
              data-testid="button-switch-mode"
            >
              {mode === "login" ? "Нет аккаунта? Зарегистрироваться" : "Уже есть аккаунт? Войти"}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
