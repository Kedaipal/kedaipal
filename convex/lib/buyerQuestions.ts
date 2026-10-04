// Buyer questions (`z8r3fdkjek`) — a seller asks the buyer up to three things
// about a product at checkout ("What are you bringing?", "Message on the
// cake", "Spice level"), and the answers freeze onto the order line.
//
// Built as a general primitive, NOT an event field (Arif, 30 Sep 2026): the
// ticket that forced it was Helinox Community Malaysia's Into The Falls
// registration ("2 Helinox furniture" or "Helinox tent", and if a tent, its
// model name), but the same shape is "message on the cake" for the made-to-
// order sellers and "participant name" for the class sellers. Option axes
// can't carry it — a third axis doesn't exist (`MAX_OPTION_AXES = 2`), free
// text has no axis at all, and the answer isn't a thing with its own price or
// stock. See docs/buyer-questions.md.
//
// Pure + dependency-free apart from `convex/values` (the `paymentMethod.ts`
// precedent — the validators live next to the rules so products, orders, the
// counter draft and claim lines share ONE spelling): imported by the Convex
// mutations that validate AND by the seller form / storefront that render.

import { ConvexError, v } from "convex/values";

/** At most three questions per product. The lever is restraint, not the plan
 * tier: every question is a field a buyer must read at checkout, and a fourth
 * is where a short checkout starts reading like a form. */
export const MAX_BUYER_QUESTIONS = 3;
/** Question wording — one line on a phone. */
export const MAX_QUESTION_LABEL = 80;
/** A choice needs at least two options, or it isn't a choice. */
export const MIN_QUESTION_OPTIONS = 2;
/** Six pills still fit two rows on a phone; past that it wants to be a
 * variant, not a question. */
export const MAX_QUESTION_OPTIONS = 6;
/** One option label — a pill, not a sentence. */
export const MAX_OPTION_LABEL = 40;
/** A text answer — a tent model, a name, a short cake message. Long enough for
 * "Happy 40th Birthday Kak Long, love from all of us", short enough that it
 * never becomes a second Notes box. */
export const MAX_ANSWER_LENGTH = 120;

export type BuyerQuestionType = "choice" | "text";

/** A question as stored on `products.buyerQuestions`. Public-safe by
 * construction: labels and options only. */
export type BuyerQuestion = {
	/** Stable id minted when the row is added; the answer keys on it, so a
	 * relabel never orphans an answer mid-checkout. */
	id: string;
	label: string;
	type: BuyerQuestionType;
	/** Choice only, `MIN_QUESTION_OPTIONS`..`MAX_QUESTION_OPTIONS`. */
	options?: string[];
	/** `true` or unset — one spelling. */
	required?: boolean;
	/** Shown only when an EARLIER choice question on the same product was
	 * answered with `option`. Hidden = never required, and any stale answer is
	 * dropped server-side. */
	showWhen?: { questionId: string; option: string };
};

/** Seller input — `id` optional so a hand-built payload may omit it (the form
 * always mints one on add, because `showWhen` must be able to point at a row
 * that hasn't been saved yet). */
export type BuyerQuestionInput = Omit<BuyerQuestion, "id"> & { id?: string };

/** One answer as sent by a buyer or the seller at the counter. */
export type ItemAnswerInput = { questionId: string; answer: string };

/** One answer as FROZEN on an order line — label included, like
 * `variantLabel`, so editing the question later never rewrites what this
 * buyer was asked. */
export type FrozenAnswer = { questionId: string; label: string; answer: string };

export const buyerQuestionShowWhenValidator = v.object({
	questionId: v.string(),
	option: v.string(),
});

const questionFields = {
	label: v.string(),
	type: v.union(v.literal("choice"), v.literal("text")),
	options: v.optional(v.array(v.string())),
	required: v.optional(v.boolean()),
	showWhen: v.optional(buyerQuestionShowWhenValidator),
};

/** `products.buyerQuestions[]` — the stored shape. */
export const buyerQuestionValidator = v.object({
	id: v.string(),
	...questionFields,
});

/** `products.create` / `update` arg — id optional. */
export const buyerQuestionInputValidator = v.object({
	id: v.optional(v.string()),
	...questionFields,
});

/** `orders.items[].answers[]` and `orderClaims.lines[].answers[]`. */
export const frozenAnswerValidator = v.object({
	questionId: v.string(),
	label: v.string(),
	answer: v.string(),
});

/** Mutation arg for an answer (`orders.create`, the counter, claims). */
export const itemAnswerInputValidator = v.object({
	questionId: v.string(),
	answer: v.string(),
});

const ID_PATTERN = /^[A-Za-z0-9_-]{4,32}$/;

/** 8 url-safe chars from a random UUID — plenty for three rows per product. */
export function mintQuestionId(): string {
	return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

function sameText(a: string, b: string): boolean {
	return a.toLocaleLowerCase() === b.toLocaleLowerCase();
}

/** Trim, drop blanks, dedupe case-insensitively (first spelling wins). */
export function normalizeOptions(raw: readonly string[]): string[] {
	const out: string[] = [];
	for (const value of raw) {
		const trimmed = value.trim();
		if (trimmed.length === 0) continue;
		if (out.some((kept) => sameText(kept, trimmed))) continue;
		out.push(trimmed);
	}
	return out;
}

/**
 * Validate a seller-submitted question list.
 *
 * `undefined` and `[]` both mean "no questions" and return `undefined`, so
 * the stored field has one spelling for "none" (the `event.seats: 0`
 * posture). Throws with seller-facing copy; callers wrap it in ConvexError.
 *
 * `showWhen` is treated in two ways on purpose:
 *  - DANGLING (the trigger question was deleted, or its option renamed away)
 *    is cleared silently — that's an ordinary edit, and the form clears it
 *    live too, so a seller never saves a question that can never appear.
 *  - SELF, LATER-IN-LIST or TEXT-TYPED trigger throws — the form can't build
 *    those, so only a hand-built payload reaches them.
 */
export function sanitizeBuyerQuestions(
	raw: readonly BuyerQuestionInput[] | undefined,
	opts: { mintId?: () => string } = {},
): BuyerQuestion[] | undefined {
	if (raw === undefined || raw.length === 0) return undefined;
	if (raw.length > MAX_BUYER_QUESTIONS)
		throw new Error(
			`A product can ask at most ${MAX_BUYER_QUESTIONS} questions`,
		);
	const mint = opts.mintId ?? mintQuestionId;

	// First pass: ids + labels + options, so the second pass can resolve
	// showWhen against the final ids.
	const out: BuyerQuestion[] = [];
	const inputIds: (string | undefined)[] = [];
	for (const [index, question] of raw.entries()) {
		const label = question.label.trim();
		if (label.length === 0)
			throw new Error(`Question ${index + 1} needs some wording`);
		if (label.length > MAX_QUESTION_LABEL)
			throw new Error(
				`“${label.slice(0, 24)}…” is too long — keep a question under ${MAX_QUESTION_LABEL} characters`,
			);
		let id = question.id?.trim();
		if (
			id === undefined ||
			!ID_PATTERN.test(id) ||
			out.some((kept) => kept.id === id)
		) {
			do id = mint();
			while (out.some((kept) => kept.id === id));
		}
		const next: BuyerQuestion = { id, label, type: question.type };
		if (question.type === "choice") {
			const options = normalizeOptions(question.options ?? []);
			const tooLong = options.find((o) => o.length > MAX_OPTION_LABEL);
			if (tooLong !== undefined)
				throw new Error(
					`“${tooLong.slice(0, 24)}…” is too long — keep an option under ${MAX_OPTION_LABEL} characters`,
				);
			if (
				options.length < MIN_QUESTION_OPTIONS ||
				options.length > MAX_QUESTION_OPTIONS
			)
				throw new Error(
					`“${label}” needs ${MIN_QUESTION_OPTIONS} to ${MAX_QUESTION_OPTIONS} options`,
				);
			next.options = options;
		}
		if (question.required === true) next.required = true;
		out.push(next);
		inputIds.push(question.id?.trim());
	}

	// Second pass: showWhen may reference the trigger by its INPUT id (the
	// form's minted id) — resolve it to the stored id at that position.
	for (const [index, question] of raw.entries()) {
		const when = question.showWhen;
		if (when === undefined) continue;
		const triggerIndex = out.findIndex(
			(stored, i) =>
				inputIds[i] === when.questionId || stored.id === when.questionId,
		);
		if (triggerIndex === index)
			throw new Error(`“${out[index].label}” can't depend on itself`);
		if (triggerIndex === -1) continue; // dangling — trigger deleted
		if (triggerIndex > index)
			throw new Error(
				`“${out[index].label}” can only depend on a question above it`,
			);
		const trigger = out[triggerIndex];
		if (trigger.type !== "choice")
			throw new Error(
				`“${out[index].label}” can only depend on a choice question`,
			);
		const option = trigger.options?.find((o) => sameText(o, when.option));
		if (option === undefined) continue; // dangling — option renamed away
		out[index] = {
			...out[index],
			showWhen: { questionId: trigger.id, option },
		};
	}
	return out;
}

/** Answers as a lookup, the shape the forms keep in state. */
export type AnswersById = Readonly<Record<string, string | undefined>>;

/**
 * The questions a buyer is actually asked, given what they've answered so
 * far. A conditional question is visible only when its trigger is visible AND
 * answered with its option (a hidden trigger hides its dependents).
 */
export function visibleQuestions(
	questions: readonly BuyerQuestion[] | undefined,
	answers: AnswersById,
): BuyerQuestion[] {
	const visible: BuyerQuestion[] = [];
	for (const question of questions ?? []) {
		const when = question.showWhen;
		if (when !== undefined) {
			const triggerShown = visible.some((q) => q.id === when.questionId);
			if (!triggerShown || answers[when.questionId] !== when.option) continue;
		}
		visible.push(question);
	}
	return visible;
}

/** The first visible required question still blank — for a CTA's
 * `blockedReason`. `undefined` = nothing blocking. */
export function firstMissingRequired(
	questions: readonly BuyerQuestion[] | undefined,
	answers: AnswersById,
): BuyerQuestion | undefined {
	return visibleQuestions(questions, answers).find(
		(q) => q.required === true && (answers[q.id] ?? "").trim().length === 0,
	);
}

/** The CTA hint for a missing answer — one wording on every surface. */
export function answerPrompt(label: string): string {
	return `Answer “${label}”`;
}

/** Server refusal when a required answer is missing. */
export function answerMissingMessage(
	productName: string,
	label: string,
): string {
	return `Please answer “${label}” for “${productName}”`;
}

/** List → lookup; the last answer for an id wins. */
export function answersById(
	answers: readonly ItemAnswerInput[] | undefined,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const a of answers ?? []) out[a.questionId] = a.answer;
	return out;
}

/** Lookup → list, in question order, blanks dropped, only ids the product
 * still asks (the form's send path). */
export function answersForSubmit(
	questions: readonly BuyerQuestion[] | undefined,
	answers: AnswersById,
): ItemAnswerInput[] | undefined {
	const out = visibleQuestions(questions, answers)
		.map((q) => ({ questionId: q.id, answer: (answers[q.id] ?? "").trim() }))
		.filter((a) => a.answer.length > 0);
	return out.length > 0 ? out : undefined;
}

/**
 * Validate a line's answers against the product's CURRENT questions and
 * freeze them.
 *
 * - unknown questionId (the seller deleted it mid-checkout) → dropped;
 * - answer to a hidden conditional question → dropped;
 * - blank optional → no row; blank required → its label in `missing`;
 * - choice answer not among the options → throws (only a stale or
 *   hand-built payload gets here);
 * - text answer over `MAX_ANSWER_LENGTH` → throws.
 *
 * `missing` is returned rather than thrown so each door names the PRODUCT in
 * its own refusal.
 */
export function validateAnswers(
	questions: readonly BuyerQuestion[] | undefined,
	raw: readonly ItemAnswerInput[] | undefined,
): { answers: FrozenAnswer[]; missing: string[] } {
	const byId = answersById(raw);
	const trimmed: Record<string, string> = {};
	for (const [id, answer] of Object.entries(byId)) trimmed[id] = answer.trim();
	const answers: FrozenAnswer[] = [];
	const missing: string[] = [];
	for (const question of visibleQuestions(questions, trimmed)) {
		const answer = trimmed[question.id] ?? "";
		if (answer.length === 0) {
			if (question.required === true) missing.push(question.label);
			continue;
		}
		if (question.type === "choice") {
			if (!(question.options ?? []).includes(answer))
				throw new Error(
					`Pick one of the offered options for “${question.label}”`,
				);
		} else if (answer.length > MAX_ANSWER_LENGTH) {
			throw new Error(
				`Keep “${question.label}” under ${MAX_ANSWER_LENGTH} characters`,
			);
		}
		answers.push({ questionId: question.id, label: question.label, answer });
	}
	return { answers, missing };
}

/**
 * The label as it prefixes its answer. A label is usually a question, and
 * "Vehicle plate number?: JJ7777J" is a typo the seller never wrote — so a
 * label already ending in `?` or `:` keeps its own punctuation and only a bare
 * noun ("Tent model") gains the colon. One spelling for every surface.
 */
export function answerLabelPrefix(label: string): string {
	const trimmed = label.trim();
	return /[?:？：]$/.test(trimmed) ? trimmed : `${trimmed}:`;
}

/** `Label: answer; Label: answer` — one order line's CSV/table cell. */
export function formatItemAnswers(
	answers: readonly Pick<FrozenAnswer, "label" | "answer">[] | undefined,
): string {
	return (answers ?? [])
		.map((a) => `${answerLabelPrefix(a.label)} ${a.answer}`)
		.join("; ");
}

/**
 * The ONE door-side call (`orders.create`, `counterCheckout.createOrderFromSession`,
 * `orderClaims.sendClaim`): validate a line's answers against the product's
 * current questions and return what to freeze, or refuse with the product and
 * question named. `undefined` = nothing to freeze (the field stays unset, one
 * spelling for "no answers").
 */
export function freezeLineAnswers(
	product: { name: string; buyerQuestions?: readonly BuyerQuestion[] },
	raw: readonly ItemAnswerInput[] | undefined,
): FrozenAnswer[] | undefined {
	let result: ReturnType<typeof validateAnswers>;
	try {
		result = validateAnswers(product.buyerQuestions, raw);
	} catch (err) {
		throw new ConvexError(`${(err as Error).message} (${product.name})`);
	}
	if (result.missing.length > 0)
		throw new ConvexError(answerMissingMessage(product.name, result.missing[0]));
	return result.answers.length > 0 ? result.answers : undefined;
}
