/**
 * Whether a browser sent this request from the app's own pages. Browsers mark
 * every request with `Sec-Fetch-Site`; one that predates it still sends
 * `Origin` on a POST, which then has to be the app's own. A request carrying
 * neither is refused: only the app's pages call the routes that check this.
 */
export function isSameOriginRequest(request: Request, appUrl: string): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site != null) return site === "same-origin";
  const origin = request.headers.get("origin");
  return origin != null && origin === new URL(appUrl).origin;
}
