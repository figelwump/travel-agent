type HeaderContext = {
  origin: string | null;
  allowedOriginHeader: (origin: string | null) => string | undefined;
};

const securityHeaders: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  // Allow remote images in itineraries (e.g., Wikimedia/Unsplash) while keeping scripts locked down.
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com https://r2cdn.perplexity.ai; connect-src 'self' wss:; script-src 'self' 'unsafe-inline';",
};

export function createHeaders(contentType?: string, ctx?: HeaderContext): Record<string, string> {
  const headers: Record<string, string> = { ...securityHeaders };

  if (ctx) {
    const allowedOrigin = ctx.allowedOriginHeader(ctx.origin ?? null);
    if (allowedOrigin) {
      headers["Access-Control-Allow-Origin"] = allowedOrigin;
      headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
      headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
      headers["Vary"] = "Origin";
    }
  }

  if (contentType) headers["Content-Type"] = contentType;
  return headers;
}

export function jsonResponse(data: unknown, status = 200, ctx?: HeaderContext): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: createHeaders("application/json", ctx),
  });
}

export function textResponse(text: string, status = 200, ctx?: HeaderContext, contentType = "text/plain"): Response {
  return new Response(text, {
    status,
    headers: createHeaders(contentType, ctx),
  });
}

