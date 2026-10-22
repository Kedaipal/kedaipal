// The body line of the buyer's "Confirmation sent" card on /track/<token>
// (86eyf1rck / 86eyd63r8). Pure so its three states are pinned without
// rendering the route.
//
// The first clause tells the buyer they have NO message to send: this flow
// replaced the old one where the buyer tapped through to WhatsApp and sent the
// order themselves. The English used to open "Nothing to send." — two words
// that read as a status rather than an instruction, and on a booking sounded
// like nothing was booked. The Malay always said it plainly ("Tak perlu hantar
// apa-apa" — no need to send anything).

export function confirmationSentBody(opts: {
	ms: boolean;
	/** A free order (e.g. a free RSVP) — nothing to pay either. */
	free: boolean;
	/** The store is lapsed (z8r3fdr6gg): how to pay isn't on the page yet. */
	paymentsPaused: boolean;
}): string {
	const { ms, free, paymentsPaused } = opts;
	if (ms) {
		if (free)
			return "Tak perlu hantar apa-apa dan tiada bayaran diperlukan. Itulah satu-satunya mesej yang kami hantar — status terkini dan resit anda ada di sini. Simpan pautan ini.";
		if (paymentsPaused)
			return "Tak perlu hantar apa-apa. Itulah satu-satunya mesej yang kami hantar — status terkini dan resit anda ada di sini, dan cara membayar akan muncul di sini sebaik sahaja kedai menerima bayaran. Simpan pautan ini.";
		return "Tak perlu hantar apa-apa. Itulah satu-satunya mesej yang kami hantar — selebihnya ada di sini: cara membayar, status terkini dan resit anda. Simpan pautan ini.";
	}
	if (free)
		return "You don't need to message the store, and there's nothing to pay. That's the only message we'll send you — your latest status and your receipt live here. Keep this link.";
	if (paymentsPaused)
		return "You don't need to message the store. That's the only message we'll send you — your latest status and your receipt live here, and how to pay appears here once the store is taking payments. Keep this link.";
	return "You don't need to message the store. That's the only message we'll send you — everything else is here: how to pay, your latest status, and your receipt. Keep this link.";
}
