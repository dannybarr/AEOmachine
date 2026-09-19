import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertCircle, RefreshCw } from "lucide-react";

interface DiscoveryScanTriggerProps {
  isIdle: boolean;
  isRunning: boolean;
  isFailed: boolean;
  phase?: string;
  progress: number;
  error?: string;
  onStart: () => void;
  disabled: boolean;
}

function phaseText(phase?: string) {
  switch (phase) {
    case "crawling":
      return "Reading public pages";
    case "researching":
      return "Checking public context";
    case "analyzing":
      return "Shaping audience questions";
    case "saving":
      return "Saving recommendations";
    case "done":
      return "Discovery complete";
    default:
      return "Preparing website scan";
  }
}

export function DiscoveryScanTrigger({
  isIdle,
  isRunning,
  isFailed,
  phase,
  progress,
  error,
  onStart,
  disabled,
}: DiscoveryScanTriggerProps) {
  const shouldReduceMotion = useReducedMotion();
  const boundedProgress = Math.max(4, Math.min(100, progress));

  return (
    <div className="flex min-h-14 w-full items-center sm:w-[336px] sm:justify-end">
      <AnimatePresence initial={false} mode="wait">
        {isIdle && (
          <motion.button
            key="idle"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
            onClick={onStart}
            disabled={disabled}
            className="group relative flex h-14 w-full items-center overflow-hidden rounded-full bg-white text-left shadow-[0_12px_32px_rgba(36,20,13,0.18)] ring-1 ring-white/70 transition-transform duration-300 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush focus-visible:ring-offset-2 focus-visible:ring-offset-sienna disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
            data-testid="button-rescan-website"
          >
            <span className="absolute inset-y-0 left-0 w-[58%] bg-gradient-to-r from-blush/70 via-blush/35 to-transparent opacity-70 transition-all duration-500 group-hover:w-[72%] group-hover:opacity-100" />
            <span className="relative z-10 flex w-full items-center justify-between px-5">
              <span className="flex min-w-0 items-center gap-3">
                <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sienna text-white shadow-sm">
                  <RefreshCw className="h-3.5 w-3.5 transition-transform duration-500 group-hover:rotate-90" />
                  <span className="absolute -inset-1 -z-10 rounded-full bg-sienna/15 blur-md" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-sienna/60">
                    Discovery
                  </span>
                  <span className="truncate text-[13px] font-semibold text-ink">
                    Regenerate questions
                  </span>
                </span>
              </span>
              <span className="ml-4 shrink-0 text-[11px] font-bold uppercase tracking-[0.14em] text-sienna">
                Run
              </span>
            </span>
          </motion.button>
        )}

        {isRunning && (
          <motion.div
            key="running"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
            className="relative flex h-14 w-full items-center overflow-hidden rounded-full bg-white shadow-[0_12px_32px_rgba(36,20,13,0.18)] ring-1 ring-white/70"
            data-testid="status-assessment"
            role="progressbar"
            aria-label={phaseText(phase)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(boundedProgress)}
            aria-live="polite"
          >
            <motion.div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-blush/45 via-blush/75 to-[#f1b493]/70"
              initial={false}
              animate={{ width: `${boundedProgress}%` }}
              transition={{ ease: [0.22, 0.68, 0, 1], duration: 0.7 }}
            >
              <div className="absolute right-0 top-1/2 h-20 w-8 -translate-y-1/2 translate-x-1/2">
                <motion.span
                  className="absolute left-1/2 top-[8%] h-7 w-2.5 -translate-x-1/2 rounded-[50%] bg-[#e79770] blur-[3px]"
                  animate={
                    shouldReduceMotion
                      ? undefined
                      : { x: [-2, 2, -1, -2], scaleY: [0.8, 1.15, 0.9, 0.8] }
                  }
                  transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                />
                <motion.span
                  className="absolute left-1/2 top-[35%] h-9 w-3 -translate-x-1/2 rounded-[48%] bg-sienna/90 blur-[3.5px]"
                  animate={
                    shouldReduceMotion
                      ? undefined
                      : { x: [2, -2, 1, 2], scaleY: [1.15, 0.82, 1, 1.15] }
                  }
                  transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                />
                <motion.span
                  className="absolute bottom-[6%] left-1/2 h-7 w-2 -translate-x-1/2 rounded-[45%] bg-[#c56d48] blur-[2.5px]"
                  animate={
                    shouldReduceMotion
                      ? undefined
                      : { x: [-1, 2, -2, -1], scaleY: [0.9, 1.25, 0.85, 0.9] }
                  }
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                />
                <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-sienna/70 shadow-[0_0_9px_3px_rgba(93,42,26,0.28)]" />
              </div>
            </motion.div>

            <div className="relative z-10 flex w-full items-center justify-between gap-4 px-5">
              <span className="flex min-w-0 flex-col">
                <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-sienna/60">
                  Website discovery
                </span>
                <span className="truncate text-[13px] font-semibold text-ink">
                  {phaseText(phase)}
                </span>
              </span>
              <span className="shrink-0 font-serif text-[22px] font-normal tabular-nums text-sienna">
                {Math.round(boundedProgress)}%
              </span>
            </div>
          </motion.div>
        )}

        {isFailed && (
          <motion.div
            key="failed"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
            className="relative flex h-14 w-full items-center overflow-hidden rounded-full bg-[#fff7f4] shadow-[0_12px_32px_rgba(36,20,13,0.18)] ring-1 ring-white/80"
            data-testid="status-assessment"
            role="alert"
          >
            <div className="relative z-10 flex w-full items-center justify-between gap-3 pl-2 pr-3">
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f4d7cf] text-[#7f2d21]">
                  <AlertCircle className="h-4 w-4" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#9b4a3a]">
                    Discovery paused
                  </span>
                  <span
                    className="max-w-[168px] truncate text-[12px] font-medium text-[#6f2c20]"
                    title={error || "The scan could not finish"}
                  >
                    {error || "The scan could not finish"}
                  </span>
                </span>
              </span>
              <button
                onClick={onStart}
                className="shrink-0 rounded-full bg-[#7f2d21] px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-white shadow-sm transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white active:scale-95"
                data-testid="button-retry-assessment"
              >
                Retry
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface DiscoveryEmptyStateProps extends DiscoveryScanTriggerProps {
  hasFailed: boolean;
}

const discoverySteps = [
  {
    number: "01",
    title: "Read the website",
    detail: "Products, proof and market language",
  },
  {
    number: "02",
    title: "Map the audience",
    detail: "Buyers, influencers and positioning",
  },
  {
    number: "03",
    title: "Shape the questions",
    detail: "Money topics worth tracking",
  },
];

export function DiscoveryEmptyState({
  hasFailed,
  isIdle,
  isRunning,
  isFailed,
  phase,
  progress,
  error,
  onStart,
  disabled,
}: DiscoveryEmptyStateProps) {
  const activeStep = isRunning ? (progress < 56 ? 0 : progress < 80 ? 1 : 2) : -1;

  return (
    <section
      className="overflow-hidden rounded-[24px] border border-border bg-paper shadow-sm"
      data-testid="status-recommendations-empty"
    >
      <div className="grid min-h-[330px] lg:grid-cols-[1.18fr_0.82fr]">
        <div className="flex flex-col justify-between p-7 sm:p-10">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-sienna/65">
              Website-led discovery
            </span>
            <h3 className="mt-4 max-w-xl font-serif text-[28px] font-normal leading-[1.08] tracking-tight text-ink sm:text-[34px]">
              {isRunning
                ? "Reading the market behind the website."
                : hasFailed
                  ? "The last scan stopped before the questions were ready."
                  : "Turn the website into questions your audience would ask."}
            </h3>
            <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-slate-quiet">
              {isRunning
                ? "Discovery is interpreting the offer, audience and commercial context now. The first recommendations will appear here when the scan completes."
                : hasFailed
                  ? "Your existing data is safe. Retry the scan to rebuild the audience context and suggested money topics."
                  : "Discovery reads public pages to understand what the company sells, who it serves and which commercially meaningful questions belong in tracking."}
            </p>
          </div>

          <div className="mt-8 max-w-[336px]">
            <DiscoveryScanTrigger
              isIdle={isIdle}
              isRunning={isRunning}
              isFailed={isFailed}
              phase={phase}
              progress={progress}
              error={error}
              onStart={onStart}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="border-t border-border bg-fog/70 p-7 sm:p-9 lg:border-l lg:border-t-0">
          <p className="mb-7 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-quiet">
            From source to strategy
          </p>
          <div className="space-y-2">
            {discoverySteps.map((step, index) => {
              const isActive = activeStep === index;
              const isComplete = isRunning && activeStep > index;
              return (
                <div
                  key={step.number}
                  className={`rounded-[16px] border px-4 py-4 transition-colors duration-500 ${
                    isActive
                      ? "border-sienna/20 bg-white shadow-sm"
                      : isComplete
                        ? "border-transparent bg-blush/20"
                        : "border-transparent"
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <span
                      className={`mt-0.5 font-serif text-[17px] tabular-nums transition-colors ${
                        isActive || isComplete ? "text-sienna" : "text-smoke"
                      }`}
                    >
                      {step.number}
                    </span>
                    <span>
                      <span className="block text-[13px] font-semibold text-ink">{step.title}</span>
                      <span className="mt-1 block text-[11.5px] leading-relaxed text-slate-quiet">
                        {step.detail}
                      </span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}