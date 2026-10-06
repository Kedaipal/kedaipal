/**
 * Every string in the buyer's manual-payment sheet, in both languages
 * (z8r3fdnpxf).
 *
 * Why a module and not the inline `ms ? … : …` ternaries the rest of the track
 * page uses: this sheet carries ~30 strings, and making proof MANDATORY put the
 * highest-stakes sentence on it — the one telling a buyer why their payment
 * won't go through. Inline ternaries at that count stop being readable, and the
 * real risk is subtler than readability: a sheet that is Malay in two places and
 * English in twelve reads worse than one consistent language, and nothing about
 * a ternary makes a missing translation visible. Collecting them here makes
 * "every string answers in both languages" something
 * `manual-payment-copy.test.ts` can assert, so a future string added in English
 * only fails the gate instead of shipping.
 *
 * Locale comes from the order payload's `retailerLocale` (the STORE's language —
 * the buyer never picks one), and only `ms` branches, matching every other
 * buyer surface. `zh` stores read the English column.
 *
 * `imageRejectMessage` in `src/lib/image-upload.ts` is deliberately NOT reused
 * for the upload rejections: its other caller is the seller on a laptop, so it
 * names a macOS fix ("open it in Preview, File → Export as JPEG"). This buyer is
 * on a phone inside WhatsApp's in-app browser and now cannot pay at all until an
 * image lands, so the fix has to be one they can carry out where they are —
 * which is always "take a screenshot instead".
 */

import type { ImageRejectReason } from "../../lib/image-upload";

export function isMalay(locale: string | undefined): boolean {
	return locale === "ms";
}

/** The buyer-facing fix for each way an attachment can be refused. */
function rejectMessage(reason: ImageRejectReason, ms: boolean): string {
	switch (reason) {
		case "not_an_image":
			return ms
				? "Fail itu bukan imej. Lampirkan tangkapan skrin resit anda."
				: "That file isn't an image. Attach a screenshot of your receipt.";
		case "undecodable":
			// The HEIC case (86eyr6zm8). No "convert it on your Mac" here — see the
			// module note. A screenshot of the receipt is always to hand and is
			// always a format every browser renders.
			return ms
				? "Telefon anda simpan gambar itu dalam format yang pelayar tak boleh tunjuk. Buka resit dalam aplikasi bank anda dan ambil tangkapan skrin."
				: "Your phone saved that photo in a format browsers can't show. Open the receipt in your banking app and take a screenshot of it instead.";
		case "too_large":
			return ms
				? "Imej itu terlalu besar. Tangkapan skrin dari aplikasi bank anda jauh di bawah had."
				: "That image is too large. A screenshot from your banking app will be well under the limit.";
		case "encode_failed":
			return ms
				? "Imej itu tak dapat diproses. Ambil tangkapan skrin baharu dan lampirkan."
				: "That image couldn't be processed. Take a fresh screenshot and attach that.";
	}
}

export interface ManualPaymentCopy {
	title: (storeName: string) => string;
	titleUpdate: string;
	close: string;
	stepPay: string;
	bank: string;
	accountName: string;
	accountNumber: string;
	copyAccountNumber: string;
	accountNumberCopied: string;
	tapToEnlarge: string;
	saveQr: string;
	qrSaved: string;
	qrSaveFailed: string;
	qrHint: string;
	noMethods: (storeName: string) => string;
	stepTellNumbered: string;
	stepTell: string;
	intro: (shortId: string, storeName: string) => string;
	proofLabel: string;
	required: string;
	proofAttach: string;
	proofUploading: string;
	proofAttached: string;
	proofReplace: string;
	proofRetry: string;
	proofHint: string;
	proofOnFile: string;
	proofPreviewAlt: string;
	cantAttach: (storeName: string) => string;
	waMessage: (shortId: string) => string;
	referenceLabel: string;
	optional: string;
	referencePlaceholder: string;
	referenceHint: string;
	submit: string;
	submitUpdate: string;
	submitting: string;
	needProof: string;
	needChange: string;
	rejectMessage: (reason: ImageRejectReason) => string;
	uploadFailed: string;
}

export function manualPaymentCopy(
	locale: string | undefined,
): ManualPaymentCopy {
	const ms = isMalay(locale);
	return {
		title: (storeName) => (ms ? `Bayar ${storeName}` : `Pay ${storeName}`),
		titleUpdate: ms ? "Kemas kini bukti pembayaran" : "Update payment proof",
		close: ms ? "Tutup" : "Close",
		stepPay: ms ? "1 · Bayar guna mana-mana ini" : "1 · Pay with any of these",
		bank: ms ? "Bank" : "Bank",
		accountName: ms ? "Nama" : "Name",
		accountNumber: ms ? "Nombor akaun" : "Account number",
		copyAccountNumber: ms ? "Salin nombor akaun" : "Copy account number",
		accountNumberCopied: ms ? "Nombor akaun disalin" : "Account number copied",
		tapToEnlarge: ms ? "Tekan untuk besarkan & imbas" : "Tap to enlarge & scan",
		saveQr: ms ? "Simpan QR" : "Save QR",
		qrSaved: ms
			? "QR disimpan — buka dari muat turun anda untuk imbas."
			: "QR saved — open it from your downloads to scan.",
		qrSaveFailed: ms
			? "Tak dapat simpan QR — cuba lagi."
			: "Couldn't save the QR — please try again.",
		qrHint: ms
			? "Bayar guna telefon ini? Simpan QR ke galeri, kemudian imbas dari dalam TNG eWallet atau aplikasi bank anda."
			: "Paying on this phone? Save the QR to your gallery, then scan it from inside TNG eWallet or your banking app.",
		noMethods: (storeName) =>
			ms
				? `${storeName} belum tambah butiran pembayaran di sini — periksa chat WhatsApp anda dengan mereka untuk cara bayar, kemudian sahkan di bawah.`
				: `${storeName} hasn't added payment details here — check your WhatsApp chat with them for how to pay, then confirm below.`,
		stepTellNumbered: ms
			? "2 · Kemudian beritahu kedai"
			: "2 · Then tell the store",
		stepTell: ms ? "Beritahu kedai" : "Tell the store",
		intro: (shortId, storeName) =>
			ms
				? `Sudah bayar ${shortId}? Hantar butiran di bawah supaya ${storeName} boleh sahkan pembayaran anda.`
				: `Paid ${shortId}? Send the details below so ${storeName} can verify your payment.`,
		proofLabel: ms ? "Tangkapan skrin pembayaran" : "Payment screenshot",
		required: ms ? "(wajib)" : "(required)",
		proofAttach: ms
			? "Tekan untuk lampirkan tangkapan skrin"
			: "Tap to attach a screenshot",
		proofUploading: ms ? "Memuat naik…" : "Uploading…",
		// Deliberately NOT the field name again: the label sits directly above
		// the tile, and repeating it wraps to two lines at 360px beside Replace.
		proofAttached: ms ? "Dilampirkan" : "Attached",
		proofReplace: ms ? "Tukar" : "Replace",
		proofRetry: ms ? "Cuba lagi" : "Retry",
		proofHint: ms ? "PNG atau JPG, sehingga 5 MB." : "PNG or JPG, up to 5 MB.",
		// Shown instead of the required marker on a resubmit: the seller can
		// already verify this order, so the buyer isn't being asked again.
		proofOnFile: ms
			? "Kedai sudah ada tangkapan skrin anda. Lampirkan yang baharu hanya jika anda nak gantikan."
			: "The store already has your screenshot. Attach a new one only if you want to replace it.",
		proofPreviewAlt: ms
			? "Pratonton tangkapan skrin pembayaran"
			: "Payment screenshot preview",
		// The escape hatch. Mandatory proof must never be a dead end: a buyer who
		// genuinely cannot produce an image still has a human to talk to, and the
		// seller can mark the payment received by hand.
		cantAttach: (storeName) =>
			ms
				? `Tak boleh lampirkan? Hantar mesej kepada ${storeName} di WhatsApp.`
				: `Can't attach one? Message ${storeName} on WhatsApp.`,
		waMessage: (shortId) =>
			ms
				? `Hai, saya sudah bayar untuk pesanan ${shortId} tapi tak boleh lampirkan tangkapan skrin.`
				: `Hi, I've paid for order ${shortId} but I can't attach a screenshot.`,
		referenceLabel: ms ? "Nombor rujukan" : "Reference number",
		optional: ms ? "(pilihan)" : "(optional)",
		referencePlaceholder: ms
			? "cth. TXN20260429-9988"
			: "e.g. TXN20260429-9988",
		referenceHint: ms
			? "Dari aplikasi bank anda — bantu kedai padankan pemindahan anda."
			: "From your bank app — helps the store match your transfer.",
		submit: ms ? "Saya sudah bayar" : "I've paid",
		submitUpdate: ms ? "Kemas kini" : "Update",
		submitting: ms ? "Menghantar…" : "Submitting…",
		// Why the submit is disabled, said beside it rather than after a tap.
		needProof: ms
			? "Lampirkan tangkapan skrin pembayaran anda untuk teruskan."
			: "Attach your payment screenshot to continue.",
		needChange: ms
			? "Lampirkan tangkapan skrin baharu atau tambah nombor rujukan untuk kemas kini."
			: "Attach a new screenshot or add a reference number to update.",
		rejectMessage: (reason) => rejectMessage(reason, ms),
		uploadFailed: ms
			? "Tak dapat muat naik tangkapan skrin anda. Cuba lagi."
			: "Couldn't upload your screenshot. Please try again.",
	};
}
