import { describe, expect, test } from "vitest";
import {
	type BuyerQuestionsDraft,
	normalizeQuestionsDraft,
	questionsDraftFrom,
	questionsDraftIssue,
	questionRowIssues,
	questionsSubmitValue,
} from "./buyer-questions-card";

const BRINGING = {
	id: "bring001",
	label: "What are you bringing?",
	type: "choice" as const,
	options: ["2 Helinox furniture", "Helinox tent"],
	required: true,
	showWhenId: "",
	showWhenOption: "",
};
const TENT = {
	id: "tent0001",
	label: "Tent model",
	type: "text" as const,
	options: [],
	required: true,
	showWhenId: "bring001",
	showWhenOption: "Helinox tent",
};

describe("buyer questions — seller draft", () => {
	test("draft → submit → stored → draft is lossless", () => {
		const draft: BuyerQuestionsDraft = [BRINGING, TENT];
		const submitted = questionsSubmitValue(draft);
		expect(submitted[1]).toEqual({
			id: "tent0001",
			label: "Tent model",
			type: "text",
			required: true,
			showWhen: { questionId: "bring001", option: "Helinox tent" },
		});
		expect(
			questionsDraftFrom(submitted.map((q) => ({ ...q, id: q.id ?? "" }))),
		).toEqual(draft);
	});

	test("an empty draft submits [] — the spelling that clears on edit", () => {
		expect(questionsSubmitValue([])).toEqual([]);
	});

	test("the validity check is the server's own sanitizer", () => {
		expect(questionsDraftIssue([BRINGING, TENT])).toBeNull();
		expect(
			questionsDraftIssue([{ ...BRINGING, options: ["Only one"] }]),
		).toMatch(/2 to 6 options/);
		expect(questionsDraftIssue([{ ...BRINGING, label: " " }])).toMatch(
			/needs some wording/,
		);
	});

	test("removing the trigger clears the dependent's condition", () => {
		expect(normalizeQuestionsDraft([TENT])[0]).toMatchObject({
			showWhenId: "",
			showWhenOption: "",
		});
	});

	test("switching the trigger to a short answer, or deleting its option, clears it too", () => {
		expect(
			normalizeQuestionsDraft([{ ...BRINGING, type: "text" }, TENT])[1]
				.showWhenId,
		).toBe("");
		expect(
			normalizeQuestionsDraft([
				{ ...BRINGING, options: ["2 Helinox furniture", "Chairs"] },
				TENT,
			])[1],
		).toMatchObject({ showWhenId: "bring001", showWhenOption: "" });
	});
});

describe("questionRowIssues — the error sits under the box to fix", () => {
	test("a blank question asks for wording; a one-option pick asks for more", () => {
		expect(
			questionRowIssues({ ...BRINGING, label: " ", options: ["Only one"] }),
		).toEqual({
			label: "Add the question's wording.",
			options: "Add at least 2 options — a buyer needs something to pick.",
		});
	});

	test("a finished row has nothing to say, and a short answer needs no options", () => {
		expect(questionRowIssues(BRINGING)).toEqual({});
		expect(questionRowIssues(TENT)).toEqual({});
	});
});
