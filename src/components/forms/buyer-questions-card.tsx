// The seller's side of buyer questions (`z8r3fdkjek`) — "Ask the buyer" on the
// product form and in the wizard's "More options" drawer. Mirrors
// `event-fields.tsx`: a raw draft type, a draft ⇄ stored pair, one validity
// check that CALLS the server's own sanitizer (so the form can never offer a
// Save the server refuses), and the fields component both surfaces render.
//
// Ids are minted the moment a row is ADDED, not at save: "Show only when"
// must be able to point at a question that hasn't been saved yet, and the
// sanitizer keeps a well-formed id, so the id a dependent names is the id that
// gets stored.

import { Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import {
	type BuyerQuestion,
	type BuyerQuestionInput,
	type BuyerQuestionType,
	MAX_BUYER_QUESTIONS,
	MAX_OPTION_LABEL,
	MAX_QUESTION_LABEL,
	MAX_QUESTION_OPTIONS,
	mintQuestionId,
	normalizeOptions,
	sanitizeBuyerQuestions,
} from "../../../convex/lib/buyerQuestions";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ModeButton } from "../ui/mode-button";
import { ToggleSwitch } from "../ui/toggle-switch";

export type QuestionDraft = {
	id: string;
	label: string;
	type: BuyerQuestionType;
	/** Committed option chips (choice only). */
	options: string[];
	required: boolean;
	/** "" = always shown. */
	showWhenId: string;
	showWhenOption: string;
};

export type BuyerQuestionsDraft = QuestionDraft[];

export const EMPTY_QUESTIONS_DRAFT: BuyerQuestionsDraft = [];

export function newQuestionDraft(): QuestionDraft {
	return {
		id: mintQuestionId(),
		label: "",
		type: "choice",
		options: [],
		required: true,
		showWhenId: "",
		showWhenOption: "",
	};
}

export function questionsDraftFrom(
	stored: readonly BuyerQuestion[] | undefined,
): BuyerQuestionsDraft {
	return (stored ?? []).map((q) => ({
		id: q.id,
		label: q.label,
		type: q.type,
		options: q.options ?? [],
		required: q.required === true,
		showWhenId: q.showWhen?.questionId ?? "",
		showWhenOption: q.showWhen?.option ?? "",
	}));
}

/** Draft → the `buyerQuestions` arg. `[]` when empty — the CLEAR spelling on
 * update (the server normalises it to unset). */
export function questionsSubmitValue(
	draft: BuyerQuestionsDraft,
): BuyerQuestionInput[] {
	return draft.map((q) => ({
		id: q.id,
		label: q.label,
		type: q.type,
		...(q.type === "choice" ? { options: q.options } : {}),
		...(q.required ? { required: true } : {}),
		...(q.showWhenId && q.showWhenOption
			? { showWhen: { questionId: q.showWhenId, option: q.showWhenOption } }
			: {}),
	}));
}

/** The server's own verdict on the draft, or null when it would save. */
export function questionsDraftIssue(draft: BuyerQuestionsDraft): string | null {
	try {
		sanitizeBuyerQuestions(questionsSubmitValue(draft));
		return null;
	} catch (err) {
		return (err as Error).message;
	}
}

export function questionsDraftValid(draft: BuyerQuestionsDraft): boolean {
	return questionsDraftIssue(draft) === null;
}

/**
 * Keep every "Show only when" pointing at something real after an edit: a
 * removed trigger, a trigger switched to text, a trigger moved below its
 * dependent, or a deleted option all clear the condition — the question
 * reverts to "always shown" rather than silently never appearing.
 */
export function normalizeQuestionsDraft(
	draft: BuyerQuestionsDraft,
): BuyerQuestionsDraft {
	return draft.map((q, index) => {
		if (!q.showWhenId) return q;
		const triggerIndex = draft.findIndex((t) => t.id === q.showWhenId);
		const trigger = draft[triggerIndex];
		const valid =
			trigger !== undefined &&
			triggerIndex < index &&
			trigger.type === "choice";
		if (!valid) return { ...q, showWhenId: "", showWhenOption: "" };
		if (q.showWhenOption && !trigger.options.includes(q.showWhenOption))
			return { ...q, showWhenOption: "" };
		return q;
	});
}

const SELECT_CLASS =
	"h-11 w-full rounded-xl border border-input bg-background px-2 text-sm";

export function BuyerQuestionsEditor({
	draft,
	onChange,
}: {
	draft: BuyerQuestionsDraft;
	onChange: (next: BuyerQuestionsDraft) => void;
}) {
	const atCap = draft.length >= MAX_BUYER_QUESTIONS;
	const issue = questionsDraftIssue(draft);

	function commit(next: BuyerQuestionsDraft) {
		onChange(normalizeQuestionsDraft(next));
	}
	function patch(id: string, fields: Partial<QuestionDraft>) {
		commit(draft.map((q) => (q.id === id ? { ...q, ...fields } : q)));
	}

	return (
		<div className="flex flex-col gap-3">
			{draft.length === 0 ? (
				<p className="rounded-xl bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
					Nothing asked yet. Add a question when you need something from every
					buyer — a message on the cake, a spice level, what they're bringing
					to the event. They can't check out until a required one is answered.
				</p>
			) : null}
			{draft.map((question, index) => (
				<QuestionRow
					key={question.id}
					index={index}
					question={question}
					earlier={draft.slice(0, index)}
					onPatch={(fields) => patch(question.id, fields)}
					onRemove={() => commit(draft.filter((q) => q.id !== question.id))}
				/>
			))}
			{issue && draft.length > 0 ? (
				<p role="alert" className="text-xs text-destructive">
					{issue}
				</p>
			) : null}
			<div className="flex flex-wrap items-center gap-2">
				<Button
					type="button"
					variant="outline"
					disabled={atCap}
					onClick={() => commit([...draft, newQuestionDraft()])}
					className="min-h-11"
				>
					<Plus className="size-4" />
					Add question
				</Button>
				<span className="text-xs text-muted-foreground">
					{atCap
						? `${MAX_BUYER_QUESTIONS} of ${MAX_BUYER_QUESTIONS} — that's the limit, so checkout stays short.`
						: `${draft.length} of ${MAX_BUYER_QUESTIONS}`}
				</span>
			</div>
			{draft.length > 0 ? (
				<p className="text-xs leading-relaxed text-muted-foreground">
					Answers show on the order, the buyer's tracking page and your CSV
					export. Rewording a question later never changes past orders — they
					keep the wording the buyer saw.
				</p>
			) : null}
		</div>
	);
}

function QuestionRow({
	index,
	question,
	earlier,
	onPatch,
	onRemove,
}: {
	index: number;
	question: QuestionDraft;
	earlier: readonly QuestionDraft[];
	onPatch: (fields: Partial<QuestionDraft>) => void;
	onRemove: () => void;
}) {
	const [optionText, setOptionText] = useState("");
	const labelId = `bq-label-${question.id}`;
	const triggers = earlier.filter(
		(q) => q.type === "choice" && q.options.length > 0,
	);
	const trigger = triggers.find((q) => q.id === question.showWhenId);
	const optionsFull = question.options.length >= MAX_QUESTION_OPTIONS;

	function addOption() {
		const text = optionText.trim().slice(0, MAX_OPTION_LABEL);
		setOptionText("");
		if (!text || optionsFull) return;
		onPatch({ options: normalizeOptions([...question.options, text]) });
	}

	return (
		<fieldset className="flex min-w-0 flex-col gap-3 rounded-xl border border-border p-3">
			<div className="flex items-center justify-between gap-2">
				<legend className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
					Question {index + 1}
				</legend>
				<button
					type="button"
					onClick={onRemove}
					className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive"
					aria-label={`Remove question ${index + 1}`}
				>
					<Trash2 className="size-4" />
				</button>
			</div>

			<div className="flex flex-col gap-1.5">
				<label htmlFor={labelId} className="text-sm font-medium">
					What do you want to ask?
				</label>
				<Input
					id={labelId}
					variant="field"
					value={question.label}
					maxLength={MAX_QUESTION_LABEL}
					placeholder={
						question.type === "choice"
							? "e.g. What are you bringing?"
							: "e.g. Message on the cake"
					}
					onChange={(e) => onPatch({ label: e.target.value })}
				/>
			</div>

			<div className="grid grid-cols-2 gap-2">
				<ModeButton
					active={question.type === "choice"}
					onClick={() => onPatch({ type: "choice" })}
					title="Pick one"
					subtitle="Buyer taps an option"
				/>
				<ModeButton
					active={question.type === "text"}
					onClick={() => onPatch({ type: "text" })}
					title="Short answer"
					subtitle="Buyer types a reply"
				/>
			</div>

			{question.type === "choice" ? (
				<div className="flex flex-col gap-1.5">
					<p className="text-sm font-medium">Options</p>
					<div className="flex flex-wrap items-center gap-1.5">
						{question.options.map((option) => (
							<span
								key={option}
								className="inline-flex min-h-8 items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs font-medium"
							>
								{option}
								<button
									type="button"
									onClick={() =>
										onPatch({
											options: question.options.filter((o) => o !== option),
										})
									}
									aria-label={`Remove ${option}`}
									className="-mr-1 flex size-6 items-center justify-center rounded-full hover:bg-background"
								>
									<X className="size-3" />
								</button>
							</span>
						))}
						{optionsFull ? null : (
							<div className="flex items-center gap-1">
								<Input
									aria-label={`Add an option to question ${index + 1}`}
									placeholder="Add option"
									value={optionText}
									maxLength={MAX_OPTION_LABEL}
									onChange={(e) => setOptionText(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === ",") {
											e.preventDefault();
											addOption();
										}
									}}
									// Android keyboards don't fire a reliable Enter —
									// losing focus commits, as in the variant editor.
									onBlur={addOption}
									className="h-9 w-32 text-xs"
								/>
								<button
									type="button"
									onClick={addOption}
									className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:border-accent"
									aria-label="Add option"
								>
									<Plus className="size-3.5" />
								</button>
							</div>
						)}
					</div>
					<p className="text-xs text-muted-foreground">
						{optionsFull
							? `${MAX_QUESTION_OPTIONS} options is the most — remove one to add another.`
							: `2 to ${MAX_QUESTION_OPTIONS} options. Press Enter after each.`}
					</p>
				</div>
			) : (
				<p className="text-xs text-muted-foreground">
					The buyer gets a one-line box, up to 120 characters.
				</p>
			)}

			<div className="flex items-center justify-between gap-3">
				<div>
					<p className="text-sm font-medium">Required</p>
					<p className="text-xs text-muted-foreground">
						{question.required
							? "The buyer can't check out without answering."
							: "The buyer can skip it."}
					</p>
				</div>
				<ToggleSwitch
					on={question.required}
					onChange={(required) => onPatch({ required })}
					label={`Question ${index + 1} is required`}
				/>
			</div>

			{index > 0 ? (
				<div className="flex flex-col gap-1.5">
					<label
						htmlFor={`bq-when-${question.id}`}
						className="text-sm font-medium"
					>
						Show only when
					</label>
					{triggers.length === 0 ? (
						<p className="text-xs text-muted-foreground">
							Always shown. To ask this only after a certain answer, put a
							"Pick one" question with options above it.
						</p>
					) : (
						<div className="grid gap-2 sm:grid-cols-2">
							<select
								id={`bq-when-${question.id}`}
								className={SELECT_CLASS}
								value={question.showWhenId}
								onChange={(e) =>
									onPatch({ showWhenId: e.target.value, showWhenOption: "" })
								}
							>
								<option value="">Always show</option>
								{triggers.map((t) => (
									<option key={t.id} value={t.id}>
										{t.label.trim() || `Question ${earlier.indexOf(t) + 1}`}
									</option>
								))}
							</select>
							{trigger ? (
								<select
									aria-label="…is answered with"
									className={SELECT_CLASS}
									value={question.showWhenOption}
									onChange={(e) => onPatch({ showWhenOption: e.target.value })}
								>
									<option value="">Pick the answer…</option>
									{trigger.options.map((o) => (
										<option key={o} value={o}>
											is “{o}”
										</option>
									))}
								</select>
							) : null}
						</div>
					)}
					{trigger && !question.showWhenOption ? (
						<p className="text-xs text-amber-700 dark:text-amber-400">
							Pick the answer that shows this question — until then it's always
							shown.
						</p>
					) : null}
				</div>
			) : null}
		</fieldset>
	);
}
