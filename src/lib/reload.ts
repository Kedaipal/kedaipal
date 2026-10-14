// A full page reload, behind a module seam so components that offer one can be
// tested: jsdom makes `window.location.reload` unforgeable, so it can neither
// be spied on nor stubbed in place (the `download.ts` precedent).

/**
 * Reload the page — the one recovery that also clears a tab running a client
 * from before a deploy, which a query retry cannot.
 */
export function reloadPage(): void {
	window.location.reload();
}
