import app from "./app";
import { logger } from "./lib/logger";
import { startDailyTrackingScheduler } from "./lib/scheduler";
import { validateRegistry } from "./lib/modelRegistry";
import { startEntityExtractionWorker } from "./lib/entityExtraction";

const rawPort = process.env["PORT"] ?? "3000";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  // Validate the model registry against Requesty before any scheduled runs;
  // unknown ids become visibly unavailable, never silent fallbacks.
  void validateRegistry().finally(() => {
    startEntityExtractionWorker();
    startDailyTrackingScheduler();
  });
});
