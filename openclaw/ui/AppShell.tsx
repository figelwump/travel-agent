import React, { useCallback, useMemo, useRef, useState } from "react";
import { useGateway, type GatewayEventHandler } from "./hooks/useGateway";
import { useAppRouter, parseAppRoute, type AppPage } from "./hooks/useAppRouter";
import { TopNav } from "./components/TopNav";
import { TravelPage } from "./pages/TravelPage";
import { HomePage } from "./pages/HomePage";
import { ArtifactsPage } from "./pages/ArtifactsPage";
import { ChatPage } from "./pages/ChatPage";

const EMPTYOS_BASE = "/agents/travel";

type EventHandler = (event: { event: string; payload: any }) => void;

const AppShell: React.FC = () => {
  const gatewayParams = useMemo(() => {
    if (typeof window === "undefined") {
      return {
        url: "ws://localhost:18789/ws",
        token: null as string | null,
        password: null as string | null,
        search: "",
      };
    }
    const search = window.location.search ?? "";
    const params = new URLSearchParams(search);
    const url =
      params.get("gatewayUrl") ??
      `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;
    return {
      url,
      token: params.get("gatewayToken"),
      password: params.get("gatewayPassword"),
      search,
    };
  }, []);

  // Event fan-out: multiple pages can register handlers
  const eventHandlersRef = useRef<Set<EventHandler>>(new Set());

  const addEventHandler = useCallback((handler: EventHandler) => {
    eventHandlersRef.current.add(handler);
  }, []);

  const removeEventHandler = useCallback((handler: EventHandler) => {
    eventHandlersRef.current.delete(handler);
  }, []);

  const handleGatewayEvent: GatewayEventHandler = useCallback((event) => {
    for (const handler of eventHandlersRef.current) {
      handler(event);
    }
  }, []);

  const { connected, request: gatewayRequest } = useGateway({
    url: gatewayParams.url,
    enabled: true,
    token: gatewayParams.token ?? null,
    password: gatewayParams.password ?? null,
    onEvent: handleGatewayEvent,
  });

  // Page routing
  const initialRoute = useMemo(() => {
    if (typeof window === "undefined") return { page: "home" } as AppPage;
    return parseAppRoute(window.location.pathname, EMPTYOS_BASE);
  }, []);

  const [currentRoute, setCurrentRoute] = useState<AppPage>(initialRoute);

  const handleNavigate = useCallback((route: AppPage) => {
    setCurrentRoute(route);
  }, []);

  const { navigate } = useAppRouter(
    useCallback((route: AppPage) => {
      setCurrentRoute(route);
    }, []),
    { basePath: EMPTYOS_BASE, search: gatewayParams.search }
  );

  const handleNavigation = useCallback((route: AppPage) => {
    navigate(route);
    setCurrentRoute(route);
  }, [navigate]);

  const renderPage = () => {
    switch (currentRoute.page) {
      case "home":
        return (
          <HomePage onNavigate={handleNavigation} />
        );
      case "travel":
        return (
          <TravelPage
            connected={connected}
            gatewayRequest={gatewayRequest}
            onEvent={addEventHandler}
            offEvent={removeEventHandler}
            initialTripId={currentRoute.tripId}
            initialConversationId={currentRoute.conversationId}
            onNavigate={handleNavigation}
            search={gatewayParams.search}
          />
        );
      case "artifacts":
        return (
          <ArtifactsPage
            initialArtifactId={currentRoute.artifactId}
            onNavigate={handleNavigation}
          />
        );
      case "chat":
        return (
          <ChatPage
            connected={connected}
            gatewayRequest={gatewayRequest}
            onEvent={addEventHandler}
            offEvent={removeEventHandler}
          />
        );
      default:
        return (
          <HomePage onNavigate={handleNavigation} />
        );
    }
  };

  return (
    <div className="flex flex-col h-screen" style={{ background: "hsl(var(--bg-primary))" }}>
      <TopNav
        currentPage={currentRoute.page}
        connected={connected}
        onNavigate={handleNavigation}
      />
      <div className="flex-1 overflow-hidden">
        {renderPage()}
      </div>
    </div>
  );
};

export default AppShell;
