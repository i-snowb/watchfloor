import application from "./dist/server/index.js";
import { deleteExpiredSandboxSessions } from "./server/public-retention.mjs";

const publicWorker = {
  fetch(request, environment, context) {
    return application.fetch(request, environment, context);
  },
  scheduled(_controller, environment, context) {
    context.waitUntil(
      deleteExpiredSandboxSessions(environment.DB)
        .then(() => {
          console.log(
            JSON.stringify({
              event: "sandbox_retention_sweep",
              outcome: "completed",
            }),
          );
        })
        .catch(() => {
          console.error(
            JSON.stringify({
              event: "sandbox_retention_sweep",
              outcome: "failed",
            }),
          );
          throw new Error("Public sandbox retention sweep failed.");
        }),
    );
  },
};

export default publicWorker;
