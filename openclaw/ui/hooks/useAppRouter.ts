import { useCallback, useEffect, useRef } from "react";

export type AppPage =
  | { page: "home" }
  | { page: "travel"; tripId?: string; conversationId?: string }
  | { page: "artifacts"; artifactId?: string }
  | { page: "chat" };

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function extractId(segment: string): string | null {
  if (!segment) return null;
  const match = segment.match(UUID_RE);
  return match ? match[0] : segment;
}

export function slugify(name?: string | null): string | null {
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

export function parseAppRoute(pathname: string, basePath: string): AppPage {
  const prefix = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  let rest = pathname;
  if (prefix && rest.startsWith(prefix)) {
    rest = rest.slice(prefix.length);
  }
  if (!rest || rest === "/") {
    return { page: "home" };
  }

  const parts = rest.replace(/^\//, "").split("/").filter(Boolean);

  if (parts[0] === "trips") {
    const tripSegment = parts[1];
    const convSegment = parts[2];
    const tripId = tripSegment ? extractId(tripSegment) ?? undefined : undefined;
    const conversationId = convSegment || undefined;
    return { page: "travel", tripId, conversationId };
  }

  if (parts[0] === "artifacts") {
    const artifactId = parts.slice(1).join(":") || undefined;
    return { page: "artifacts", artifactId };
  }

  if (parts[0] === "chat") {
    return { page: "chat" };
  }

  return { page: "home" };
}

export function buildAppUrl(route: AppPage, basePath: string): string {
  const prefix = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;

  switch (route.page) {
    case "home":
      return prefix || "/";
    case "travel": {
      const base = `${prefix}/trips`;
      if (!route.tripId) return base;
      const tripSegment = route.tripId;
      if (!route.conversationId) return `${base}/${tripSegment}`;
      return `${base}/${tripSegment}/${route.conversationId}`;
    }
    case "artifacts": {
      if (!route.artifactId) return `${prefix}/artifacts`;
      const encodedId = route.artifactId.replace(/:/g, "/");
      return `${prefix}/artifacts/${encodedId}`;
    }
    case "chat":
      return `${prefix}/chat`;
  }
}

export function buildTravelUrl(
  tripId: string | null,
  conversationId: string | null,
  basePath: string,
  tripName?: string | null
): string {
  const prefix = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  const base = `${prefix}/trips`;
  if (!tripId) return base;
  const slug = slugify(tripName);
  const tripSegment = slug ? `${slug}-${tripId}` : tripId;
  if (!conversationId) return `${base}/${tripSegment}`;
  return `${base}/${tripSegment}/${conversationId}`;
}

type PopStateHandler = (route: AppPage) => void;

type UseAppRouterOptions = {
  basePath: string;
  search?: string;
};

export function useAppRouter(onPopState?: PopStateHandler, options?: UseAppRouterOptions) {
  const basePath = options?.basePath ?? "/agents/travel";
  const searchSuffix = options?.search ?? "";
  const resolvedSearch =
    searchSuffix.startsWith("?") || searchSuffix === "" ? searchSuffix : `?${searchSuffix}`;
  const onPopStateRef = useRef(onPopState);
  onPopStateRef.current = onPopState;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handlePopState = () => {
      const route = parseAppRoute(window.location.pathname, basePath);
      onPopStateRef.current?.(route);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [basePath]);

  const getInitialRoute = useCallback((): AppPage => {
    if (typeof window === "undefined") return { page: "home" };
    return parseAppRoute(window.location.pathname, basePath);
  }, [basePath]);

  const navigate = useCallback(
    (route: AppPage, opts?: { replace?: boolean }) => {
      if (typeof window === "undefined") return;
      const url = buildAppUrl(route, basePath) + resolvedSearch;
      if (opts?.replace) {
        window.history.replaceState(null, "", url);
      } else {
        window.history.pushState(null, "", url);
      }
    },
    [basePath, resolvedSearch]
  );

  const navigateTravel = useCallback(
    (
      tripId: string | null,
      conversationId: string | null,
      opts?: { replace?: boolean; tripName?: string | null }
    ) => {
      if (typeof window === "undefined") return;
      const url = buildTravelUrl(tripId, conversationId, basePath, opts?.tripName) + resolvedSearch;
      if (opts?.replace) {
        window.history.replaceState(null, "", url);
      } else {
        window.history.pushState(null, "", url);
      }
    },
    [basePath, resolvedSearch]
  );

  const syncUrl = useCallback(
    (route: AppPage) => {
      if (typeof window === "undefined") return;
      const url = buildAppUrl(route, basePath) + resolvedSearch;
      if (url !== window.location.pathname + window.location.search) {
        window.history.replaceState(null, "", url);
      }
    },
    [basePath, resolvedSearch]
  );

  const syncTravelUrl = useCallback(
    (tripId: string | null, conversationId: string | null, tripName?: string | null) => {
      if (typeof window === "undefined") return;
      const url = buildTravelUrl(tripId, conversationId, basePath, tripName) + resolvedSearch;
      if (url !== window.location.pathname + window.location.search) {
        window.history.replaceState(null, "", url);
      }
    },
    [basePath, resolvedSearch]
  );

  return {
    getInitialRoute,
    navigate,
    navigateTravel,
    syncUrl,
    syncTravelUrl,
  };
}
