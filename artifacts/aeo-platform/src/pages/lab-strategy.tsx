import { useState } from "react";
import { Link, useParams } from "wouter";
import {
  useGetCompanyPlaybook,
  useCreateMoneyTopic,
  useDeleteMoneyTopic,
  useCreateWeeklyMeasurement,
  useDeleteWeeklyMeasurement,
  useCreateTopicPrompt,
  useAttachPromptToTopic,
  useDetachPromptFromTopic,
  useListPrompts,
  getListPromptsQueryKey,
  getGetCompanyPlaybookQueryKey,
  type CompanyPlaybook,
  type PlaybookMoneyTopic,
  type PlaybookSuggestedWeek,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Plus,
  Trash,
  Coins,
  Radar,
  Hammer,
  Megaphone,
  LineChart,
  Sparkles,
  MessageSquare,
  ExternalLink,
  Link2,
  Unlink,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { DeployIdeaDialog } from "@/components/strategy/DeployIdeaDialog";
import { StrategyItemsList } from "@/components/strategy/StrategyItemsList";

const TOPIC_PRIORITIES = [
  { value: "very_high", label: "Very high" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
] as const;

const TOPIC_PRIORITY_STYLES: Record<string, string> = {
  very_high: "bg-[var(--negative-surface)] text-negative",
  high: "bg-[var(--warning-surface)] text-warning",
  medium: "bg-mist text-foreground",
  low: "bg-mist text-slate-quiet",
};

export default function LabStrategy() {
  const params = useParams<{ companyId: string }>();
  const companyId = parseInt(params.companyId ?? "0", 10);

  const { data: playbook, isLoading } = useGetCompanyPlaybook(companyId);

  if (isLoading || !playbook) {
    return (
      <div className="p-4 sm:p-8 max-w-[1100px] mx-auto text-center text-[13px] text-slate-quiet">
        {isLoading ? "Loading playbook..." : "Playbook not found."}
      </div>
    );
  }

  const liveCount = [...playbook.onsiteItems, ...playbook.offsiteItems].filter(
    (i) => i.status === "live",
  ).length;

  return (
    <div className="p-4 sm:p-8 max-w-[1100px] mx-auto space-y-6 m1-stagger visible">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Link
            href="/lab"
            className="text-[12px] text-slate-quiet hover:text-foreground flex items-center gap-1 mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Site Lab
          </Link>
          <h1 className="steep-heading text-2xl tracking-tight">
            {playbook.company.name} — AEO Playbook
          </h1>
          <p className="text-[13px] text-slate-quiet mt-1">
            The 5-step strategy program: research, track, build onsite, build
            offsite, measure.
          </p>
        </div>
        <div className="flex items-center gap-6 text-right">
          <Stat label="Money topics" value={playbook.moneyTopics.length} />
          <Stat
            label="Deployed plays"
            value={playbook.onsiteItems.length + playbook.offsiteItems.length}
          />
          <Stat label="Live" value={liveCount} />
        </div>
      </div>

      <StepMoneyTopics playbook={playbook} companyId={companyId} />
      <StepTracking playbook={playbook} />
      <StepBuild
        step={3}
        icon={Hammer}
        title="Onsite Build"
        subtitle="Answer-first pages, comparisons, tools and data assets on the client's own domain."
        category="on_page"
        companyId={companyId}
        count={playbook.onsiteItems.length}
        liveCount={playbook.onsiteItems.filter((i) => i.status === "live").length}
        uncoveredTopics={playbook.moneyTopics
          .filter((t) => t.strategy.total === 0)
          .map((t) => t.topic)}
      />
      <StepBuild
        step={4}
        icon={Megaphone}
        title="Offsite Build"
        subtitle="Earned media, partnerships, podcasts, communities and profile hygiene off-domain."
        category="off_page"
        companyId={companyId}
        count={playbook.offsiteItems.length}
        liveCount={playbook.offsiteItems.filter((i) => i.status === "live").length}
        uncoveredTopics={playbook.moneyTopics
          .filter((t) => t.strategy.total === 0)
          .map((t) => t.topic)}
      />
      <StepMeasurement playbook={playbook} companyId={companyId} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[10px] font-medium text-ash uppercase tracking-wider mb-0.5">
        {label}
      </div>
      <div className="text-xl font-medium tracking-tight text-foreground tabular-nums">
        {value}
      </div>
    </div>
  );
}

function StepShell({
  step,
  icon: Icon,
  title,
  subtitle,
  progress,
  actions,
  children,
}: {
  step: number;
  icon: typeof Coins;
  title: string;
  subtitle: string;
  progress: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="m1-card overflow-hidden">
      <div className="p-5 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-fog">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-foreground text-background flex items-center justify-center text-[13px] font-medium shrink-0">
            {step}
          </div>
          <div>
            <h2 className="steep-heading text-[15px] flex items-center gap-2">
              <Icon className="w-4 h-4" /> {title}
            </h2>
            <p className="text-[12px] text-slate-quiet mt-0.5">
              {subtitle}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[11px] font-medium text-ash uppercase tracking-wider">
            {progress}
          </span>
          {actions}
        </div>
      </div>
      {children}
    </section>
  );
}

// ─── Step 1: Money topics ───

function StepMoneyTopics({
  playbook,
  companyId,
}: {
  playbook: CompanyPlaybook;
  companyId: number;
}) {
  const [topic, setTopic] = useState("");
  const [question, setQuestion] = useState("");
  const [priority, setPriority] =
    useState<(typeof TOPIC_PRIORITIES)[number]["value"]>("high");

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: getGetCompanyPlaybookQueryKey(companyId),
    });

  const create = useCreateMoneyTopic({
    mutation: {
      onSuccess: () => {
        invalidate();
        setTopic("");
        setQuestion("");
        toast({ title: "Money topic captured" });
      },
      onError: () =>
        toast({ title: "Could not add topic", variant: "destructive" }),
    },
  });
  const del = useDeleteMoneyTopic({ mutation: { onSuccess: invalidate } });

  const trackedPromptCount = playbook.moneyTopics.reduce(
    (n, t) => n + t.prompts.length,
    0,
  );

  return (
    <StepShell
      step={1}
      icon={Coins}
      title="Prompt Research — Money Topics"
      subtitle="Define money topics, then add real tracked prompts — they appear in All Prompts instantly."
      progress={`${playbook.moneyTopics.length} topics · ${trackedPromptCount} tracked prompts`}
      actions={
        <Link href="/prompts" className="m1-btn m1-btn--outline">
          All Prompts <ArrowRight className="w-3.5 h-3.5 ml-1" />
        </Link>
      }
    >
      <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-2">
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Money topic (e.g. best X for Y)"
          className="flex-1 rounded-lg border border-input bg-background placeholder:text-smoke disabled:text-smoke px-3 py-2 text-[13px]"
        />
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Example buyer question (optional)"
          className="flex-1 rounded-lg border border-input bg-background placeholder:text-smoke disabled:text-smoke px-3 py-2 text-[13px]"
        />
        <select
          value={priority}
          onChange={(e) =>
            setPriority(e.target.value as typeof priority)
          }
          className="rounded-lg border border-input bg-background placeholder:text-smoke disabled:text-smoke px-3 py-2 text-[13px]"
        >
          {TOPIC_PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <button
          className="m1-btn"
          disabled={!topic.trim() || create.isPending}
          onClick={() =>
            create.mutate({
              id: companyId,
              data: {
                topic: topic.trim(),
                question: question.trim() || null,
                priority,
              },
            })
          }
        >
          <Plus className="w-4 h-4 mr-1" /> Add
        </button>
      </div>
      {playbook.moneyTopics.length === 0 ? (
        <div className="p-6 text-center text-[13px] text-slate-quiet">
          No money topics yet. Start with the questions buyers ask right before
          they spend money.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {playbook.moneyTopics.map((t) => (
            <MoneyTopicRow
              key={t.id}
              topic={t}
              companyId={companyId}
              onDelete={() => {
                if (
                  confirm(
                    "Remove this money topic? Linked prompts stay tracked in All Prompts.",
                  )
                )
                  del.mutate({ id: t.id });
              }}
            />
          ))}
        </div>
      )}
    </StepShell>
  );
}

function MoneyTopicRow({
  topic: t,
  companyId,
  onDelete,
}: {
  topic: PlaybookMoneyTopic;
  companyId: number;
  onDelete: () => void;
}) {
  const [promptText, setPromptText] = useState("");
  const [attachId, setAttachId] = useState("");

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: getGetCompanyPlaybookQueryKey(companyId),
    });
    queryClient.invalidateQueries({
      queryKey: getListPromptsQueryKey({ companyId }),
    });
  };

  // Existing tracked prompts not yet linked to any topic, for attaching.
  const { data: allPrompts } = useListPrompts(
    { companyId },
    { query: { queryKey: getListPromptsQueryKey({ companyId }) } },
  );
  const attachable = (allPrompts ?? []).filter((p) => p.moneyTopicId == null);

  const createPrompt = useCreateTopicPrompt({
    mutation: {
      onSuccess: () => {
        invalidate();
        setPromptText("");
        toast({ title: "Tracked prompt created — visible in All Prompts" });
      },
      onError: () =>
        toast({ title: "Could not create prompt", variant: "destructive" }),
    },
  });
  const attach = useAttachPromptToTopic({
    mutation: {
      onSuccess: () => {
        invalidate();
        setAttachId("");
        toast({ title: "Prompt linked to topic" });
      },
      onError: () =>
        toast({ title: "Could not link prompt", variant: "destructive" }),
    },
  });
  const detach = useDetachPromptFromTopic({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Prompt unlinked — still tracked in All Prompts" });
      },
      onError: () =>
        toast({ title: "Could not unlink prompt", variant: "destructive" }),
    },
  });

  return (
    <div className="p-4 space-y-3 hover:bg-fog transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-medium text-foreground">
              {t.topic}
            </span>
            <span
              className={cn(
                "text-[10px] font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wide",
                TOPIC_PRIORITY_STYLES[t.priority],
              )}
            >
              {t.priority.replace("_", " ")}
            </span>
            <span
              className={cn(
                "text-[10px] font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wide",
                t.strategy.total === 0
                  ? "bg-mist text-slate-quiet"
                  : t.strategy.live === t.strategy.total
                    ? "bg-[var(--positive-surface)] text-positive"
                    : "bg-[var(--warning-surface)] text-warning",
              )}
              title="Strategy plays linked to this topic (steps 3 & 4)"
            >
              {t.strategy.total === 0
                ? "No plays yet"
                : `${t.strategy.live}/${t.strategy.total} plays live`}
            </span>
          </div>
          {t.question && (
            <p className="text-[12px] text-slate-quiet mt-0.5">
              “{t.question}”
            </p>
          )}
        </div>
        <button
          onClick={onDelete}
          className="p-1.5 rounded-full hover:bg-[var(--negative-surface)] text-slate-quiet hover:text-negative transition-colors shrink-0"
        >
          <Trash className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Linked tracked prompts with live tracking state */}
      {t.prompts.length > 0 && (
        <div className="rounded-lg border border-border divide-y divide-border bg-background">
          {t.prompts.map((p) => (
            <div
              key={p.id}
              className="px-3 py-2 flex items-center justify-between gap-3"
            >
              <div className="min-w-0 flex items-center gap-2">
                <MessageSquare className="w-3.5 h-3.5 text-slate-quiet shrink-0" />
                <Link
                  href={`/prompts/${p.id}`}
                  className="text-[12px] font-medium text-foreground hover:underline truncate"
                >
                  {p.text}
                </Link>
              </div>
              <div className="flex items-center gap-3 shrink-0 text-[11px] text-slate-quiet tabular-nums">
                <span
                  className={cn(
                    "text-[10px] font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wide",
                    p.active
                      ? "bg-[var(--positive-surface)] text-positive"
                      : "bg-mist text-slate-quiet",
                  )}
                >
                  {p.active ? "Tracking" : "Paused"}
                </span>
                <span>{p.runCount} runs</span>
                <span className="font-medium text-foreground">
                  {p.lastVisibilityPct != null
                    ? `${p.lastVisibilityPct}% vis.`
                    : "no runs yet"}
                </span>
                <Link
                  href={`/prompts/${p.id}`}
                  className="p-1 rounded-full hover:bg-mist text-slate-quiet hover:text-foreground transition-colors"
                  title="Open prompt detail"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </Link>
                <button
                  onClick={() =>
                    detach.mutate({ id: t.id, promptId: p.id })
                  }
                  disabled={detach.isPending}
                  className="p-1 rounded-full hover:bg-[var(--negative-surface)] text-slate-quiet hover:text-negative transition-colors"
                  title="Unlink from topic (keeps the prompt tracked)"
                >
                  <Unlink className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add a new tracked prompt / attach an existing one */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 flex gap-2">
          <input
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            placeholder="Add a buyer prompt to track (e.g. what's the best…)"
            className="flex-1 rounded-lg border border-input bg-background placeholder:text-smoke disabled:text-smoke px-3 py-1.5 text-[12px]"
            onKeyDown={(e) => {
              if (e.key === "Enter" && promptText.trim().length >= 3)
                createPrompt.mutate({
                  id: t.id,
                  data: { text: promptText.trim() },
                });
            }}
          />
          <button
            className="m1-btn m1-btn--outline whitespace-nowrap"
            disabled={promptText.trim().length < 3 || createPrompt.isPending}
            onClick={() =>
              createPrompt.mutate({ id: t.id, data: { text: promptText.trim() } })
            }
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Track prompt
          </button>
        </div>
        {attachable.length > 0 && (
          <div className="flex gap-2">
            <select
              value={attachId}
              onChange={(e) => setAttachId(e.target.value)}
              className="rounded-lg border border-input bg-background placeholder:text-smoke disabled:text-smoke px-2 py-1.5 text-[12px] max-w-[240px]"
            >
              <option value="">Attach existing prompt…</option>
              {attachable.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.text.length > 60 ? `${p.text.slice(0, 60)}…` : p.text}
                </option>
              ))}
            </select>
            <button
              className="m1-btn m1-btn--outline whitespace-nowrap"
              disabled={!attachId || attach.isPending}
              onClick={() =>
                attach.mutate({
                  id: t.id,
                  data: { promptId: parseInt(attachId, 10) },
                })
              }
            >
              <Link2 className="w-3.5 h-3.5 mr-1" /> Link
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Step 2: Tracking setup ───

function StepTracking({ playbook }: { playbook: CompanyPlaybook }) {
  const { tracking } = playbook;
  return (
    <StepShell
      step={2}
      icon={Radar}
      title="Tracking Setup"
      subtitle="Live from platform prompt runs and citations — no manual totals."
      progress={`${tracking.activePromptCount} active prompts · ${tracking.citedDomainCount} cited domains`}
      actions={
        <Link href="/prompts" className="m1-btn m1-btn--outline">
          Manage prompts <ArrowRight className="w-3.5 h-3.5 ml-1" />
        </Link>
      }
    >
      <div className="grid grid-cols-1 min-[380px]:grid-cols-2 md:grid-cols-4 divide-y min-[380px]:divide-y-0 min-[380px]:divide-x divide-border border-b border-border">
        <TrackingCell label="Tracked prompts" value={tracking.promptCount} />
        <TrackingCell label="Active" value={tracking.activePromptCount} />
        <TrackingCell label="Runs (30d)" value={tracking.runCount} />
        <TrackingCell
          label="Last run"
          value={
            tracking.lastRunAt
              ? new Date(tracking.lastRunAt).toLocaleDateString()
              : "—"
          }
        />
      </div>
      {tracking.topDomains.length > 0 ? (
        <div className="p-4">
          <div className="text-[11px] font-medium text-ash uppercase tracking-wider mb-2">
            Top cited domains
          </div>
          <div className="flex flex-wrap gap-2">
            {tracking.topDomains.map((d) => (
              <span
                key={d.domain}
                className="text-[12px] px-2.5 py-1 rounded-full bg-mist text-foreground flex items-center gap-1.5"
              >
                {d.domain}
                <span className="text-[10px] font-medium text-slate-quiet tabular-nums">
                  ×{d.retrievals}
                </span>
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="p-6 text-center text-[13px] text-slate-quiet">
          No citation data yet — run tracked prompts to populate this step.
        </div>
      )}
    </StepShell>
  );
}

function TrackingCell({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="p-4">
      <div className="text-[10px] font-medium text-ash uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className="text-lg font-medium tracking-tight text-foreground tabular-nums">
        {value}
      </div>
    </div>
  );
}

// ─── Steps 3 & 4: Build ───

function StepBuild({
  step,
  icon,
  title,
  subtitle,
  category,
  companyId,
  count,
  liveCount,
  uncoveredTopics,
}: {
  step: number;
  icon: typeof Hammer;
  title: string;
  subtitle: string;
  category: "on_page" | "off_page";
  companyId: number;
  count: number;
  liveCount: number;
  uncoveredTopics: string[];
}) {
  return (
    <StepShell
      step={step}
      icon={icon}
      title={title}
      subtitle={subtitle}
      progress={`${count} deployed · ${liveCount} live`}
      actions={
        <DeployIdeaDialog
          companyId={companyId}
          category={category}
          triggerLabel="Deploy idea"
          triggerClassName="m1-btn--outline"
        />
      }
    >
      {uncoveredTopics.length > 0 && (
        <div className="px-4 py-2.5 border-b border-border bg-[var(--warning-surface)] text-[12px] text-warning flex items-center gap-2 flex-wrap">
          <span className="font-medium uppercase tracking-wide text-[10px]">
            No plays yet:
          </span>
          {uncoveredTopics.map((topic) => (
            <span
              key={topic}
              className="px-1.5 py-0.5 rounded-full bg-[var(--warning-surface)] font-medium"
            >
              {topic}
            </span>
          ))}
        </div>
      )}
      <StrategyItemsList companyId={companyId} category={category} />
    </StepShell>
  );
}

// ─── Step 5: Tracking & Measurement ───

function StepMeasurement({
  playbook,
  companyId,
}: {
  playbook: CompanyPlaybook;
  companyId: number;
}) {
  const suggested = playbook.suggestedWeek;
  const [weekOf, setWeekOf] = useState("");
  const [totalPrompts, setTotalPrompts] = useState("");
  const [brandMentions, setBrandMentions] = useState("");
  const [compAvg, setCompAvg] = useState("");
  const [sov, setSov] = useState("");
  const [topPageType, setTopPageType] = useState("");
  const [takeaway, setTakeaway] = useState("");

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: getGetCompanyPlaybookQueryKey(companyId),
    });

  const create = useCreateWeeklyMeasurement({
    mutation: {
      onSuccess: () => {
        invalidate();
        setWeekOf("");
        setTotalPrompts("");
        setBrandMentions("");
        setCompAvg("");
        setSov("");
        setTopPageType("");
        setTakeaway("");
        toast({ title: "Weekly measurement recorded" });
      },
      onError: () =>
        toast({ title: "Could not record measurement", variant: "destructive" }),
    },
  });
  const del = useDeleteWeeklyMeasurement({ mutation: { onSuccess: invalidate } });

  const applySuggestion = (s: PlaybookSuggestedWeek) => {
    setWeekOf(s.weekOf);
    setTotalPrompts(String(s.totalPrompts));
    setBrandMentions(String(s.brandMentions));
    setCompAvg(s.competitorMentionsAvg != null ? String(s.competitorMentionsAvg) : "");
    setSov(s.shareOfVoicePct != null ? String(s.shareOfVoicePct) : "");
    setTopPageType(s.topPageType ?? "");
  };

  return (
    <StepShell
      step={5}
      icon={LineChart}
      title="Tracking & Measurement"
      subtitle="Weekly rollup computed from platform runs and citations — log it to build the history."
      progress={`${playbook.measurements.length} weeks logged`}
      actions={
        <div className="flex items-center gap-2">
          <Link href="/progress" className="m1-btn m1-btn--outline">
            Progress <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </Link>
          {suggested && (
            <button
              className="m1-btn m1-btn--outline"
              onClick={() => applySuggestion(suggested)}
              title="Prefill this week's row from real run data"
            >
              <Sparkles className="w-4 h-4 mr-1" /> Use this week's data
            </button>
          )}
        </div>
      }
    >
      {suggested && (
        <div className="px-4 py-3 border-b border-border bg-fog flex flex-wrap items-center gap-x-6 gap-y-1 text-[12px]">
          <span className="text-[10px] font-medium text-ash uppercase tracking-wider">
            This week, live from runs
          </span>
          <span>
            Prompts <b className="tabular-nums">{suggested.totalPrompts}</b>
          </span>
          <span>
            Brand mentions <b className="tabular-nums">{suggested.brandMentions}</b>
          </span>
          <span>
            SoV{" "}
            <b className="tabular-nums">
              {suggested.shareOfVoicePct != null
                ? `${suggested.shareOfVoicePct}%`
                : "—"}
            </b>
          </span>
          <span>
            Comp. avg{" "}
            <b className="tabular-nums">
              {suggested.competitorMentionsAvg ?? "—"}
            </b>
          </span>
          <span>
            Top page type <b>{suggested.topPageType ?? "—"}</b>
          </span>
        </div>
      )}
      <div className="p-4 border-b border-border grid grid-cols-1 min-[420px]:grid-cols-2 md:grid-cols-7 gap-2 items-end">
        <Field label="Week of">
          <input
            type="date"
            value={weekOf}
            onChange={(e) => setWeekOf(e.target.value)}
            className="w-full rounded-lg border border-input bg-background placeholder:text-smoke disabled:text-smoke px-2 py-1.5 text-[12px]"
          />
        </Field>
        <Field label="Prompts">
          <input
            type="number"
            value={totalPrompts}
            onChange={(e) => setTotalPrompts(e.target.value)}
            className="w-full rounded-lg border border-input bg-background placeholder:text-smoke disabled:text-smoke px-2 py-1.5 text-[12px]"
          />
        </Field>
        <Field label="Brand mentions">
          <input
            type="number"
            value={brandMentions}
            onChange={(e) => setBrandMentions(e.target.value)}
            className="w-full rounded-lg border border-input bg-background placeholder:text-smoke disabled:text-smoke px-2 py-1.5 text-[12px]"
          />
        </Field>
        <Field label="Comp. avg">
          <input
            type="number"
            step="0.1"
            value={compAvg}
            onChange={(e) => setCompAvg(e.target.value)}
            className="w-full rounded-lg border border-input bg-background placeholder:text-smoke disabled:text-smoke px-2 py-1.5 text-[12px]"
          />
        </Field>
        <Field label="SoV %">
          <input
            type="number"
            step="0.1"
            value={sov}
            onChange={(e) => setSov(e.target.value)}
            className="w-full rounded-lg border border-input bg-background placeholder:text-smoke disabled:text-smoke px-2 py-1.5 text-[12px]"
          />
        </Field>
        <Field label="Top page type">
          <input
            value={topPageType}
            onChange={(e) => setTopPageType(e.target.value)}
            placeholder="e.g. corporate"
            className="w-full rounded-lg border border-input bg-background placeholder:text-smoke disabled:text-smoke px-2 py-1.5 text-[12px]"
          />
        </Field>
        <button
          className="m1-btn h-fit"
          disabled={!weekOf || create.isPending}
          onClick={() =>
            create.mutate({
              id: companyId,
              data: {
                weekOf,
                totalPrompts: totalPrompts ? parseInt(totalPrompts, 10) : 0,
                brandMentions: brandMentions ? parseInt(brandMentions, 10) : 0,
                competitorMentionsAvg: compAvg ? parseFloat(compAvg) : null,
                shareOfVoicePct: sov ? parseFloat(sov) : null,
                topPageType: topPageType.trim() || null,
                keyTakeaway: takeaway.trim() || null,
              },
            })
          }
        >
          <Plus className="w-4 h-4 mr-1" /> Log
        </button>
        <div className="col-span-2 md:col-span-7">
          <Field label="Key takeaway">
            <input
              value={takeaway}
              onChange={(e) => setTakeaway(e.target.value)}
              placeholder="One sentence on what moved and why"
              className="w-full rounded-lg border border-input bg-background placeholder:text-smoke disabled:text-smoke px-2 py-1.5 text-[12px]"
            />
          </Field>
        </div>
      </div>
      {playbook.measurements.length === 0 ? (
        <div className="p-6 text-center text-[13px] text-slate-quiet">
          No weekly rollups yet.{" "}
          {suggested
            ? "Use this week's data to log the first row from real runs."
            : "Run tracked prompts to unlock a suggested rollup."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border bg-fog text-[10px] font-medium text-ash uppercase tracking-wider">
                <th className="text-left p-3">Week of</th>
                <th className="text-right p-3">Prompts</th>
                <th className="text-right p-3">Brand</th>
                <th className="text-right p-3">Comp. avg</th>
                <th className="text-right p-3">SoV %</th>
                <th className="text-left p-3">Top page type</th>
                <th className="text-left p-3">Takeaway</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {playbook.measurements.map((m) => (
                <tr key={m.id} className="hover:bg-mist transition-colors">
                  <td className="p-3 font-medium text-foreground whitespace-nowrap">
                    {m.weekOf}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {m.totalPrompts}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {m.brandMentions}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {m.competitorMentionsAvg ?? "—"}
                  </td>
                  <td className="p-3 text-right tabular-nums font-medium">
                    {m.shareOfVoicePct != null ? `${m.shareOfVoicePct}%` : "—"}
                  </td>
                  <td className="p-3">{m.topPageType ?? "—"}</td>
                  <td className="p-3 text-slate-quiet max-w-[260px]">
                    {m.keyTakeaway ?? "—"}
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() => del.mutate({ id: m.id })}
                      className="p-1 rounded-full hover:bg-[var(--negative-surface)] text-slate-quiet hover:text-negative transition-colors"
                    >
                      <Trash className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </StepShell>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] font-medium text-ash uppercase tracking-wider mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}
