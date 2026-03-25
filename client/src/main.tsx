import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

try {
  if (!window.location.hash || window.location.hash === "#") {
    history.replaceState(null, "", "#/");
  }
} catch (_e) {
  // ignore in sandboxed iframe
}

// Load fonts non-blocking
try {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@300..800&family=JetBrains+Mono:wght@400;500;600&display=swap";
  document.head.appendChild(link);
} catch (_e) {
  // fonts will fallback to system
}

createRoot(document.getElementById("root")!).render(<App />);
