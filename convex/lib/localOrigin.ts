/**
 * "Is this a LOCAL http:// origin?" — loopback, `*.localhost` or a private-LAN
 * IPv4 host. Such a host can never be a real public production URL, so matching
 * it is a safe "this is local dev" signal that needs no env flag.
 *
 * One definition, two callers with opposite reasons to trust it:
 *   - the WhatsApp adapter upgrades a local CTA URL to https so Meta renders the
 *     button while developing (`convex/lib/channels/whatsapp/adapter.ts`);
 *   - the Worker's HTTPS guard leaves a local request on http, so `pnpm dev` /
 *     `wrangler dev` are never redirected (`src/lib/https-redirect.ts`).
 *
 * The WHOLE host is matched, up to the port or the end of the authority. A
 * prefix match would call `http://localhost.evil.com` or `http://10.example.com`
 * local — which the adapter would rewrite and the guard would leave on plain
 * http, the exact hole each one exists to close.
 */
const LOCAL_HTTP_ORIGIN =
	/^http:\/\/(?:(?:[a-z0-9-]+\.)*localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d+)?(?=[/?#]|$)/i;

export function isLocalHttpOrigin(url: string): boolean {
	return LOCAL_HTTP_ORIGIN.test(url);
}
