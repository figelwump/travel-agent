import { useCallback, useEffect, useRef } from "react";

export type UrlRoute = {
  tripId: string | null;
  conversationId: string | null;
};

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function extractTripId(segment: string): string | null {
  if (!segment) return null;
  const match = segment.match(UUID_RE);
  if (match) return match[0];
  return segment;
}

function slugifyTripName(name?: string | null): string | null {
  if (!name) return null;
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  const slug = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : null;
}

function normalizeBasePath(basePath: string): string {
  if (!basePath) return "";
  const normalized = basePath.startsWith("/") ? basePath : `/${basePath}`;
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function stripBasePath(pathname: string, basePath: string): string {
  const normalizedBase = normalizeBasePath(basePath);
  if (!normalizedBase) return pathname;
  if (pathname === normalizedBase) return "/";
  if (pathname.startsWith(`${normalizedBase}/`)) {
    return pathname.slice(normalizedBase.length);
  }
  return pathname;
}

export function parseUrl(pathname: string, basePath = ""): UrlRoute {
  const withoutBase = stripBasePath(pathname, basePath);
  // Remove leading slash and split
  const parts = withoutBase.replace(/^\//, "").split("/").filter(Boolean);

  if (parts.length === 0) {
    return { tripId: null, conversationId: null };
  }

  if (parts.length === 1) {
    return { tripId: extractTripId(parts[0]), conversationId: null };
  }

  // Two or more parts: tripId/conversationId
  return { tripId: extractTripId(parts[0]), conversationId: parts[1] };
}

export function buildUrl(
  tripId: string | null,
  conversationId: string | null,
  tripName?: string | null,
  basePath = ""
): string {
  const prefix = normalizeBasePath(basePath);
  if (!tripId) return prefix || "/";
  const tripSlug = slugifyTripName(tripName);
  const tripSegment = tripSlug ? `${tripSlug}-${tripId}` : tripId;
  const path = conversationId ? `/${tripSegment}/${conversationId}` : `/${tripSegment}`;
  return `${prefix}${path}`;
}

type PopStateHandler = (route: UrlRoute) => void;
type NavigateOptions = { replace?: boolean; tripName?: string | null };
type RouterOptions = { basePath?: string; search?: string };

export function useUrlRouter(onPopState?: PopStateHandler, options?: RouterOptions) {
  const onPopStateRef = useRef(onPopState);
  onPopStateRef.current = onPopState;
  const basePath = normalizeBasePath(options?.basePath ?? "");
  const searchSuffix = options?.search ?? "";
  const resolvedSearch = searchSuffix.startsWith("?") || searchSuffix === "" ? searchSuffix : `?${searchSuffix}`;

  // Listen to popstate for back/forward navigation
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePopState = () => {
      const route = parseUrl(window.location.pathname, basePath);
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
    return parseUrl(window.location.pathname, basePath);
  }, []);

  // Navigate to a new URL (push to history)
  const navigate = useCallback((tripId: string | null, conversationId: string | null, options?: NavigateOptions) => {
    if (typeof window === "undefined") return;

    const newUrl = buildUrl(tripId, conversationId, options?.tripName, basePath);
    const finalUrl = `${newUrl}${resolvedSearch}`;
    if (options?.replace) {
      window.history.replaceState(null, "", finalUrl);
    } else {
      window.history.pushState(null, "", finalUrl);
    }
  }, []);

  // Sync URL without adding to history (replace state) - does NOT trigger popstate
  const syncUrl = useCallback((tripId: string | null, conversationId: string | null, tripName?: string | null) => {
    if (typeof window === "undefined") return;

    const newUrl = buildUrl(tripId, conversationId, tripName, basePath);
    const currentUrl = window.location.pathname;

    if (newUrl !== currentUrl) {
      window.history.replaceState(null, "", `${newUrl}${resolvedSearch}`);
    }
  }, []);

  return {
    getInitialRoute,
    navigate,
    syncUrl,
  };
}
