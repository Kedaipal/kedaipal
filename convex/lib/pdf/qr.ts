/**
 * Minimal QR Code encoder — byte mode, error-correction level M, versions 1–10.
 *
 * WHY IN-REPO: the despatch label (86eyp63mp) needs a QR inside a Convex
 * ACTION, and the app's only QR today is `react-qr-code`, a React component
 * that renders in the browser. Its encoder (`qr.js`) is a transitive dep, so it
 * isn't importable from our own code, and adding a decade-unmaintained package
 * as a direct dependency to draw a 33×33 grid is a worse trade than ~300 lines
 * of pure, typed, unit-tested arithmetic. No pdf-lib, no Convex imports — the
 * `document.ts` posture, so `render.ts` just draws the matrix this returns.
 *
 * SCOPE, deliberately small: byte mode only (URLs are ASCII), level M only
 * (~15% recovery — the right trade for a laser-printed label that gets smudged
 * and taped over), versions 1–10 (up to 213 bytes; a `/track/<token>` URL is
 * ~51 and lands on version 4). Anything longer throws rather than silently
 * truncating. Widening = extend EC_BLOCKS with the published table rows.
 *
 * Everything that CAN be computed is computed rather than tabled — total
 * codewords, alignment-pattern positions, format bits (BCH 15,5), version bits
 * (BCH 18,6) — so the only memorised constant is EC_BLOCKS, which `qr.test.ts`
 * cross-checks against the capacity formula.
 *
 * VERIFIED: `qr.test.ts` decodes every symbol back with an independent decoder
 * and proves the Reed-Solomon syndromes are zero. During development the output
 * was also diffed module-for-module against `qr.js` (react-qr-code's encoder)
 * across versions 1/3/4/5/7/10: the data layers are byte-identical for every
 * ASCII payload; only the mask-selection heuristic differs (a print-quality
 * tie-break, not correctness). Non-ASCII deliberately diverges — this encoder
 * emits real UTF-8, where qr.js truncates UTF-16 code units to 8 bits.
 */

/** A rendered QR symbol. `modules[y][x] === true` means a DARK module. */
export type QrMatrix = {
	/** Width and height in modules (always `4 * version + 17`). */
	size: number;
	modules: boolean[][];
};

/** Largest supported symbol version (see the file header for why). */
export const QR_MAX_VERSION = 10;

/**
 * `[ecCodewordsPerBlock, blockCount]` for error-correction level M, indexed by
 * `version - 1`. The published ISO/IEC 18004 table. Everything else about a
 * version's block layout is derived: data codewords = total − ec × blocks, then
 * split into `blocks` near-equal groups (the short blocks first).
 */
const EC_BLOCKS: ReadonlyArray<readonly [number, number]> = [
	[10, 1], // v1
	[16, 1], // v2
	[26, 1], // v3
	[18, 2], // v4
	[24, 2], // v5
	[16, 4], // v6
	[18, 4], // v7
	[22, 4], // v8
	[22, 5], // v9
	[26, 5], // v10
];

/** Level M's 2-bit indicator in the format information. */
const EC_LEVEL_BITS = 0b00;

// --- GF(256) arithmetic (primitive polynomial x^8 + x^4 + x^3 + x^2 + 1) -----

const GF_EXP = new Uint8Array(256);
const GF_LOG = new Uint8Array(256);
{
	let x = 1;
	for (let i = 0; i < 255; i++) {
		GF_EXP[i] = x;
		GF_LOG[x] = i;
		x <<= 1;
		if (x & 0x100) x ^= 0x11d;
	}
}

/** Multiply in GF(256). Exported for the test's independent syndrome check. */
export function gfMul(a: number, b: number): number {
	if (a === 0 || b === 0) return 0;
	return GF_EXP[(GF_LOG[a] + GF_LOG[b]) % 255];
}

/** Reed-Solomon generator polynomial of `degree`, coefficients high-to-low
 * (the leading 1 is implicit). */
function rsGenerator(degree: number): Uint8Array {
	const coeffs = new Uint8Array(degree);
	coeffs[degree - 1] = 1;
	let root = 1;
	for (let i = 0; i < degree; i++) {
		// Multiply the running polynomial by (x - root), i.e. (x + root) in GF(2).
		for (let j = 0; j < degree; j++) {
			coeffs[j] = gfMul(coeffs[j], root);
			if (j + 1 < degree) coeffs[j] ^= coeffs[j + 1];
		}
		root = gfMul(root, 2);
	}
	return coeffs;
}

/** The `degree` error-correction codewords for one data block. */
export function rsRemainder(data: Uint8Array, degree: number): Uint8Array {
	const gen = rsGenerator(degree);
	const result = new Uint8Array(degree);
	for (const b of data) {
		const factor = b ^ result[0];
		result.copyWithin(0, 1);
		result[degree - 1] = 0;
		for (let i = 0; i < degree; i++) result[i] ^= gfMul(gen[i], factor);
	}
	return result;
}

// --- Version geometry -------------------------------------------------------

/** Total codewords (data + EC) a version holds. Derived from the module count
 * so the EC_BLOCKS table can be cross-checked rather than trusted. */
export function totalCodewords(version: number): number {
	let modules = (16 * version + 128) * version + 64;
	if (version >= 2) {
		const align = alignmentPositions(version).length;
		modules -= (25 * align - 10) * align - 55;
		if (version >= 7) modules -= 36;
	}
	return Math.floor(modules / 8);
}

/** Centres of the alignment patterns, ascending. Empty for version 1. */
export function alignmentPositions(version: number): number[] {
	if (version === 1) return [];
	const count = Math.floor(version / 7) + 2;
	const size = version * 4 + 17;
	const step = Math.floor((version * 4 + count * 2 + 1) / (count * 2 - 2)) * 2;
	const positions: number[] = [];
	for (let pos = size - 7; positions.length < count - 1; pos -= step) {
		positions.unshift(pos);
	}
	positions.unshift(6);
	return positions;
}

/** Data-codeword capacity of a version at level M. */
function dataCapacity(version: number): number {
	const [ecPerBlock, blocks] = EC_BLOCKS[version - 1];
	return totalCodewords(version) - ecPerBlock * blocks;
}

// --- Encoding ---------------------------------------------------------------

class BitBuffer {
	readonly bits: number[] = [];
	push(value: number, length: number): void {
		for (let i = length - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
	}
}

/** UTF-8 bytes of `text` (byte mode is defined over an 8-bit stream; ECI is
 * out of scope, and every payload we emit is a URL). */
function utf8Bytes(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

/** Smallest version 1..10 whose level-M capacity fits `byteLen`. */
function pickVersion(byteLen: number): number {
	for (let version = 1; version <= QR_MAX_VERSION; version++) {
		// 4-bit mode indicator + character count (8 bits below v10, 16 at v10).
		const headerBits = 4 + (version >= 10 ? 16 : 8);
		if (dataCapacity(version) * 8 >= headerBits + byteLen * 8) return version;
	}
	throw new Error(
		`QR payload too long (${byteLen} bytes; max ${dataCapacity(QR_MAX_VERSION)} at version ${QR_MAX_VERSION})`,
	);
}

/** Mode indicator + length + payload + terminator + pad, to the version's
 * exact data-codeword capacity. */
function buildDataCodewords(bytes: Uint8Array, version: number): Uint8Array {
	const capacity = dataCapacity(version);
	const bb = new BitBuffer();
	bb.push(0b0100, 4); // byte mode
	bb.push(bytes.length, version >= 10 ? 16 : 8);
	for (const b of bytes) bb.push(b, 8);
	// Terminator (up to 4 zero bits), then pad to a byte boundary.
	const capacityBits = capacity * 8;
	const terminator = Math.min(4, capacityBits - bb.bits.length);
	bb.push(0, terminator);
	bb.push(0, (8 - (bb.bits.length % 8)) % 8);

	const out = new Uint8Array(capacity);
	for (let i = 0; i < bb.bits.length; i += 8) {
		let byte = 0;
		for (let j = 0; j < 8; j++) byte = (byte << 1) | bb.bits[i + j];
		out[i / 8] = byte;
	}
	// Alternating pad codewords (0xEC, 0x11, …) fill the remainder.
	const written = bb.bits.length / 8;
	for (let i = written; i < capacity; i++) {
		out[i] = (i - written) % 2 === 0 ? 0xec : 0x11;
	}
	return out;
}

/** Split into blocks, append each block's EC codewords, interleave. */
function interleave(data: Uint8Array, version: number): Uint8Array {
	const [ecPerBlock, blockCount] = EC_BLOCKS[version - 1];
	const shortLen = Math.floor(data.length / blockCount);
	const longCount = data.length % blockCount; // blocks carrying one extra byte

	const dataBlocks: Uint8Array[] = [];
	const ecBlocks: Uint8Array[] = [];
	let offset = 0;
	for (let b = 0; b < blockCount; b++) {
		const len = shortLen + (b >= blockCount - longCount ? 1 : 0);
		const block = data.subarray(offset, offset + len);
		offset += len;
		dataBlocks.push(block);
		ecBlocks.push(rsRemainder(block, ecPerBlock));
	}

	const out = new Uint8Array(totalCodewords(version));
	let i = 0;
	for (let col = 0; col <= shortLen; col++) {
		for (const block of dataBlocks) {
			if (col < block.length) out[i++] = block[col];
		}
	}
	for (let col = 0; col < ecPerBlock; col++) {
		for (const block of ecBlocks) out[i++] = block[col];
	}
	return out;
}

// --- Matrix -----------------------------------------------------------------

type Grid = {
	size: number;
	modules: boolean[][];
	/** Function patterns + reserved areas: never carry data, never get masked. */
	reserved: boolean[][];
};

function newGrid(size: number): Grid {
	return {
		size,
		modules: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
		reserved: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
	};
}

function setFunction(g: Grid, x: number, y: number, dark: boolean): void {
	if (x < 0 || y < 0 || x >= g.size || y >= g.size) return;
	g.modules[y][x] = dark;
	g.reserved[y][x] = true;
}

function drawFinder(g: Grid, cx: number, cy: number): void {
	for (let dy = -4; dy <= 4; dy++) {
		for (let dx = -4; dx <= 4; dx++) {
			const dist = Math.max(Math.abs(dx), Math.abs(dy));
			setFunction(g, cx + dx, cy + dy, dist !== 2 && dist !== 4);
		}
	}
}

function drawAlignment(g: Grid, cx: number, cy: number): void {
	for (let dy = -2; dy <= 2; dy++) {
		for (let dx = -2; dx <= 2; dx++) {
			setFunction(g, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
		}
	}
}

/** 15-bit format information for level M + `mask` (BCH(15,5), XOR 0x5412). */
export function formatBits(mask: number): number {
	const data = (EC_LEVEL_BITS << 3) | mask;
	let rem = data;
	for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
	return ((data << 10) | rem) ^ 0x5412;
}

/** 18-bit version information for versions ≥ 7 (BCH(18,6)). */
export function versionBits(version: number): number {
	let rem = version;
	for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
	return (version << 12) | rem;
}

function bitAt(value: number, index: number): boolean {
	return ((value >> index) & 1) === 1;
}

function drawFormat(g: Grid, mask: number): void {
	const bits = formatBits(mask);
	for (let i = 0; i <= 5; i++) setFunction(g, 8, i, bitAt(bits, i));
	setFunction(g, 8, 7, bitAt(bits, 6));
	setFunction(g, 8, 8, bitAt(bits, 7));
	setFunction(g, 7, 8, bitAt(bits, 8));
	for (let i = 9; i < 15; i++) setFunction(g, 14 - i, 8, bitAt(bits, i));

	for (let i = 0; i < 8; i++) setFunction(g, g.size - 1 - i, 8, bitAt(bits, i));
	for (let i = 8; i < 15; i++) setFunction(g, 8, g.size - 15 + i, bitAt(bits, i));
	setFunction(g, 8, g.size - 8, true); // the always-dark module
}

function drawFunctionPatterns(g: Grid, version: number): void {
	for (let i = 0; i < g.size; i++) {
		setFunction(g, 6, i, i % 2 === 0);
		setFunction(g, i, 6, i % 2 === 0);
	}
	drawFinder(g, 3, 3);
	drawFinder(g, g.size - 4, 3);
	drawFinder(g, 3, g.size - 4);

	const positions = alignmentPositions(version);
	const last = positions.length - 1;
	for (let i = 0; i < positions.length; i++) {
		for (let j = 0; j < positions.length; j++) {
			// The three finder corners already own those cells.
			const corner =
				(i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
			if (!corner) drawAlignment(g, positions[i], positions[j]);
		}
	}

	// Reserve the format area (real bits written per-mask later).
	drawFormat(g, 0);

	if (version >= 7) {
		const bits = versionBits(version);
		for (let i = 0; i < 18; i++) {
			const bit = bitAt(bits, i);
			const a = g.size - 11 + (i % 3);
			const b = Math.floor(i / 3);
			setFunction(g, a, b, bit);
			setFunction(g, b, a, bit);
		}
	}
}

/** Zig-zag placement of the interleaved codeword stream, right to left. */
function drawCodewords(g: Grid, codewords: Uint8Array): void {
	let bit = 0;
	const totalBits = codewords.length * 8;
	for (let right = g.size - 1; right >= 1; right -= 2) {
		if (right === 6) right = 5; // skip the vertical timing column
		for (let vert = 0; vert < g.size; vert++) {
			for (let j = 0; j < 2; j++) {
				const x = right - j;
				const upward = ((right + 1) & 2) === 0;
				const y = upward ? g.size - 1 - vert : vert;
				if (g.reserved[y][x]) continue;
				// Remainder bits past the stream stay light (already false).
				if (bit < totalBits) {
					g.modules[y][x] = bitAt(codewords[bit >> 3], 7 - (bit & 7));
				}
				bit++;
			}
		}
	}
}

function maskAt(mask: number, x: number, y: number): boolean {
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
}

function applyMask(g: Grid, mask: number): void {
	for (let y = 0; y < g.size; y++) {
		for (let x = 0; x < g.size; x++) {
			if (!g.reserved[y][x] && maskAt(mask, x, y)) {
				g.modules[y][x] = !g.modules[y][x];
			}
		}
	}
}

/**
 * ISO/IEC 18004 penalty score — lower is better. Only used to CHOOSE among the
 * 8 masks, so an imprecise rule would still yield a valid (just less optimal)
 * symbol; it is implemented faithfully anyway.
 */
function penalty(g: Grid): number {
	const { size, modules } = g;
	let score = 0;

	// N1: runs of 5+ same-coloured modules in a row/column.
	for (let i = 0; i < size; i++) {
		for (const horizontal of [true, false]) {
			let run = 1;
			for (let j = 1; j < size; j++) {
				const cur = horizontal ? modules[i][j] : modules[j][i];
				const prev = horizontal ? modules[i][j - 1] : modules[j - 1][i];
				if (cur === prev) {
					run++;
					if (run === 5) score += 3;
					else if (run > 5) score += 1;
				} else {
					run = 1;
				}
			}
		}
	}

	// N2: 2x2 blocks of one colour.
	for (let y = 0; y < size - 1; y++) {
		for (let x = 0; x < size - 1; x++) {
			const c = modules[y][x];
			if (
				c === modules[y][x + 1] &&
				c === modules[y + 1][x] &&
				c === modules[y + 1][x + 1]
			) {
				score += 3;
			}
		}
	}

	// N3: the finder-like 1:1:3:1:1 pattern with a 4-module light margin.
	const finder = [true, false, true, true, true, false, true];
	const light4 = [false, false, false, false];
	const matches = (line: boolean[], at: number, pattern: boolean[]): boolean => {
		if (at < 0 || at + pattern.length > line.length) return false;
		return pattern.every((v, k) => line[at + k] === v);
	};
	for (let i = 0; i < size; i++) {
		const row = modules[i];
		const col = modules.map((r) => r[i]);
		for (const line of [row, col]) {
			for (let j = 0; j + finder.length <= size; j++) {
				if (!matches(line, j, finder)) continue;
				if (
					matches(line, j - light4.length, light4) ||
					matches(line, j + finder.length, light4)
				) {
					score += 40;
				}
			}
		}
	}

	// N4: deviation of the dark-module proportion from 50%.
	let dark = 0;
	for (const row of modules) for (const m of row) if (m) dark++;
	const percent = (dark * 100) / (size * size);
	score += Math.floor(Math.abs(percent - 50) / 5) * 10;
	return score;
}

/**
 * Encode `text` as a QR symbol (byte mode, level M). Throws when the payload
 * exceeds version 10's capacity — a truncated QR would resolve to the wrong
 * URL, which is worse than no QR at all (the caller omits it).
 */
export function encodeQr(text: string): QrMatrix {
	const bytes = utf8Bytes(text);
	const version = pickVersion(bytes.length);
	const codewords = interleave(buildDataCodewords(bytes, version), version);

	let best: Grid | null = null;
	let bestScore = Number.POSITIVE_INFINITY;
	for (let mask = 0; mask < 8; mask++) {
		const g = newGrid(version * 4 + 17);
		drawFunctionPatterns(g, version);
		drawCodewords(g, codewords);
		applyMask(g, mask);
		drawFormat(g, mask);
		const score = penalty(g);
		if (score < bestScore) {
			bestScore = score;
			best = g;
		}
	}
	// `best` is always set — the loop runs 8 times with a finite score.
	const grid = best as Grid;
	return { size: grid.size, modules: grid.modules };
}
