import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

export default function LoginPage() {
  const { login, register } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      if (isRegister) {
        await register(username, password);
      } else {
        await login(username, password);
      }
    } catch (err: any) {
      setError(err.message || "Ошибка авторизации");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center pb-4">
          <div className="flex justify-center mb-4">
            <svg
              width="48"
              height="48"
              viewBox="0 0 28 28"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-label="AlgoTrader"
            >
              <rect width="28" height="28" rx="6" fill="hsl(199 89% 48%)" />
              <path
                d="M6 20L10 12L14 16L18 8L22 14"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="10" cy="12" r="1.5" fill="white" />
              <circle cx="18" cy="8" r="1.5" fill="white" />
            </svg>
          </div>
          <CardTitle className="text-xl font-semibold">
            AlgoTrader <span className="text-xs text-muted-foreground font-mono ml-1">v3</span>
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {isRegister ? "Создать аккаунт" : "Войти в систему"}
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Имя пользователя</Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                required
                autoComplete="username"
                data-testid="input-username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete={isRegister ? "new-password" : "current-password"}
                data-testid="input-password"
              />
            </div>

            {error && (
              <p className="text-sm text-red-500" data-testid="text-error">
                {error}
              </p>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting}
              data-testid="button-submit-auth"
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isRegister ? "Зарегистрироваться" : "Войти"}
            </Button>

            <Button
              type="button"
              variant="ghost"
              className="w-full text-sm"
              onClick={() => {
                setIsRegister(!isRegister);
                setError("");
              }}
              data-testid="button-toggle-auth-mode"
            >
              {isRegister
                ? "Уже есть аккаунт? Войти"
                : "Нет аккаунта? Зарегистрироваться"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
