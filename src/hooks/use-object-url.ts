"use client";

import { useEffect, useMemo } from "react";

export function useObjectUrl(blob?: Blob) {
  const url = useMemo(() => blob ? URL.createObjectURL(blob) : undefined, [blob]);

  useEffect(() => {
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [url]);

  return url;
}
