// Pure helpers for retailer payment methods. No Convex server imports (only the
// ConvexError value class), so this is unit-testable in isolation and importable
// from both Convex functions and the React client.
//
// A retailer can configure N payment methods, each a `bank` (account details) or
// a `qr` (an uploaded QR image), with a label and a sort order. This supersedes
// the legacy single `retailers.paymentInstructions` object — we still READ that
// (synthesizing methods from it) so un-migrated rows keep working until the
// backfill + narrow lands. See docs/payment-handshake.md + the multi-method task.

import { ConvexError } from "convex/values";

export type PaymentMethodType = "bank" | "qr";

export type PaymentMethod = {
	type: PaymentMethodType;
	label: string;
	bankName?: string;
	bankAccountName?: string;
	bankAccountNumber?: string;
	qrImageStorageId?: string;
	note?: string;
	sortOrder: number;
};

/** The legacy single-object shape (`retailers.paymentInstructions`). */
export type LegacyPaymentInstructions = {
	bankName?: string;
	bankAccountName?: string;
	bankAccountNumber?: string;
	qrImageStorageId?: string;
	note?: string;
};

export const PAYMENT_FIELD_MAX = 120;
export const PAYMENT_NOTE_MAX = 500;
export const PAYMENT_LABEL_MAX = 60;
// Keep the WhatsApp confirm reply readable and bound the number of follow-up QR
// images we send (WABA-quality). Generous for a real seller (a few banks + QRs).
export const MAX_PAYMENT_METHODS = 8;

const trimOrUndef = (v: string | undefined): string | undefined => {
	if (v === undefined) return undefined;
	const t = v.trim();
	return t.length > 0 ? t : undefined;
};

/**
 * Convert the legacy single-object instructions into the method array (up to two
 * methods: the bank block and/or the QR). Used for backward-compatible reads and
 * the one-time backfill. Returns [] when nothing is configured.
 */
export function legacyToPaymentMethods(
	legacy: LegacyPaymentInstructions | undefined,
): PaymentMethod[] {
	if (!legacy) return [];
	const methods: PaymentMethod[] = [];
	const bankName = trimOrUndef(legacy.bankName);
	const bankAccountName = trimOrUndef(legacy.bankAccountName);
	const bankAccountNumber = trimOrUndef(legacy.bankAccountNumber);
	const qrImageStorageId = trimOrUndef(legacy.qrImageStorageId);
	const note = trimOrUndef(legacy.note);
	const hasBank = Boolean(bankName || bankAccountName || bankAccountNumber);
	if (hasBank) {
		methods.push({
			type: "bank",
			label: bankName ?? "Bank transfer",
			bankName,
			bankAccountName,
			bankAccountNumber,
			// The legacy note was general; attach it to the bank block.
			note,
			sortOrder: 0,
		});
	}
	if (qrImageStorageId) {
		methods.push({
			type: "qr",
			label: "QR code",
			qrImageStorageId,
			// Avoid duplicating the note if it's already on the bank block above.
			note: hasBank ? undefined : note,
			sortOrder: methods.length,
		});
	}
	return methods;
}

/**
 * Resolve a retailer's effective payment methods: prefer the new `paymentMethods`
 * array (sorted by `sortOrder`); otherwise synthesize from the legacy
 * `paymentInstructions` object. The single source of truth for "how can this
 * retailer be paid" — used by the WhatsApp confirm reply, the tracking page
 * query, and the settings read.
 */
export function resolvePaymentMethods(retailer: {
	paymentMethods?: PaymentMethod[];
	paymentInstructions?: LegacyPaymentInstructions;
}): PaymentMethod[] {
	const methods = retailer.paymentMethods;
	if (methods && methods.length > 0) {
		return [...methods].sort((a, b) => a.sortOrder - b.sortOrder);
	}
	return legacyToPaymentMethods(retailer.paymentInstructions);
}

/**
 * Every QR-image storage id currently referenced by a retailer — across the
 * `paymentMethods` array AND the legacy single object. Used to (a) garbage-
 * collect blobs no longer referenced after a payment edit, and (b) delete all
 * QR blobs when the account is deleted.
 */
export function collectQrStorageIds(retailer: {
	paymentMethods?: PaymentMethod[];
	paymentInstructions?: LegacyPaymentInstructions;
}): string[] {
	const ids: string[] = [];
	for (const m of retailer.paymentMethods ?? []) {
		const id = m.type === "qr" ? m.qrImageStorageId?.trim() : undefined;
		if (id) ids.push(id);
	}
	const legacy = retailer.paymentInstructions?.qrImageStorageId?.trim();
	if (legacy) ids.push(legacy);
	return ids;
}

/**
 * Validate + normalize an incoming methods array from the settings form: trim
 * fields, enforce caps, drop methods with no usable content, default labels, and
 * re-number `sortOrder` to the array order (0..n). Throws `ConvexError` on a cap
 * violation. Returns `undefined` when nothing usable remains (clears the field).
 */
export function sanitizePaymentMethods(
	input: PaymentMethod[] | undefined,
): PaymentMethod[] | undefined {
	if (!input || input.length === 0) return undefined;
	if (input.length > MAX_PAYMENT_METHODS)
		throw new ConvexError(
			`You can add at most ${MAX_PAYMENT_METHODS} payment methods`,
		);

	const out: PaymentMethod[] = [];
	for (const raw of input) {
		const type: PaymentMethodType = raw.type === "qr" ? "qr" : "bank";
		const bankName = capField(raw.bankName, PAYMENT_FIELD_MAX, "Bank name");
		const bankAccountName = capField(
			raw.bankAccountName,
			PAYMENT_FIELD_MAX,
			"Account holder name",
		);
		const bankAccountNumber = capField(
			raw.bankAccountNumber,
			PAYMENT_FIELD_MAX,
			"Account number",
		);
		const qrImageStorageId = trimOrUndef(raw.qrImageStorageId);
		const note = capField(raw.note, PAYMENT_NOTE_MAX, "Note");
		const label = capField(raw.label, PAYMENT_LABEL_MAX, "Label");

		// Drop methods with no usable content — a `bank` needs at least one bank
		// field; a `qr` needs an image.
		if (type === "bank" && !bankName && !bankAccountName && !bankAccountNumber)
			continue;
		if (type === "qr" && !qrImageStorageId) continue;

		out.push({
			type,
			// Sensible default label so the WhatsApp/track render always has a header.
			label: label ?? (type === "qr" ? "QR code" : bankName ?? "Bank transfer"),
			bankName: type === "bank" ? bankName : undefined,
			bankAccountName: type === "bank" ? bankAccountName : undefined,
			bankAccountNumber: type === "bank" ? bankAccountNumber : undefined,
			qrImageStorageId: type === "qr" ? qrImageStorageId : undefined,
			note,
			sortOrder: out.length,
		});
	}
	return out.length > 0 ? out : undefined;
}

function capField(
	value: string | undefined,
	max: number,
	label: string,
): string | undefined {
	const t = trimOrUndef(value);
	if (t && t.length > max)
		throw new ConvexError(`${label} exceeds ${max} characters`);
	return t;
}
