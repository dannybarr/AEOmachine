/**
 * SSRF hardening tests: private-address detection, literal-IP rejection, and
 * DNS pinning — the socket lookup itself rejects hosts that resolve to
 * private space, so hostile DNS (rebinding) cannot swap in an internal
 * address between validation and connection.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { assertPublicUrl, isPrivateAddress, isRedirectHostAllowed, safeFetch } from "./safeFetch";

test("isPrivateAddress covers loopback, RFC1918, link-local, CGNAT, v4-mapped v6", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.5",
    "172.16.1.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:10.0.0.1",
  ]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "2607:f8b0::1", "2a00:1450:4001::5e"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("isPrivateAddress rejects hex-mapped IPv4, NAT64, multicast and special-use ranges", () => {
  for (const ip of [
    "::ffff:7f00:1", // hex-mapped 127.0.0.1
    "::ffff:a00:1", // hex-mapped 10.0.0.1
    "::ffff:c0a8:101", // hex-mapped 192.168.1.1
    "::ffff:a9fe:a9fe", // hex-mapped 169.254.169.254 (metadata)
    "64:ff9b::7f00:1", // NAT64 → 127.0.0.1
    "64:ff9b::a00:1", // NAT64 → 10.0.0.1
    "ff02::1", // IPv6 multicast
    "2001:db8::1", // IPv6 documentation
    "100::1", // discard-only
    "::", // unspecified
    "fe80::1%eth0", // link-local with zone id
    "192.0.0.192", // IETF special-use
    "192.0.2.1", // TEST-NET-1
    "198.18.0.1", // benchmarking
    "198.51.100.7", // TEST-NET-2
    "203.0.113.9", // TEST-NET-3
    "224.0.0.251", // multicast
    "255.255.255.255", // broadcast
    "999.1.1.1", // unparseable v4
    ":::1", // unparseable v6
  ]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
});

test("assertPublicUrl rejects literal private IPs and non-http protocols", async () => {
  await assert.rejects(() => assertPublicUrl(new URL("http://127.0.0.1/x")), /non-public/);
  await assert.rejects(() => assertPublicUrl(new URL("http://169.254.169.254/meta")), /non-public/);
  await assert.rejects(() => assertPublicUrl(new URL("http://[::ffff:7f00:1]/")), /non-public/);
  await assert.rejects(() => assertPublicUrl(new URL("http://[64:ff9b::a00:1]/")), /non-public/);
  await assert.rejects(() => assertPublicUrl(new URL("ftp://example.com/x")), /http/);
  await assert.doesNotReject(() => assertPublicUrl(new URL("https://example.com/")));
});

test("redirect host constraint allows apex/www equivalents and rejects other sites", () => {
  assert.equal(isRedirectHostAllowed("www.example.com", "example.com"), true);
  assert.equal(isRedirectHostAllowed("example.com", "www.example.com"), true);
  assert.equal(isRedirectHostAllowed("example.com", "example.com"), true);
  assert.equal(isRedirectHostAllowed("attacker.test", "example.com"), false);
  assert.equal(isRedirectHostAllowed("evil-example.com", "example.com"), false);
});

test("safeFetch refuses to connect to hostnames that resolve to private space", async () => {
  // Spin up a real local server: if pinning failed, this fetch would succeed.
  const server = http.createServer((_req, res) => res.end("internal secret"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const ctrl = new AbortController();
  try {
    // "localhost" resolves to 127.0.0.1 via DNS lookup — the guarded socket
    // lookup must reject it even though the hostname itself looks benign
    // (same code path a rebinding domain would take).
    await assert.rejects(
      () => safeFetch(`http://localhost:${port}/`, { signal: ctrl.signal }),
      (err: unknown) => String(err).includes("non-public") || err instanceof TypeError,
    );
    // Literal loopback IP is rejected before any connection.
    await assert.rejects(
      () => safeFetch(`http://127.0.0.1:${port}/`, { signal: ctrl.signal }),
      /non-public/,
    );
  } finally {
    server.close();
  }
});
