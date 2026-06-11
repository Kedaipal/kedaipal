import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import {
	legacyToPaymentMethods,
	MAX_PAYMENT_METHODS,
	type PaymentMethod,
	resolvePaymentMethods,
	sanitizePaymentMethods,
} from "./payment";

describe("legacyToPaymentMethods", () => {
	test("undefined / empty legacy → []", () => {
		expect(legacyToPaymentMethods(undefined)).toEqual([]);
		expect(legacyToPaymentMethods({})).toEqual([]);
		expect(legacyToPaymentMethods({ bankName: "  ", note: "  " })).toEqual([]);
	});

	test("bank fields → one bank method (label = bank name, note attached)", () => {
		const out = legacyToPaymentMethods({
			bankName: "Maybank",
			bankAccountNumber: " 5123 ",
			note: "Send receipt",
		});
		expect(out).toEqual([
			{
				type: "bank",
				label: "Maybank",
				bankName: "Maybank",
				bankAccountName: undefined,
				bankAccountNumber: "5123",
				note: "Send receipt",
				sortOrder: 0,
			},
		]);
	});

	test("bank + QR → two methods; note stays on the bank only", () => {
		const out = legacyToPaymentMethods({
			bankName: "Maybank",
			qrImageStorageId: "kg:abc",
			note: "thanks",
		});
		expect(out.map((m) => m.type)).toEqual(["bank", "qr"]);
		expect(out[0].note).toBe("thanks");
		expect(out[1].note).toBeUndefined();
		expect(out[1].sortOrder).toBe(1);
	});

	test("QR-only → one qr method carrying the note", () => {
		const out = legacyToPaymentMethods({ qrImageStorageId: "kg:abc", note: "x" });
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ type: "qr", label: "QR code", note: "x" });
	});
});

describe("resolvePaymentMethods", () => {
	const arrayMethod: PaymentMethod = {
		type: "bank",
		label: "CIMB",
		bankAccountNumber: "8001",
		sortOrder: 0,
	};

	test("prefers the array, sorted by sortOrder", () => {
		const out = resolvePaymentMethods({
			paymentMethods: [
				{ ...arrayMethod, label: "B", sortOrder: 1 },
				{ ...arrayMethod, label: "A", sortOrder: 0 },
			],
			paymentInstructions: { bankName: "Legacy" },
		});
		expect(out.map((m) => m.label)).toEqual(["A", "B"]);
	});

	test("falls back to legacy when the array is empty/absent", () => {
		expect(
			resolvePaymentMethods({ paymentInstructions: { bankName: "Legacy" } }),
		).toHaveLength(1);
		expect(
			resolvePaymentMethods({
				paymentMethods: [],
				paymentInstructions: { bankName: "Legacy" },
			})[0].label,
		).toBe("Legacy");
	});

	test("nothing configured → []", () => {
		expect(resolvePaymentMethods({})).toEqual([]);
	});
});

describe("sanitizePaymentMethods", () => {
	test("undefined / empty → undefined", () => {
		expect(sanitizePaymentMethods(undefined)).toBeUndefined();
		expect(sanitizePaymentMethods([])).toBeUndefined();
	});

	test("trims, defaults labels, re-numbers sortOrder, drops type-wrong fields", () => {
		const out = sanitizePaymentMethods([
			{
				type: "bank",
				label: "  ",
				bankName: " Maybank ",
				bankAccountNumber: " 5123 ",
				qrImageStorageId: "should-be-dropped-for-bank",
				note: " hi ",
				sortOrder: 9,
			},
			{
				type: "qr",
				label: "DuitNow",
				qrImageStorageId: " kg:abc ",
				bankName: "dropped-for-qr",
				sortOrder: 3,
			},
		]);
		expect(out).toEqual([
			{
				type: "bank",
				label: "Maybank", // defaulted from bank name
				bankName: "Maybank",
				bankAccountName: undefined,
				bankAccountNumber: "5123",
				qrImageStorageId: undefined,
				note: "hi",
				sortOrder: 0,
			},
			{
				type: "qr",
				label: "DuitNow",
				bankName: undefined,
				bankAccountName: undefined,
				bankAccountNumber: undefined,
				qrImageStorageId: "kg:abc",
				note: undefined,
				sortOrder: 1,
			},
		]);
	});

	test("drops empties — bank with no fields, qr with no image", () => {
		expect(
			sanitizePaymentMethods([
				{ type: "bank", label: "Empty bank", sortOrder: 0 },
				{ type: "qr", label: "Empty qr", sortOrder: 1 },
			]),
		).toBeUndefined();
	});

	test("throws past the method cap", () => {
		const many: PaymentMethod[] = Array.from(
			{ length: MAX_PAYMENT_METHODS + 1 },
			(_, i) => ({
				type: "bank",
				label: `B${i}`,
				bankAccountNumber: String(i),
				sortOrder: i,
			}),
		);
		expect(() => sanitizePaymentMethods(many)).toThrow(ConvexError);
	});

	test("throws when a field exceeds its length cap", () => {
		expect(() =>
			sanitizePaymentMethods([
				{
					type: "bank",
					label: "x",
					bankAccountNumber: "9".repeat(121),
					sortOrder: 0,
				},
			]),
		).toThrow(/exceeds/i);
	});
});
