import type { InstanceEntry } from "../adapters/instance-registry";
import { isValidInstancePrefix, RESERVED_INSTANCE_PREFIXES } from "./policies";

export type PeerRouting =
  | { kind: "passthrough" }
  | { kind: "rewrite"; path: string }
  | { kind: "redirect"; port: number; path: string };

/** Pure decision: given a request pathname and the live peer list, decide
 *  whether to redirect to a peer, rewrite the URL in place (when the prefix
 *  matches this instance), or let the request pass through to the SPA handler. */
export function decidePeerRouting(
  pathname: string,
  peers: InstanceEntry[],
  selfPort: number,
): PeerRouting {
  const firstSegment = pathname.split("/")[1];
  if (!firstSegment || !isValidInstancePrefix(firstSegment)) {
    return { kind: "passthrough" };
  }
  // Defense-in-depth: paths handled by the route map above never reach this code,
  // and `deriveInstancePrefix` refuses to mint these prefixes, but if a peer ever
  // managed to register one we'd refuse to shadow the server's own routes.
  if (RESERVED_INSTANCE_PREFIXES.has(firstSegment)) {
    return { kind: "passthrough" };
  }

  const peer = peers.find((entry) => entry.prefix === firstSegment);
  if (!peer) return { kind: "passthrough" };

  const remaining = pathname.slice(firstSegment.length + 1) || "/";
  if (peer.port === selfPort) {
    return { kind: "rewrite", path: remaining };
  }
  return { kind: "redirect", port: peer.port, path: remaining };
}

/** Apply `decidePeerRouting` to a parsed request URL, returning either a 302
 *  Response or `null` (with `url.pathname` possibly rewritten for same-instance
 *  prefixes). The redirect Location pins to `url.hostname`, never the Host
 *  header — the URL constructor has already sanitized it. */
export function resolvePeerRedirect(
  url: URL,
  peers: InstanceEntry[],
  selfPort: number,
): Response | null {
  const decision = decidePeerRouting(url.pathname, peers, selfPort);
  if (decision.kind === "passthrough") return null;
  if (decision.kind === "rewrite") {
    url.pathname = decision.path;
    return null;
  }
  const location = `${url.protocol}//${url.hostname}:${decision.port}${decision.path}${url.search}`;
  return new Response(null, { status: 302, headers: { Location: location } });
}
