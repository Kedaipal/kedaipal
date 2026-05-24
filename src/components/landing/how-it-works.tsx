import { useNavigate, useSearch } from "@tanstack/react-router";
import { Bell, MessageCircle, ShoppingCart, Store } from "lucide-react";
import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";

function getHowStepDetails() {
	return [
		{
			heading: m.how_detail_1_heading(),
			description: m.how_detail_1_desc(),
			preview: (
				<div className="space-y-2 rounded-xl bg-[#ECE5DD] p-4">
					<div className="max-w-[85%] self-start rounded-xl rounded-tl-sm bg-white px-3 py-2 text-xs text-slate-800 shadow-sm">
						{m.how_detail_1_chat_1()}
					</div>
					<div className="flex justify-end">
						<div className="max-w-[85%] rounded-xl rounded-tr-sm bg-[#DCF8C6] px-3 py-2 text-xs text-slate-800 shadow-sm">
							{m.how_detail_1_chat_2()}
						</div>
					</div>
				</div>
			),
		},
		{
			heading: m.how_detail_2_heading(),
			description: m.how_detail_2_desc(),
			preview: (
				<div className="space-y-3 rounded-xl border border-border bg-card p-4">
					<div className="flex items-center gap-3 border-b border-border pb-3">
						<div className="flex size-9 items-center justify-center rounded-lg bg-accent/10">
							<Store className="size-4 text-accent" />
						</div>
						<div>
							<p className="text-sm font-semibold">
								{m.how_detail_2_store_name()}
							</p>
							<p className="text-xs text-muted-foreground">
								{m.how_detail_2_store_url()}
							</p>
						</div>
					</div>
					<div className="grid grid-cols-2 gap-2">
						{[m.how_detail_2_product_1(), m.how_detail_2_product_2()].map(
							(item) => (
								<div
									key={item}
									className="rounded-lg border border-border bg-muted/40 p-2"
								>
									<div className="mb-1.5 h-12 rounded bg-accent/10" />
									<p className="text-[11px] font-medium leading-tight">
										{item}
									</p>
								</div>
							),
						)}
					</div>
				</div>
			),
		},
		{
			heading: m.how_detail_3_heading(),
			description: m.how_detail_3_desc(),
			preview: (
				<div className="space-y-2 rounded-xl bg-[#ECE5DD] p-4">
					<div className="flex justify-end">
						<div className="max-w-[90%] rounded-xl rounded-tr-sm bg-[#DCF8C6] px-3 py-2 shadow-sm">
							<p className="text-[11px] font-bold text-slate-800">
								{m.how_detail_3_order_id()}
							</p>
							<div className="mt-1 space-y-0.5 text-[10px] text-slate-700">
								<p>• {m.how_detail_3_item()}</p>
								<p>• {m.how_detail_3_total()}</p>
								<p>• {m.how_detail_3_payment()}</p>
							</div>
						</div>
					</div>
					<div className="max-w-[85%] rounded-xl rounded-tl-sm bg-white px-3 py-2 text-xs text-slate-800 shadow-sm">
						{m.how_detail_3_confirm()}
					</div>
				</div>
			),
		},
		{
			heading: m.how_detail_4_heading(),
			description: m.how_detail_4_desc(),
			preview: (
				<div className="space-y-2 rounded-xl bg-[#ECE5DD] p-4">
					{[
						{ label: m.how_detail_4_status_1(), emoji: "✅", time: "2:14 PM" },
						{ label: m.how_detail_4_status_2(), emoji: "📦", time: "4:30 PM" },
						{ label: m.how_detail_4_status_3(), emoji: "🚚", time: "9:05 AM" },
					].map((msg) => (
						<div key={msg.label} className="flex items-start gap-2">
							<div className="max-w-[85%] rounded-xl rounded-tl-sm bg-white px-3 py-2 shadow-sm">
								<p className="text-[11px] font-semibold text-slate-800">
									{msg.emoji} {msg.label}
								</p>
								<p className="mt-0.5 text-[10px] text-slate-500">{msg.time}</p>
							</div>
						</div>
					))}
				</div>
			),
		},
	];
}

export function HowItWorks() {
	const { step } = useSearch({ from: "/" });
	const navigate = useNavigate({ from: "/" });
	const activeStep = step ?? 1;
	const howStepDetails = getHowStepDetails();

	const steps = [
		{ icon: MessageCircle, title: m.how_1_title(), body: m.how_1_body() },
		{ icon: Store, title: m.how_2_title(), body: m.how_2_body() },
		{ icon: ShoppingCart, title: m.how_3_title(), body: m.how_3_body() },
		{ icon: Bell, title: m.how_4_title(), body: m.how_4_body() },
	];

	function handleStepClick(stepNum: number) {
		navigate({
			search: (prev) => ({
				...prev,
				step: activeStep === stepNum ? undefined : stepNum,
			}),
			replace: true,
			resetScroll: false,
		});
	}

	return (
		<section
			id="how"
			aria-labelledby="how-heading"
			className="border-b border-border/60"
		>
			<div className="mx-auto max-w-6xl px-5 py-24 md:px-8 md:py-32">
				<div className="mx-auto max-w-2xl text-center">
					<p className="text-xs font-semibold uppercase tracking-widest text-accent">
						{m.how_label()}
					</p>
					<h2
						id="how-heading"
						className="mt-3 text-3xl font-bold md:text-5xl"
						style={{ letterSpacing: "-0.02em" }}
					>
						{m.how_heading()}
					</h2>
					<p className="mt-4 text-base leading-relaxed text-muted-foreground md:text-lg">
						{m.how_sub()}
					</p>
				</div>
				<div className="mt-16 grid gap-4 md:grid-cols-4">
					{steps.map((s, i) => {
						const stepNum = i + 1;
						const isActive = activeStep === stepNum;
						return (
							<button
								key={s.title}
								type="button"
								onClick={() => handleStepClick(stepNum)}
								aria-pressed={isActive}
								aria-label={`Step ${stepNum}: ${s.title}`}
								className={cn(
									"relative flex h-full w-full flex-col rounded-2xl border p-5 text-left transition-all duration-200",
									"hover:border-accent/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
									isActive
										? "border-accent bg-accent/5 shadow-[0_0_0_3px_hsl(160_84%_39%_/_0.12)] shadow-md"
										: "border-border bg-card shadow-sm",
								)}
							>
								<div
									className={cn(
										"flex size-12 items-center justify-center rounded-xl transition-colors",
										isActive
											? "bg-accent text-accent-foreground"
											: "bg-accent/10 text-accent",
									)}
								>
									<s.icon className="size-6" />
								</div>
								<div className="mt-4 flex items-center gap-2">
									<span
										className={cn(
											"text-xs font-bold",
											isActive ? "text-accent" : "text-muted-foreground",
										)}
									>
										0{stepNum}
									</span>
									<div
										className={cn(
											"h-px flex-1",
											isActive ? "bg-accent/40" : "bg-border",
										)}
									/>
								</div>
								<h3 className="mt-3 text-lg font-semibold">{s.title}</h3>
								<p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
								{isActive && (
									<div className="absolute bottom-3 right-3 size-2 rounded-full bg-accent" />
								)}
							</button>
						);
					})}
				</div>

				{activeStep !== null && howStepDetails[activeStep - 1] && (
					<div className="mt-6 overflow-hidden rounded-2xl border border-accent/20 bg-card shadow-md">
						<div className="grid gap-0 md:grid-cols-2">
							<div className="flex flex-col justify-center gap-4 border-l-4 border-accent/40 p-8">
								<span className="text-xs font-bold uppercase tracking-widest text-accent">
									Step {activeStep} of 4
								</span>
								<h3
									className="text-2xl font-bold"
									style={{ letterSpacing: "-0.02em" }}
								>
									{howStepDetails[activeStep - 1].heading}
								</h3>
								<p className="text-base leading-relaxed text-muted-foreground">
									{howStepDetails[activeStep - 1].description}
								</p>
							</div>
							<div className="flex items-center justify-center border-t border-border/60 bg-muted/20 p-8 md:border-l md:border-t-0">
								{howStepDetails[activeStep - 1].preview}
							</div>
						</div>
					</div>
				)}
			</div>
		</section>
	);
}
