/**
 * Hand the browser to another site in this tab — HitPay's hosted checkout.
 * One line, kept behind a module boundary so a component test can assert
 * WHERE the page was sent: jsdom doesn't implement navigation, and
 * `window.location` is unforgeable, so it can't be spied on in place.
 * Pair with `useResetOnBfcache` for the Back-button return.
 */
export function leavePageTo(url: string): void {
	window.location.assign(url);
}
