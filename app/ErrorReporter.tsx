"use client";

import { useEffect } from "react";
import { initErrorReporter } from "@/lib/client-logger";

// Initializes the global client-side error reporter.
// Rendered once in the layout — catches unhandled JS errors and posts them
// to /api/log so they appear in ~/ebay-lister.log.
export function ErrorReporter() {
  useEffect(() => {
    initErrorReporter();
  }, []);
  return null;
}
