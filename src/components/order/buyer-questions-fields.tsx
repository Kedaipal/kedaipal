// The buyer's side of buyer questions (`z8r3fdkjek`) — ONE control for every
// door that asks them: the RSVP form, the cart checkout (one block per line)
// and the seller keying a walk-in's answers at the counter. One idea, one
// control: the same pills and the same text box wherever the question is
// asked, so the seller's counter and the buyer's phone read alike.
//
// Visibility is the lib's (`visibleQuestions`), so what this renders and what
// the server accepts can never disagree: a conditional question mounts only
// once its trigger option is picked, and a hidden answer is never sent.
//
// Lives in `components/order/` (beside `OrderItemLine`) rather than
// `storefront/` because the seller dashboard renders it too.

import {
	type AnswersById,
	type BuyerQuestion,
	MAX_ANSWER_LENGTH,
	visibleQuestions,
} from "../../../convex/lib/buyerQuestions";
import { Input } from "../ui/input";

export interface BuyerQuestionsFieldsProps {
	questions: readonly BuyerQuestion[];
	answers: AnswersById;
	/** `undefined` clears the answer. */
	onChange: (questionId: string, answer: string | undefined) => void;
	/** Unique per rendered block — a cart can carry two lines that each ask
	 * a question with the same id space. */
	idPrefix: string;
	disabled?: boolean;
}

export function BuyerQuestionsFields({
	questions,
	answers,
	onChange,
	idPrefix,
	disabled,
}: BuyerQuestionsFieldsProps) {
	const visible = visibleQuestions(questions, answers);

	function pick(question: BuyerQuestion, option: string) {
		const next = answers[question.id] === option ? undefined : option;
		onChange(question.id, next);
		// Changing a trigger clears answers to questions it no longer shows,
		// so a stale tent model can't sit in state looking answered.
		for (const dependent of questions) {
			if (
				dependent.showWhen?.questionId === question.id &&
				dependent.showWhen.option !== next &&
				answers[dependent.id] !== undefined
			)
				onChange(dependent.id, undefined);
		}
	}

	return (
		<div className="flex flex-col gap-4">
			{visible.map((question) => {
				const fieldId = `${idPrefix}-${question.id}`;
				const optionalSuffix =
					question.required === true ? null : (
						<span className="font-normal text-muted-foreground"> (optional)</span>
					);
				if (question.type === "choice") {
					return (
						<fieldset key={question.id} className="min-w-0">
							<legend className="mb-1.5 text-sm font-medium">
								{question.label}
								{optionalSuffix}
							</legend>
							<div className="flex flex-wrap gap-2">
								{(question.options ?? []).map((option) => {
									const selected = answers[question.id] === option;
									return (
										<button
											key={option}
											type="button"
											disabled={disabled}
											aria-pressed={selected}
											onClick={() => pick(question, option)}
											className={`min-h-11 rounded-xl border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
												selected
													? "border-accent bg-accent text-accent-foreground"
													: "border-border bg-background hover:border-accent"
											}`}
										>
											{option}
										</button>
									);
								})}
							</div>
						</fieldset>
					);
				}
				const value = answers[question.id] ?? "";
				return (
					<div key={question.id} className="flex flex-col gap-1.5">
						<label htmlFor={fieldId} className="text-sm font-medium">
							{question.label}
							{optionalSuffix}
						</label>
						<Input
							id={fieldId}
							variant="field"
							value={value}
							disabled={disabled}
							maxLength={MAX_ANSWER_LENGTH}
							onChange={(e) =>
								onChange(
									question.id,
									e.target.value.length > 0 ? e.target.value : undefined,
								)
							}
						/>
						{value.length > MAX_ANSWER_LENGTH - 20 ? (
							<p className="text-right text-xs tabular-nums text-muted-foreground">
								{value.length}/{MAX_ANSWER_LENGTH}
							</p>
						) : null}
					</div>
				);
			})}
		</div>
	);
}
