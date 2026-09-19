import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { 
  Calendar, Box, Hash, ChevronDown, Plus, 
  Building2, Check, Menu
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SidebarNav } from "./Sidebar";
import { ProductLogo } from "./ProductLogo";
import { useCompany } from "@/components/CompanyContext";
import { useListCompanies, useCreateCompany, getListCompaniesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useModels } from "@/hooks/use-models";

export function Topbar() {
  const { companyId, setCompanyId } = useCompany();
  const { data: companies } = useListCompanies({ days: 30 });
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [location, setLocation] = useLocation();
  // useSearch keeps us re-rendering on navigation, but can return "" under a
  // based router — read the actual query string from the location instead.
  const wouterSearch = useSearch();
  const search = wouterSearch || window.location.search.replace(/^\?/, "");
  const models = useModels();
  const isHolisticDashboard = location === "/";

  const selectedCompany = companies?.find(c => c.id === companyId);

  return (
    <>
      <header className="min-h-14 md:h-14 border-b border-border bg-paper/80 backdrop-blur-sm flex items-center gap-2 px-4 md:px-6 py-2 md:py-0 sticky top-0 z-10">
        <button
          onClick={() => setIsNavOpen(true)}
          className="md:hidden flex items-center justify-center w-8 h-8 -ml-1 rounded-full text-slate-quiet hover:text-foreground hover:bg-mist m1-sidebar-link shrink-0"
          aria-label="Open navigation menu"
        >
          <Menu className="w-[18px] h-[18px]" strokeWidth={1.5} />
        </button>
        <div className="flex flex-1 flex-wrap md:flex-nowrap items-center gap-2 md:gap-3 min-w-0">
          {!isHolisticDashboard && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <div className="flex items-center gap-2 text-foreground font-medium text-[13px] hover:bg-mist px-2.5 py-1.5 rounded-full cursor-pointer m1-sidebar-link">
                    <div className="w-4 h-4 bg-foreground rounded-full flex items-center justify-center">
                      <span className="text-[9px] font-bold text-background uppercase">
                        {selectedCompany?.name.charAt(0) || "C"}
                      </span>
                    </div>
                    {selectedCompany?.name || "Select Company"} 
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  <DropdownMenuLabel className="text-xs text-ash font-medium uppercase tracking-wider">
                    Companies
                  </DropdownMenuLabel>
                  {companies?.map(company => (
                    <DropdownMenuItem 
                      key={company.id}
                      onClick={() => {
                        setCompanyId(company.id);
                        setLocation("/overview");
                      }}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-mist rounded-full flex items-center justify-center shrink-0">
                          <span className="text-[9px] font-semibold text-slate-quiet uppercase">
                            {company.name.charAt(0)}
                          </span>
                        </div>
                        <span className="truncate max-w-[120px] font-medium">{company.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {company.visibilityPct !== null && (
                          <span className="text-[11px] text-muted-foreground font-mono">
                            {Math.round(company.visibilityPct)}%
                          </span>
                        )}
                        {company.id === companyId ? (
                          <Check className="w-3.5 h-3.5 text-foreground shrink-0" />
                        ) : (
                          <div className="w-3.5 h-3.5 shrink-0" />
                        )}
                      </div>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setIsAddOpen(true)} className="gap-2 text-muted-foreground">
                    <Plus className="w-4 h-4" />
                    Add company...
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              
              <div className="w-px h-4 bg-border mx-1" />
            </>
          )}
          
          {isHolisticDashboard ? (
            <DashboardFilters
              search={search}
              setLocation={setLocation}
              location={location}
              models={models}
              topics={[
                ...Array.from(new Set((companies ?? []).map((c) => c.industry).filter((v): v is string => Boolean(v)))).sort(),
                ...(companies?.some((c) => !c.industry) ? ["__uncategorized__"] : []),
              ]}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              <FilterPill icon={Calendar} label="Last 30 days" />
              <FilterPill icon={Box} label="All models" />
              <FilterPill icon={Hash} label="All topics" />
            </div>
          )}
        </div>
      </header>

      <Sheet open={isNavOpen} onOpenChange={setIsNavOpen}>
        <SheetContent side="left" className="w-[280px] p-0 bg-fog flex flex-col gap-0 md:hidden">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="h-14 flex items-center px-4 shrink-0 border-b border-border">
            <ProductLogo size={17} />
          </div>
          <SidebarNav onNavigate={() => setIsNavOpen(false)} />
        </SheetContent>
      </Sheet>

      {!isHolisticDashboard && (
        <AddCompanyDialog open={isAddOpen} onOpenChange={setIsAddOpen} />
      )}
    </>
  );
}

function DashboardFilters({
  search,
  setLocation,
  location = "/",
  models,
  topics,
}: {
  search: string;
  setLocation: (to: string) => void;
  location?: string;
  models: { id: string; label: string }[];
  topics: string[];
}) {
  const params = new URLSearchParams(search);
  const days = params.get("days") ?? "30";
  const selectedModel = params.get("model") ?? "";
  const selectedTopic = params.get("topic") ?? "";

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value);
    else next.delete(key);
    // Stay on the current page when changing filters.
    setLocation(`${location}${next.size ? `?${next.toString()}` : ""}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <FilterMenu
        icon={Calendar}
        label={days === "all" ? "All" : days === "90" ? "3 months" : days === "180" ? "6 months" : "30 days"}
        options={[
          { value: "30", label: "30 days" },
          { value: "90", label: "3 months" },
          { value: "180", label: "6 months" },
          { value: "all", label: "All" },
        ]}
        value={days}
        onChange={(value) => update("days", value === "30" ? "" : value)}
      />
      <FilterMenu
        icon={Box}
        label={models.find((m) => m.id === selectedModel)?.label ?? "All models"}
        options={[
          { value: "", label: "All models" },
          ...models.map((m) => ({ value: m.id, label: m.label })),
        ]}
        value={selectedModel}
        onChange={(value) => update("model", value)}
      />
      <FilterMenu
        icon={Hash}
        label={selectedTopic === "__uncategorized__" ? "Uncategorized" : selectedTopic || "All topics"}
        options={[
          { value: "", label: "All topics" },
          ...topics.map((topic) => ({ value: topic, label: topic === "__uncategorized__" ? "Uncategorized" : topic })),
        ]}
        value={selectedTopic}
        onChange={(value) => update("topic", value)}
      />
    </div>
  );
}

function FilterMenu({
  icon: Icon,
  label,
  options,
  value,
  onChange,
}: {
  icon: any;
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1.5 text-[12px] font-normal text-slate-quiet hover:text-foreground bg-paper border border-border px-2.5 py-1 rounded-full m1-sidebar-link">
          <Icon className="w-3.5 h-3.5" />
          <span className="max-w-28 sm:max-w-44 truncate">{label}</span>
          <ChevronDown className="w-3 h-3 ml-0.5 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48 max-h-80 overflow-y-auto">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value || "__all"}
            onClick={() => onChange(option.value)}
            className="flex items-center justify-between gap-3"
          >
            <span>{option.label}</span>
            {option.value === value && <Check className="w-3.5 h-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FilterPill({ icon: Icon, label }: { icon: any, label: string }) {
  return (
    <button className="flex items-center gap-1.5 text-[12px] font-normal text-slate-quiet hover:text-foreground bg-paper border border-border px-2.5 py-1 rounded-full m1-sidebar-link">
      <Icon className="w-3.5 h-3.5" />
      {label}
      <ChevronDown className="w-3 h-3 ml-0.5 opacity-50" />
    </button>
  );
}

function AddCompanyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [industry, setIndustry] = useState("");
  const { setCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const createCompany = useCreateCompany();

  const handleSave = () => {
    if (!name || !domain) return;
    createCompany.mutate(
      { data: { name, domain, industry: industry || undefined } },
      {
        onSuccess: (newCompany) => {
          queryClient.invalidateQueries({ queryKey: getListCompaniesQueryKey() });
          setCompanyId(newCompany.id);
          onOpenChange(false);
          setName("");
          setDomain("");
          setIndustry("");
        }
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-muted-foreground" />
            Add Tracked Company
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Company Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Corp"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Primary Domain</label>
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="e.g. acme.com"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Industry (Optional)</label>
            <Input
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="e.g. B2B SaaS"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button 
            onClick={handleSave} 
            disabled={!name || !domain || createCompany.isPending}
          >
            {createCompany.isPending ? "Adding..." : "Add Company"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
