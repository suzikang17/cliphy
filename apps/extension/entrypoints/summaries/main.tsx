import "../../assets/main.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Sentry, initSentry } from "../../lib/sentry";
import { ErrorFallback } from "../../components/ErrorFallback";
import { App } from "./App";

initSentry();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
