"use client";

import { useEffect } from "react";

/**
 * Fjerner ?ok=/?err= fra adresselinjen, når beskeden er vist (plan #23): beskeden står på siden nu, men kommer ikke igen
 * ved genindlæsning, tilbage-knap eller et bogmærke.
 */
export function FlashCleaner() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("ok") && !url.searchParams.has("err")) return;
    url.searchParams.delete("ok");
    url.searchParams.delete("err");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);
  return null;
}
