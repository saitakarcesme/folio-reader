"use client";

import { useSyncExternalStore } from "react";
import { ReaderClient } from "@/components/reader-client";

function subscribe() {
  return () => undefined;
}

function getDocumentId() {
  const match = window.location.pathname.match(/^\/reader\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

export function ReaderRoute() {
  const id = useSyncExternalStore(subscribe, getDocumentId, () => "");
  if (!id) return <main className="reader-state"><span className="spinner" /><p>Opening Folio…</p></main>;
  return <ReaderClient id={id} />;
}
