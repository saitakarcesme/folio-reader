"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then(() => navigator.serviceWorker.ready).then((registration) => {
        const urls = performance.getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((url) => url.startsWith(location.origin));
        registration.active?.postMessage({ type: "CACHE_URLS", urls });
      });
    }
  }, []);
  return null;
}
