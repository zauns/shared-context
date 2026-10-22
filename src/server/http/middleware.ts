import type { RequestHandler } from 'express';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function hostGuard(): RequestHandler {
  return (request, response, next) => {
    const host = (request.hostname || request.headers.host?.split(':')[0] || '').toLowerCase();
    if (!LOOPBACK_HOSTS.has(host)) {
      response.status(403).json({
        ok: false,
        error: { code: 'forbidden_host', message: `Unexpected Host header: ${host}` },
      });
      return;
    }
    next();
  };
}

export function csrfGuard(token: string): RequestHandler {
  return (request, response, next) => {
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
      next();
      return;
    }

    const supplied = request.header('x-csrf-token');
    if (!supplied || supplied !== token) {
      response.status(403).json({
        ok: false,
        error: { code: 'csrf_invalid', message: 'Missing or invalid CSRF token' },
      });
      return;
    }

    const origin = request.header('origin');
    if (origin) {
      let parsed: URL;
      try {
        parsed = new URL(origin);
      } catch {
        response.status(403).json({
          ok: false,
          error: { code: 'csrf_invalid', message: 'Invalid Origin header' },
        });
        return;
      }
      if (!LOOPBACK_HOSTS.has(parsed.hostname) || parsed.protocol !== 'http:') {
        response.status(403).json({
          ok: false,
          error: { code: 'csrf_invalid', message: 'Cross-origin request rejected' },
        });
        return;
      }
    }

    const fetchSite = request.header('sec-fetch-site');
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
      response.status(403).json({
        ok: false,
        error: { code: 'csrf_invalid', message: 'Cross-site request rejected' },
      });
      return;
    }

    next();
  };
}
