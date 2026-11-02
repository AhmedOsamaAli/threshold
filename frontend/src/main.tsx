import "./styles/index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { CrashScreen } from "./components/CrashScreen";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { currentRoute } from "./lib/routes";
import { preloadRoute } from "./preload";

const root = document.getElementById("root");
if (!root) throw new Error("The page has no #root element.");

// The code of the page the address opens on starts loading with the app rather than after its first render.
preloadRoute(currentRoute());

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary fallback={<CrashScreen />}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
