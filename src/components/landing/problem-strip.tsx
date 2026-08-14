import { m } from "../../paraglide/messages";
import { FadeIn } from "./fade-in";
import { carouselSlideClass, carouselTrackClass } from "./landing-ui";

/** Decorative pile of "buried" chats — the pain made visible. */
function BuriedChats() {
	const chats = [
		{ text: m.problem_chat_1(), time: "Mon 9:14 AM", faded: true },
		{ text: m.problem_chat_2(), time: "Mon 11:02 AM", faded: true },
		{ text: m.problem_chat_3(), time: "Tue 8:40 PM", faded: false },
		{ text: m.problem_chat_4(), time: "Thu 7:15 AM", faded: false },
	];
	return (
		<div aria-hidden className="relative mx-auto w-full max-w-xs select-none">
			{chats.map((chat, i) => (
				<div
					key={chat.text}
					className="mb-2 rounded-2xl rounded-tl-sm bg-white px-4 py-2.5 shadow-lg"
					style={{
						opacity: chat.faded ? 0.3 : 0.95 - i * 0.05,
						transform: `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg) translateX(${i % 2 === 0 ? -6 : 6}px)`,
					}}
				>
					<p className="text-sm font-medium text-slate-800">{chat.text}</p>
					<p className="mt-0.5 text-[10px] text-slate-500">{chat.time}</p>
				</div>
			))}
			<div className="absolute -bottom-3 -right-2 rotate-3 rounded-lg bg-destructive px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-destructive-foreground shadow-lg">
				{m.problem_chat_unread()}
			</div>
		</div>
	);
}

export function ProblemStrip() {
	const problems = [
		{ title: m.problem_1_title(), body: m.problem_1_body() },
		{ title: m.problem_2_title(), body: m.problem_2_body() },
		{ title: m.problem_3_title(), body: m.problem_3_body() },
	];

	return (
		<section
			aria-labelledby="problem-heading"
			className="bg-cta-mesh text-cta-mesh-foreground"
		>
			<div className="mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-32">
				<div className="grid items-center gap-12 md:grid-cols-[1.2fr_0.8fr] md:gap-16">
					<FadeIn>
						<h2
							id="problem-heading"
							className="text-3xl font-bold leading-[1.1] md:text-5xl"
							style={{ letterSpacing: "-0.02em" }}
						>
							{m.problem_heading()}
						</h2>
					</FadeIn>
					<FadeIn delay={0.15}>
						<BuriedChats />
					</FadeIn>
				</div>

				{/* Mobile: snap carousel of individually-bordered cards. md+: the
				    original joined grid (parent border + gap-px showing the hairline
				    ground through), so each card sheds its own border there. */}
				<FadeIn className="mt-16 md:mt-20">
					<div
						className={carouselTrackClass(
							"md:grid md:grid-cols-3 md:gap-px md:overflow-hidden md:rounded-3xl md:border md:border-white/10 md:bg-white/10",
						)}
					>
						{problems.map((p, i) => (
							<div key={p.title} className={carouselSlideClass("h-full")}>
								<div className="relative h-full overflow-hidden rounded-3xl border border-white/10 bg-primary p-7 text-primary-foreground md:rounded-none md:border-0 md:p-9">
									<span className="text-5xl font-black leading-none text-destructive/80 md:text-6xl">
										{String(i + 1).padStart(2, "0")}
									</span>
									<h3 className="mt-4 text-lg font-bold md:text-xl">
										{p.title}
									</h3>
									<p className="mt-3 text-sm leading-relaxed text-primary-foreground/60">
										{p.body}
									</p>
								</div>
							</div>
						))}
					</div>
				</FadeIn>
			</div>
		</section>
	);
}
