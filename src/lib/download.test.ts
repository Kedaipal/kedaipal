// Default (edge-runtime) environment — no `window`, which also pins the
// SSR-safety branch below. The device-classification matrix that needs a DOM
// lives in download.dom.test.ts.
import { describe, expect, test } from "vitest";
import { imageExtension, prefersShareSheet, qrFilenameBase } from "./download";

describe("prefersShareSheet — non-browser safety", () => {
	test("a runtime with no touch/pointer signals never claims share-first", () => {
		// Server/edge render: `navigator` may exist but exposes no touch
		// digitiser, so the answer must be a plain "no" rather than a throw.
		expect(prefersShareSheet()).toBe(false);
	});
});

describe("imageExtension", () => {
	test("maps common image MIME types", () => {
		expect(imageExtension("image/jpeg")).toBe("jpg");
		expect(imageExtension("image/png")).toBe("png");
		expect(imageExtension("image/webp")).toBe("webp");
		expect(imageExtension("image/gif")).toBe("gif");
		expect(imageExtension("image/svg+xml")).toBe("svg");
	});

	test("defaults unknown / untyped to png", () => {
		expect(imageExtension("application/octet-stream")).toBe("png");
		expect(imageExtension("")).toBe("png");
	});
});

describe("qrFilenameBase", () => {
	test("slugifies the payment-method label and adds a -qr suffix", () => {
		expect(qrFilenameBase("TNG")).toBe("tng-qr");
		expect(qrFilenameBase("Maybank QRPay")).toBe("maybank-qrpay-qr");
	});

	test("keeps a single qr when the label already says QR", () => {
		expect(qrFilenameBase("DuitNow QR")).toBe("duitnow-qr");
		expect(qrFilenameBase("QR DuitNow")).toBe("qr-duitnow");
	});

	test("falls back to payment-qr for labels that slugify to nothing", () => {
		expect(qrFilenameBase("")).toBe("payment-qr");
		expect(qrFilenameBase("★★★")).toBe("payment-qr");
	});
});
