import { lookup as dnsLookup } from "node:dns";
import type { LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

/** Reject URLs whose host is a literal private/loopback/link-local IP. */
export async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isPrivateAddress(host)) {
    throw new Error("URL resolves to a non-public address");
  }
}

/**
 * Numeric, allowlist-based address classifier. Anything that fails to parse
 * or falls outside globally routable unicast space is treated as private.
 * IPv6 is parsed to a 128-bit integer (so hex-mapped forms like
 * ::ffff:7f00:1 are equivalent to ::ffff:127.0.0.1) and only 2000::/3 global
 * unicast is allowed, minus documentation space; IPv4-mapped/translated
 * addresses defer to the embedded IPv4 rules.
 */
export function isPrivateAddress(ip: string): boolean {
  if (ip.includes(":")) {
    const v6 = parseIPv6(ip);
    if (v6 === null) return true; // unparseable → never connect
    // IPv4-mapped (::ffff:0:0/96) and IPv4-translated (::ffff:0:0:0/96,
    // 64:ff9b::/96 NAT64): classify by the embedded IPv4 address.
    const MAPPED = 0xffffn << 32n;
    const NAT64 = 0x0064ff9bn << 96n;
    if (v6 >> 32n === MAPPED >> 32n || v6 >> 96n === NAT64 >> 96n) {
      return isPrivateV4Number(v6 & 0xffffffffn);
    }
    // Allow only global unicast 2000::/3 …
    if (v6 >> 125n !== 1n) return true;
    // … minus documentation space 2001:db8::/32 and ORCHIDv2 2001:20::/28.
    if (v6 >> 96n === 0x20010db8n) return true;
    if (v6 >> 100n === 0x2001002n) return true;
    return false;
  }
  const v4 = parseIPv4(ip);
  if (v4 === null) return true;
  return isPrivateV4Number(v4);
}

function parseIPv4(ip: string): bigint | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  let out = 0n;
  for (let i = 1; i <= 4; i++) {
    const part = Number(m[i]);
    if (part > 255) return null;
    out = (out << 8n) | BigInt(part);
  }
  return out;
}

function isPrivateV4Number(v: bigint): boolean {
  const inRange = (cidr: string, bits: number): boolean => {
    const base = parseIPv4(cidr)!;
    return v >> BigInt(32 - bits) === base >> BigInt(32 - bits);
  };
  return (
    inRange("0.0.0.0", 8) || // "this network"
    inRange("10.0.0.0", 8) || // RFC1918
    inRange("100.64.0.0", 10) || // CGNAT
    inRange("127.0.0.0", 8) || // loopback
    inRange("169.254.0.0", 16) || // link-local (cloud metadata)
    inRange("172.16.0.0", 12) || // RFC1918
    inRange("192.0.0.0", 24) || // IETF special-use
    inRange("192.0.2.0", 24) || // TEST-NET-1
    inRange("192.168.0.0", 16) || // RFC1918
    inRange("198.18.0.0", 15) || // benchmarking
    inRange("198.51.100.0", 24) || // TEST-NET-2
    inRange("203.0.113.0", 24) || // TEST-NET-3
    v >> 29n === 0b111n // 224.0.0.0/3: multicast + reserved + broadcast
  );
}

/** Parse an IPv6 literal (incl. "::" and dotted-quad tail) to a 128-bit int. */
function parseIPv6(raw: string): bigint | null {
  let ip = raw.trim().toLowerCase();
  const zone = ip.indexOf("%");
  if (zone !== -1) ip = ip.slice(0, zone);
  // Expand a trailing embedded IPv4 (e.g. ::ffff:127.0.0.1) into two groups.
  const v4Tail = ip.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4Tail) {
    const v4 = parseIPv4(v4Tail[2]!);
    if (v4 === null) return null;
    const hi = (v4 >> 16n).toString(16);
    const lo = (v4 & 0xffffn).toString(16);
    ip = `${v4Tail[1]}${hi}:${lo}`;
  }
  const doubleColon = ip.indexOf("::");
  if (doubleColon !== ip.lastIndexOf("::")) return null; // only one "::"
  let groups: string[];
  if (doubleColon !== -1) {
    const head = ip.slice(0, doubleColon).split(":").filter(Boolean);
    const tail = ip.slice(doubleColon + 2).split(":").filter(Boolean);
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  } else {
    groups = ip.split(":");
  }
  if (groups.length !== 8) return null;
  let out = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out = (out << 16n) | BigInt(parseInt(g, 16));
  }
  return out;
}

/**
 * DNS lookup used by the pinned dispatcher's sockets. The socket connects to
 * exactly the address this callback returns, so validating here eliminates
 * the time-of-check/time-of-use gap of a separate pre-fetch DNS check
 * (DNS rebinding cannot swap in a private address between check and connect).
 */
function guardedLookup(
  hostname: string,
  options: Parameters<typeof dnsLookup>[1],
  callback: (err: NodeJS.ErrnoException | null, address?: string | LookupAddress[], family?: number) => void,
): void {
  // Literal IPs skip DNS entirely; reject private ones outright.
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      callback(Object.assign(new Error("URL resolves to a non-public address"), { code: "EACCES" }));
      return;
    }
    callback(null, hostname, isIP(hostname));
    return;
  }
  dnsLookup(hostname, { ...(options as object), all: true }, (err, addresses) => {
    if (err) {
      callback(err);
      return;
    }
    const all = addresses as LookupAddress[];
    if (all.length === 0 || all.some((a) => isPrivateAddress(a.address))) {
      callback(Object.assign(new Error("URL resolves to a non-public address"), { code: "EACCES" }));
      return;
    }
    if ((options as { all?: boolean } | undefined)?.all) callback(null, all);
    else callback(null, all[0]!.address, all[0]!.family);
  });
}

/** Dispatcher whose connections only ever use addresses vetted by guardedLookup. */
const pinnedDispatcher = new Agent({
  connect: { lookup: guardedLookup as never, timeout: 10_000 },
});

export interface SafeFetchOptions {
  /**
   * When set, redirects may only remain on this host. `www.` and apex hosts
   * are considered equivalent. The initial request is not constrained.
   */
  redirectHost?: string;
}

/** Compare hosts using the same apex/www equivalence used by the crawler. */
export function isRedirectHostAllowed(hostname: string, allowedHost: string): boolean {
  const normalize = (host: string) => host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  return normalize(hostname) === normalize(allowedHost);
}

/**
 * Fetch with manual redirect following, validating every hop (SSRF guard).
 * DNS resolution is pinned: sockets connect only to addresses validated in
 * the same lookup, so hostile DNS cannot rebind to internal address space.
 * Returns the final response; the URL of the final hop is in `finalUrl`.
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit & { signal: AbortSignal },
  options?: SafeFetchOptions,
): Promise<{ res: Response; finalUrl: string }> {
  let current = new URL(rawUrl);
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicUrl(current);
    // IMPORTANT: use undici's own fetch, not the global (Node-bundled) fetch.
    // Passing a dispatcher built from the workspace `undici` package into the
    // global fetch (a different bundled undici) fails with UND_ERR_INVALID_ARG
    // — which would silently break every safeFetch call.
    const res = (await undiciFetch(current.toString(), {
      ...(init as Parameters<typeof undiciFetch>[1]),
      redirect: "manual",
      dispatcher: pinnedDispatcher,
    })) as unknown as Response;
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { res, finalUrl: current.toString() };
      await res.body?.cancel();
      const next = new URL(loc, current);
      // Check the redirect target before the next loop iteration, and thus
      // before a connection to that target can be attempted.
      if (options?.redirectHost && !isRedirectHostAllowed(next.hostname, options.redirectHost)) {
        throw new Error("Redirected to an off-site host");
      }
      current = next;
      continue;
    }
    return { res, finalUrl: current.toString() };
  }
  throw new Error("Too many redirects");
}
