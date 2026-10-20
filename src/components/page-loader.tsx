import { motion } from "framer-motion";
import { Wordmark } from "./ui/wordmark";

export function PageLoader() {
	return (
		<div className="flex min-h-dvh items-center justify-center bg-background">
			<motion.div
				className="h-10"
				animate={{ scale: [0.9, 1.1, 0.9] }}
				transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
			>
				<Wordmark aspect="h-10 w-auto" priority />
			</motion.div>
		</div>
	);
}
