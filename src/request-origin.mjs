// The UI can be reached through localhost, a LAN address, or a reverse proxy.
// Compare its Origin with the request Host instead of requiring localhost.
export function sameUiOrigin(req, {requireOrigin = false} = {}) {
  const origin = req.headers.origin;
  if (!origin) return !requireOrigin;
  if (typeof origin !== 'string' || typeof req.headers.host !== 'string') return false;
  try {
    const parsed = new URL(origin);
    return ['http:', 'https:'].includes(parsed.protocol) &&
      parsed.origin === origin && parsed.host.toLowerCase() === req.headers.host.toLowerCase();
  } catch { return false; }
}
