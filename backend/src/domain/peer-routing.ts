import type { InstanceEntry } from "../adapters/instance-registry";
import { isValidInstancePrefix } from "./policies";

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
  // but if a peer ever picked a colliding prefix we'd refuse to shadow them.
  if (firstSegment === "api" || firstSegment === "ws" || firstSegment === "assets") {
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
