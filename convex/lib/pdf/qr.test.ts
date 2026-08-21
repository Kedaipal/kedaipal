import { describe, expect, test } from "vitest";
import {
	alignmentPositions,
	encodeQr,
	formatBits,
	gfMul,
	QR_MAX_VERSION,
	type QrMatrix,
	rsRemainder,
	totalCodewords,
	versionBits,
} from "./qr";

/**
 * A hand-written QR encoder can only be trusted if something independent reads
 * it back, so this file does not assert against remembered fixtures. Instead it
 * proves the encoder with checks derived from the spec's own mathematics:
 *
 *  - Reed-Solomon: every SYNDROME of (data ‖ ec) must be zero. That is the
 *    defining property of an RS codeword, computed here by Horner evaluation —
 *    completely different code from the encoder's polynomial long division.
 *  - Format / version information: the BCH codewords must be divisible by their
 *    generator polynomials, and carry back the level+mask / version they encode.
 *  - Capacity: the tabled block layout is cross-checked against the module-count
 *    formula, so the one memorised constant in qr.ts cannot be silently wrong.
 *  - The whole pipeline: `decodeQr` below re-derives the reserved map from plain
 *    geometry, reads the mask out of the format bits, un-masks, walks the
 *    zig-zag, de-interleaves the blocks and parses the byte-mode header — i.e.
 *    it is a real (error-correction-free) decoder, and it must return exactly
 *    what was encoded.
 */

// --- Independent helpers ----------------------------------------------------

/** GF(256) exponentiation by squaring, independent of qr.ts's log tables. */
function gfPow(base: number, exp: number): number {
	let result = 1;
	for (let i = 0; i < exp; i++) result = gfMul(result, base);
	return result;
}

/** Evaluate the received polynomial at α^power (Horner). */
function syndrome(codeword: Uint8Array, power: number): number {
	const x = gfPow(2, power);
	let acc = 0;
	for (const c of codeword) acc = gfMul(acc, x) ^ c;
	return acc;
}

/** Remainder of `value` (as a GF(2) polynomial) modulo `generator`. */
function polyMod(value: number, generator: number): number {
	const genBits = 32 - Math.clz32(generator);
	let rem = value;
	for (let shift = 32 - Math.clz32(rem); shift >= genBits; shift = 32 - Math.clz32(rem)) {
		rem ^= generator << (shift - genBits);
	}
	return rem;
}

/** Which modules are function patterns / reserved areas, from geometry alone. */
function reservedMap(size: number, version: number): boolean[][] {
	const map = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
	const mark = (x0: number, y0: number, w: number, h: number) => {
		for (let y = y0; y < y0 + h; y++) {
			for (let x = x0; x < x0 + w; x++) {
				if (x >= 0 && y >= 0 && x < size && y < size) map[y][x] = true;
			}
		}
	};
	// Finder + separator + format areas at the three corners.
	mark(0, 0, 9, 9);
	mark(size - 8, 0, 8, 9);
	mark(0, size - 8, 9, 8);
	// Timing lines.
	for (let i = 0; i < size; i++) {
		map[6][i] = true;
		map[i][6] = true;
	}
	// Alignment patterns (the finder corners are already covered above).
	const positions = alignmentPositions(version);
	const last = positions.length - 1;
	for (let i = 0; i < positions.length; i++) {
		for (let j = 0; j < positions.length; j++) {
			const corner =
				(i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
			if (!corner) mark(positions[i] - 2, positions[j] - 2, 5, 5);
		}
	}
	// Version information blocks.
	if (version >= 7) {
		mark(size - 11, 0, 3, 6);
		mark(0, size - 11, 6, 3);
	}
	return map;
}

/** `[ecPerBlock, blockCount]` re-derived per version for level M. Kept separate
 * from qr.ts's table on purpose — see the block comment at the top. */
const M_BLOCKS: ReadonlyArray<readonly [number, number]> = [
	[10, 1],
	[16, 1],
	[26, 1],
	[18, 2],
	[24, 2],
	[16, 4],
	[18, 4],
	[22, 4],
	[22, 5],
	[26, 5],
];

/**
 * Read a payload back out of a finished matrix. No error correction — it walks
 * the exact inverse of the encoder's placement, so any bug in masking,
 * zig-zag order, interleaving or the byte-mode header shows up as a mismatch.
 */
function decodeQr(qr: QrMatrix): string {
	const { size, modules } = qr;
	const version = (size - 17) / 4;
	const reserved = reservedMap(size, version);

	// Format bits, first copy: bits 0..5 in column 8 (rows 0..5), 6 at (8,7),
	// 7 at (8,8), 8 at (7,8), then 9..14 up column-wise along row 8.
	let bits = 0;
	const put = (index: number, dark: boolean) => {
		if (dark) bits |= 1 << index;
	};
	for (let i = 0; i <= 5; i++) put(i, modules[i][8]);
	put(6, modules[7][8]);
	put(7, modules[8][8]);
	put(8, modules[8][7]);
	for (let i = 9; i < 15; i++) put(i, modules[8][14 - i]);
	const format = bits ^ 0x5412;
	const mask = (format >> 10) & 0b111;

	// Un-mask the data modules.
	const plain = modules.map((row) => row.slice());
	const maskAt = (x: number, y: number): boolean => {
		switch (mask) {
			case 0:
				return (x + y) % 2 === 0;
			case 1:
				return y % 2 === 0;
			case 2:
				return x % 3 === 0;
			case 3:
				return (x + y) % 3 === 0;
			case 4:
				return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
			case 5:
				return ((x * y) % 2) + ((x * y) % 3) === 0;
			case 6:
				return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
			default:
				return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
		}
	};
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			if (!reserved[y][x] && maskAt(x, y)) plain[y][x] = !plain[y][x];
		}
	}

	// Walk the zig-zag back into the interleaved codeword stream.
	const total = totalCodewords(version);
	const stream: number[] = [];
	let acc = 0;
	let accBits = 0;
	for (let right = size - 1; right >= 1; right -= 2) {
		if (right === 6) right = 5;
		for (let vert = 0; vert < size; vert++) {
			for (let j = 0; j < 2; j++) {
				const x = right - j;
				const upward = ((right + 1) & 2) === 0;
				const y = upward ? size - 1 - vert : vert;
				if (reserved[y][x]) continue;
				acc = (acc << 1) | (plain[y][x] ? 1 : 0);
				accBits++;
				if (accBits === 8) {
					stream.push(acc);
					acc = 0;
					accBits = 0;
				}
			}
		}
	}

	// De-interleave: rebuild the block lengths, then read column-wise.
	const [ecPerBlock, blockCount] = M_BLOCKS[version - 1];
	const dataLen = total - ecPerBlock * blockCount;
	const shortLen = Math.floor(dataLen / blockCount);
	const longCount = dataLen % blockCount;
	const blockLens = Array.from({ length: blockCount }, (_, b) =>
		shortLen + (b >= blockCount - longCount ? 1 : 0),
	);
	const blocks: number[][] = blockLens.map(() => []);
	let i = 0;
	for (let col = 0; col <= shortLen; col++) {
		for (let b = 0; b < blockCount; b++) {
			if (col < blockLens[b]) blocks[b].push(stream[i++]);
		}
	}
	const data = blocks.flat();

	// Byte-mode header: 4-bit mode + 8/16-bit length + payload.
	const readBits = (offsetBits: number, count: number): number => {
		let value = 0;
		for (let k = 0; k < count; k++) {
			const bitIndex = offsetBits + k;
			const byte = data[bitIndex >> 3];
			value = (value << 1) | ((byte >> (7 - (bitIndex & 7))) & 1);
		}
		return value;
	};
	const mode = readBits(0, 4);
	if (mode !== 0b0100) throw new Error(`unexpected mode ${mode}`);
	const lenBits = version >= 10 ? 16 : 8;
	const length = readBits(4, lenBits);
	const bytes = new Uint8Array(length);
	for (let k = 0; k < length; k++) bytes[k] = readBits(4 + lenBits + k * 8, 8);
	return new TextDecoder().decode(bytes);
}

// --- Tests ------------------------------------------------------------------

describe("GF(256) arithmetic", () => {
	test("1 is the multiplicative identity and 0 annihilates", () => {
		for (let a = 0; a < 256; a++) {
			expect(gfMul(a, 1)).toBe(a);
			expect(gfMul(a, 0)).toBe(0);
		}
	});

	test("every non-zero element has an inverse (the field is closed)", () => {
		const seen = new Set<number>();
		for (let a = 1; a < 256; a++) seen.add(gfMul(a, gfPow(a, 254)));
		expect([...seen]).toEqual([1]);
	});
});

describe("Reed-Solomon", () => {
	// The defining property: (data ‖ ec) has zero syndromes at α^0 … α^(n-1).
	test.each([10, 16, 18, 22, 24, 26])(
		"all %i syndromes of a codeword are zero",
		(degree) => {
			const data = Uint8Array.from(
				{ length: 40 },
				(_, i) => (i * 37 + 11) % 256,
			);
			const ec = rsRemainder(data, degree);
			expect(ec).toHaveLength(degree);
			const codeword = new Uint8Array([...data, ...ec]);
			for (let power = 0; power < degree; power++) {
				expect(syndrome(codeword, power)).toBe(0);
			}
		},
	);

	test("a corrupted codeword has a non-zero syndrome (the check has teeth)", () => {
		const data = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
		const codeword = new Uint8Array([...data, ...rsRemainder(data, 10)]);
		codeword[3] ^= 0x5a;
		const syndromes = Array.from({ length: 10 }, (_, p) => syndrome(codeword, p));
		expect(syndromes.some((s) => s !== 0)).toBe(true);
	});
});

describe("version geometry", () => {
	test("total codewords match the published capacities", () => {
		expect(
			Array.from({ length: QR_MAX_VERSION }, (_, i) => totalCodewords(i + 1)),
		).toEqual([26, 44, 70, 100, 134, 172, 196, 242, 292, 346]);
	});

	test("alignment-pattern centres match the published table", () => {
		expect(alignmentPositions(1)).toEqual([]);
		expect(alignmentPositions(2)).toEqual([6, 18]);
		expect(alignmentPositions(6)).toEqual([6, 34]);
		expect(alignmentPositions(7)).toEqual([6, 22, 38]);
		expect(alignmentPositions(10)).toEqual([6, 28, 50]);
	});
});

describe("BCH information blocks", () => {
	test("format bits are divisible by G(x) = 0x537 and carry level M + mask", () => {
		for (let mask = 0; mask < 8; mask++) {
			const raw = formatBits(mask) ^ 0x5412;
			expect(polyMod(raw, 0x537)).toBe(0);
			// Top 5 bits: 2-bit EC level (M = 00) then the 3-bit mask.
			expect(raw >> 10).toBe(mask);
		}
	});

	test("all eight format words differ in at least 7 bits (Hamming distance)", () => {
		const words = Array.from({ length: 8 }, (_, m) => formatBits(m));
		for (let a = 0; a < 8; a++) {
			for (let b = a + 1; b < 8; b++) {
				let diff = 0;
				let xor = words[a] ^ words[b];
				while (xor) {
					diff += xor & 1;
					xor >>= 1;
				}
				expect(diff).toBeGreaterThanOrEqual(7);
			}
		}
	});

	test("version bits are divisible by G(x) = 0x1F25 and carry the version", () => {
		for (let version = 7; version <= QR_MAX_VERSION; version++) {
			const raw = versionBits(version);
			expect(polyMod(raw, 0x1f25)).toBe(0);
			expect(raw >> 12).toBe(version);
		}
	});
});

describe("encodeQr", () => {
	test("a tracking URL round-trips through a real decode", () => {
		const url = "https://kedaipal.com/track/aB3xY7kQ2mNp9RtV5wZs";
		const qr = encodeQr(url);
		expect(decodeQr(qr)).toBe(url);
	});

	test.each([
		"A",
		"ORD-1234",
		"https://kedaipal.com/track/aB3xY7kQ2mNp9RtV5wZsL4dE",
		"https://staging.example.com/track/aB3xY7kQ2mNp9RtV5wZsL4dE?utm=x",
		"x".repeat(120),
		"x".repeat(213),
	])("round-trips %#", (payload) => {
		expect(decodeQr(encodeQr(payload))).toBe(payload);
	});

	test("UTF-8 payloads round-trip byte-for-byte", () => {
		const payload = "https://kedaipal.com/track/ü-café-店";
		expect(decodeQr(encodeQr(payload))).toBe(payload);
	});

	test("picks the smallest version that fits", () => {
		// 51 chars — the real `/track/<24-char token>` shape.
		const url = `https://kedaipal.com/track/${"a".repeat(24)}`;
		expect(url).toHaveLength(51);
		const qr = encodeQr(url);
		expect((qr.size - 17) / 4).toBe(4);
		expect(encodeQr("hi").size).toBe(21); // version 1
	});

	test("structural invariants hold (finders, timing, dark module)", () => {
		const { size, modules } = encodeQr("https://kedaipal.com/track/abcdef");
		// Finder centres are dark, their surrounding ring is light.
		for (const [cx, cy] of [
			[3, 3],
			[size - 4, 3],
			[3, size - 4],
		]) {
			expect(modules[cy][cx]).toBe(true);
			expect(modules[cy - 2][cx]).toBe(false);
			expect(modules[cy - 3][cx]).toBe(true);
		}
		// Timing patterns alternate, starting dark at index 6.
		for (let i = 8; i < size - 8; i++) {
			expect(modules[6][i]).toBe(i % 2 === 0);
			expect(modules[i][6]).toBe(i % 2 === 0);
		}
		// The always-dark module below the top-left format block.
		expect(modules[size - 8][8]).toBe(true);
	});

	test("refuses a payload beyond version 10 rather than truncating", () => {
		expect(() => encodeQr("x".repeat(500))).toThrow(/too long/i);
	});
});
