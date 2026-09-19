import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useLocation } from "wouter";
import * as Api from "@workspace/api-client-react";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, Globe2, Sparkles } from "lucide-react";

interface CompanyContextType {
  companyId: number;
  setCompanyId: (id: number) => void;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [companyId, setCompanyId] = useState<number | undefined>(() => {
    const saved = localStorage.getItem("aeo.selectedCompanyId");
    return saved ? parseInt(saved, 10) : undefined;
  });

  const { data: companies, isLoading } = Api.useListCompanies({ days: 30 });

  useEffect(() => {
    if (companies && companies.length > 0) {
      if (!companyId || !companies.find(c => c.id === companyId)) {
        const firstId = companies[0].id;
        setCompanyId(firstId);
        localStorage.setItem("aeo.selectedCompanyId", firstId.toString());
      }
    }
  }, [companies, companyId]);

  const handleSetCompanyId = (id: number) => {
    setCompanyId(id);
    localStorage.setItem("aeo.selectedCompanyId", id.toString());
  };

  if (companyId === undefined || (!isLoading && companies?.length === 0)) {
    if (isLoading) {
      return (
        <div className="flex h-screen items-center justify-center">
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Loading workspace...
          </div>
        </div>
      );
    }
    return <CompanyOnboarding onCreated={handleSetCompanyId} />;
  }

  return (
    <CompanyContext.Provider value={{ companyId, setCompanyId: handleSetCompanyId }}>
      {children}
    </CompanyContext.Provider>
  );
}

interface OnboardingValues {
  website: string;
  targetAudience: string;
}

function CompanyOnboarding({ onCreated }: { onCreated: (id: number) => void }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const createCompany = Api.useCreateCompany();
  const form = useForm<OnboardingValues>({
    defaultValues: { website: "", targetAudience: "" },
  });

  const submit = form.handleSubmit((values) => {
    const domain = values.website.trim().toLowerCase();
    createCompany.mutate(
      {
        data: {
          domain,
          targetAudience: values.targetAudience.trim() || null,
        },
      },
      {
        onSuccess: (company) => {
          void queryClient.invalidateQueries({
            queryKey: Api.getListCompaniesQueryKey({ days: 30 }),
          });
          onCreated(company.id);
          setLocation("/audit");
        },
        onError: (error) => {
          form.setError("website", {
            message:
              (error as { response?: { data?: { error?: string } } }).response?.data?.error ??
              "We couldn’t create this workspace. Check the website and try again.",
          });
        },
      },
    );
  });

  return (
    <main className="min-h-screen bg-fog px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Sparkles className="h-5 w-5" />
          </div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-quiet">
            Set up your workspace
          </p>
          <h1 className="steep-heading text-3xl tracking-tight">Find the questions your audience asks</h1>
          <p className="mx-auto mt-3 max-w-md text-[14px] leading-6 text-slate-quiet">
            Share a website and we’ll assess its public pages, propose a company profile, and prepare
            a site-wide AEO readiness audit and audience-led prompt recommendations for you to review.
          </p>
        </div>

        <Form {...form}>
          <form onSubmit={submit} className="m1-card space-y-5 p-5 sm:p-7" data-testid="form-company-onboarding">
            <FormField
              control={form.control}
              name="website"
              rules={{ required: "Enter a company website." }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Company website</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Globe2 className="absolute left-3 top-3 h-4 w-4 text-slate-quiet" />
                      <Input {...field} className="pl-9" placeholder="https://acme.com" data-testid="input-onboarding-website" />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="targetAudience"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Target audience <span className="font-normal text-slate-quiet">(optional)</span></FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={3}
                      placeholder="Who do you most want to reach? Leave blank and we’ll suggest an audience."
                      data-testid="input-onboarding-audience"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="rounded-lg border border-border bg-fog p-3 text-[12px] leading-5 text-slate-quiet">
              Assessment runs in the background. You can leave the page and return without losing progress,
              and nothing inferred becomes company context until you approve it.
            </div>
            <button
              type="submit"
              disabled={createCompany.isPending}
              className="m1-btn flex h-10 w-full items-center justify-center gap-2 disabled:opacity-50"
              data-testid="button-start-assessment"
            >
              {createCompany.isPending ? "Starting assessment…" : "Assess website"}
              {!createCompany.isPending && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>
        </Form>
      </div>
    </main>
  );
}

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (ctx === undefined) {
    throw new Error("useCompany must be used within a CompanyProvider");
  }
  return ctx;
}
