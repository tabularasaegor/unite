import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Set dark mode by default
if (!document.documentElement.classList.contains("light")) {
  document.documentElement.classList.add("dark");
}

if (!window.location.hash) {
  history.replaceState(null, "", "#/");
}

createRoot(document.getElementById("root")!).render(<App />);
