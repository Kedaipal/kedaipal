import { defineApp } from "convex/server";
import actionRetrier from "@convex-dev/action-retrier/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";

const app = defineApp();
app.use(rateLimiter);
app.use(actionRetrier);

export default app;
