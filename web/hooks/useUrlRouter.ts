import { useCallback, useEffect, useRef } from "react";

export type UrlRoute = {
  tripId: string | null;
  conversationId: string | null;
};

export function parseUrl(pathname: string): UrlRoute {
  // Remove leading slash and split
  const parts = pathname.replace(/^\//, "").split("/").filter(Boolean);

  if (parts.length === 0) {
    return { tripId: null, conversationId: null };
  }

  if (parts.length === 1) {
    return { tripId: parts[0], conversationId: null };
  }

  // Two or more parts: tripId/conversationId
  return { tripId: parts[0], conversationId: parts[1] };
}

export function buildUrl(tripId: string | null, conversationId: string | null): string {
  if (!tripId) return "/";
  if (!conversationId) return `/${tripId}`;
  return `/${tripId}/${conversationId}`;
}

type PopStateHandler = (route: UrlRoute) => void;

export function useUrlRouter(onPopState?: PopStateHandler) {
  const onPopStateRef = useRef(onPopState);
  onPopStateRef.current = onPopState;

  // Listen to popstate for back/forward navigation
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePopState = () => {
      const route = parseUrl(window.location.pathname);
      onPopStateRef.current?.(route);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Get current route from URL (for initial load)
  const getInitialRoute = useCallback((): UrlRoute => {
    if (typeof window === "undefined") {
      return { tripId: null, conversationId: null };
    }
    return parseUrl(window.location.pathname);
  }, []);

  // Navigate to a new URL (push to history)
  const navigate = useCallback((tripId: string | null, conversationId: string | null, replace = false) => {
    if (typeof window === "undefined") return;

    const newUrl = buildUrl(tripId, conversationId);
    if (replace) {
      window.history.replaceState(null, "", newUrl);
    } else {
      window.history.pushState(null, "", newUrl);
    }
  }, []);

  // Sync URL without adding to history (replace state) - does NOT trigger popstate
  const syncUrl = useCallback((tripId: string | null, conversationId: string | null) => {
    if (typeof window === "undefined") return;

    const newUrl = buildUrl(tripId, conversationId);
    const currentUrl = window.location.pathname;

    if (newUrl !== currentUrl) {
      window.history.replaceState(null, "", newUrl);
    }
  }, []);

  return {
    getInitialRoute,
    navigate,
    syncUrl,
  };
}
