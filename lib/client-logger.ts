// Client-side error reporter.
// Catches unhandled errors and sends them to /api/log so they appear in
// ~/ebay-lister.log alongside server errors.

export function initErrorReporter(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("error", (event) => {
    reportClientError({
      message: event.message,
      source: event.filename,
      line: event.lineno,
      col: event.colno,
      stack: event.error?.stack,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    reportClientError({
      message:
        reason instanceof Error ? reason.message : String(reason ?? "unknown"),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}

function reportClientError(payload: {
  message: string;
  source?: string;
  line?: number;
  col?: number;
  stack?: string;
}): void {
  try {
    fetch("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "client", ...payload }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Never let error reporting itself crash the app.
  }
}
