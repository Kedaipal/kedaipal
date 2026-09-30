import { describe, expect, test } from "vitest";
import {
	answersForSubmit,
	type BuyerQuestion,
	type BuyerQuestionInput,
	firstMissingRequired,
	formatItemAnswers,
	MAX_ANSWER_LENGTH,
	MAX_BUYER_QUESTIONS,
	sanitizeBuyerQuestions,
	validateAnswers,
	visibleQuestions,
} from "./buyerQuestions";

// The worked example the feature was built for: Helinox Community Malaysia's
// Into The Falls registration.
const BRINGING: BuyerQuestion = {
	id: "bring001",
	label: "What are you bringing?",
	type: "choice",
	options: ["2 Helinox furniture", "Helinox tent"],
	required: true,
};
const TENT_MODEL: BuyerQuestion = {
	id: "tent0001",
	label: "Tent model",
	type: "text",
	required: true,
	showWhen: { questionId: "bring001", option: "Helinox tent" },
};
const HCM = [BRINGING, TENT_MODEL];

function counter() {
	let n = 0;
	return () => `minted${++n}`;
}

describe("sanitizeBuyerQuestions", () => {
	test("undefined and [] both mean no questions — one spelling for none", () => {
		expect(sanitizeBuyerQuestions(undefined)).toBeUndefined();
		expect(sanitizeBuyerQuestions([])).toBeUndefined();
	});

	test("the HCM pair round-trips unchanged", () => {
		expect(sanitizeBuyerQuestions(HCM)).toEqual(HCM);
	});

	test(`more than ${MAX_BUYER_QUESTIONS} questions is refused`, () => {
		const four = Array.from({ length: 4 }, (_, i) => ({
			label: `Q${i}`,
			type: "text" as const,
		}));
		expect(() => sanitizeBuyerQuestions(four)).toThrow(/at most 3/);
	});

	test("wording is trimmed, and blank or over-long wording is refused", () => {
		expect(
			sanitizeBuyerQuestions([{ id: "abcd", label: "  Name  ", type: "text" }]),
		).toEqual([{ id: "abcd", label: "Name", type: "text" }]);
		expect(() =>
			sanitizeBuyerQuestions([{ label: "   ", type: "text" }]),
		).toThrow(/needs some wording/);
		expect(() =>
			sanitizeBuyerQuestions([{ label: "x".repeat(81), type: "text" }]),
		).toThrow(/under 80/);
	});

	test("a missing or malformed id is minted; a duplicate id is re-minted", () => {
		const mintId = counter();
		const out = sanitizeBuyerQuestions(
			[
				{ label: "A", type: "text" },
				{ id: "no spaces allowed", label: "B", type: "text" },
				{ id: "keep1234", label: "C", type: "text" },
			],
			{ mintId },
		);
		expect(out?.map((q) => q.id)).toEqual(["minted1", "minted2", "keep1234"]);
		const dup = sanitizeBuyerQuestions(
			[
				{ id: "same1234", label: "A", type: "text" },
				{ id: "same1234", label: "B", type: "text" },
			],
			{ mintId: counter() },
		);
		expect(dup?.map((q) => q.id)).toEqual(["same1234", "minted1"]);
	});

	test("choice options are trimmed, blanks dropped, and deduped case-insensitively", () => {
		const out = sanitizeBuyerQuestions([
			{
				id: "spice001",
				label: "Spice",
				type: "choice",
				options: [" Mild ", "", "Hot", "mild", "HOT"],
			},
		]);
		expect(out?.[0].options).toEqual(["Mild", "Hot"]);
	});

	test("a choice needs 2 to 6 options, each under 40 characters", () => {
		expect(() =>
			sanitizeBuyerQuestions([
				{ label: "Spice", type: "choice", options: ["Mild", "mild"] },
			]),
		).toThrow(/2 to 6 options/);
		expect(() =>
			sanitizeBuyerQuestions([
				{
					label: "Spice",
					type: "choice",
					options: ["1", "2", "3", "4", "5", "6", "7"],
				},
			]),
		).toThrow(/2 to 6 options/);
		expect(() =>
			sanitizeBuyerQuestions([
				{ label: "Spice", type: "choice", options: ["a".repeat(41), "b"] },
			]),
		).toThrow(/under 40/);
	});

	test("a text question drops any options it was sent; required is true or unset", () => {
		const out = sanitizeBuyerQuestions([
			{
				id: "text0001",
				label: "Message",
				type: "text",
				options: ["x", "y"],
				required: false,
			},
		]);
		expect(out).toEqual([{ id: "text0001", label: "Message", type: "text" }]);
	});

	test("showWhen can point at a NEW row by the id the form minted for it", () => {
		const input: BuyerQuestionInput[] = [
			{ ...BRINGING, id: "formkey1" },
			{
				...TENT_MODEL,
				id: "formkey2",
				showWhen: { questionId: "formkey1", option: "helinox TENT" },
			},
		];
		const out = sanitizeBuyerQuestions(input);
		// The option is snapped to the trigger's own spelling.
		expect(out?.[1].showWhen).toEqual({
			questionId: "formkey1",
			option: "Helinox tent",
		});
	});

	test("a deleted trigger clears showWhen on its dependents — never dangling", () => {
		const out = sanitizeBuyerQuestions([TENT_MODEL]);
		expect(out?.[0].showWhen).toBeUndefined();
	});

	test("a trigger option renamed away clears showWhen", () => {
		const out = sanitizeBuyerQuestions([
			{ ...BRINGING, options: ["2 Helinox furniture", "Any tent"] },
			TENT_MODEL,
		]);
		expect(out?.[1].showWhen).toBeUndefined();
	});

	test("self-reference, a later trigger and a text trigger are all refused", () => {
		expect(() =>
			sanitizeBuyerQuestions([
				BRINGING,
				{ ...TENT_MODEL, showWhen: { questionId: "tent0001", option: "x" } },
			]),
		).toThrow(/depend on itself/);
		expect(() => sanitizeBuyerQuestions([TENT_MODEL, BRINGING])).toThrow(
			/question above it/,
		);
		expect(() =>
			sanitizeBuyerQuestions([
				{ id: "name0001", label: "Name", type: "text" },
				{
					...TENT_MODEL,
					showWhen: { questionId: "name0001", option: "x" },
				},
			]),
		).toThrow(/choice question/);
	});
});

describe("visibleQuestions", () => {
	test("the tent-model box appears only after Helinox tent is picked", () => {
		expect(visibleQuestions(HCM, {}).map((q) => q.id)).toEqual(["bring001"]);
		expect(
			visibleQuestions(HCM, { bring001: "2 Helinox furniture" }).map((q) => q.id),
		).toEqual(["bring001"]);
		expect(
			visibleQuestions(HCM, { bring001: "Helinox tent" }).map((q) => q.id),
		).toEqual(["bring001", "tent0001"]);
	});

	test("no questions → nothing to ask", () => {
		expect(visibleQuestions(undefined, {})).toEqual([]);
	});
});

describe("firstMissingRequired", () => {
	test("names the first unanswered visible required question", () => {
		expect(firstMissingRequired(HCM, {})?.label).toBe("What are you bringing?");
		expect(
			firstMissingRequired(HCM, { bring001: "Helinox tent" })?.label,
		).toBe("Tent model");
		expect(
			firstMissingRequired(HCM, {
				bring001: "Helinox tent",
				tent0001: "  ",
			})?.label,
		).toBe("Tent model");
		expect(
			firstMissingRequired(HCM, { bring001: "2 Helinox furniture" }),
		).toBeUndefined();
	});
});

describe("answersForSubmit", () => {
	test("drops blanks, hidden answers and ids the product no longer asks", () => {
		expect(
			answersForSubmit(HCM, {
				bring001: "2 Helinox furniture",
				tent0001: "Tactical One", // hidden now
				gone0001: "stale",
			}),
		).toEqual([{ questionId: "bring001", answer: "2 Helinox furniture" }]);
		expect(answersForSubmit(HCM, {})).toBeUndefined();
	});
});

describe("validateAnswers", () => {
	test("freezes each answer with the label it was asked with", () => {
		expect(
			validateAnswers(HCM, [
				{ questionId: "bring001", answer: "Helinox tent" },
				{ questionId: "tent0001", answer: "  Tactical One  " },
			]),
		).toEqual({
			answers: [
				{
					questionId: "bring001",
					label: "What are you bringing?",
					answer: "Helinox tent",
				},
				{ questionId: "tent0001", label: "Tent model", answer: "Tactical One" },
			],
			missing: [],
		});
	});

	test("a missing required answer is reported by label, not thrown", () => {
		expect(validateAnswers(HCM, undefined).missing).toEqual([
			"What are you bringing?",
		]);
		expect(
			validateAnswers(HCM, [{ questionId: "bring001", answer: "Helinox tent" }])
				.missing,
		).toEqual(["Tent model"]);
	});

	test("an answer to a hidden conditional question is dropped", () => {
		const { answers, missing } = validateAnswers(HCM, [
			{ questionId: "bring001", answer: "2 Helinox furniture" },
			{ questionId: "tent0001", answer: "Tactical One" },
		]);
		expect(answers.map((a) => a.questionId)).toEqual(["bring001"]);
		expect(missing).toEqual([]);
	});

	test("an unknown questionId is dropped, and a product with no questions freezes nothing", () => {
		expect(
			validateAnswers(HCM, [
				{ questionId: "bring001", answer: "2 Helinox furniture" },
				{ questionId: "gone0001", answer: "stale" },
			]).answers,
		).toHaveLength(1);
		expect(
			validateAnswers(undefined, [{ questionId: "x", answer: "y" }]),
		).toEqual({ answers: [], missing: [] });
	});

	test("a choice answer outside the options and an over-long text answer are refused", () => {
		expect(() =>
			validateAnswers(HCM, [{ questionId: "bring001", answer: "A hammock" }]),
		).toThrow(/offered options/);
		expect(() =>
			validateAnswers(HCM, [
				{ questionId: "bring001", answer: "Helinox tent" },
				{ questionId: "tent0001", answer: "x".repeat(MAX_ANSWER_LENGTH + 1) },
			]),
		).toThrow(/under 120/);
	});
});

describe("formatItemAnswers", () => {
	test("Label: answer; Label: answer", () => {
		expect(
			formatItemAnswers([
				{ label: "What are you bringing?", answer: "Helinox tent" },
				{ label: "Tent model", answer: "Tactical One" },
			]),
		).toBe("What are you bringing?: Helinox tent; Tent model: Tactical One");
		expect(formatItemAnswers(undefined)).toBe("");
	});
});
