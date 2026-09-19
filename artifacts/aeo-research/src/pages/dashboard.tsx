import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetAeoResearch } from "@workspace/api-client-react";
import { CSVLink } from "react-csv";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCw, ChevronDown, Check,
  Sun, Moon, Download, Printer, ExternalLink,
} from "lucide-react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";

const CHART_COLORS = {
  blue: "#0079F2",
  purple: "#795EFF",
  green: "#009118",
  red: "#A60808",
  pink: "#ec4899",
};

const CHART_COLOR_LIST = [
  CHART_COLORS.blue,
  CHART_COLORS.purple,
  CHART_COLORS.green,
  CHART_COLORS.red,
  CHART_COLORS.pink,
];

const DATA_SOURCES: string[] = ["Curated AEO Research", "Platform Data"];

const INTERVAL_OPTIONS = [
  { label: "Every 5 min", ms: 5 * 60 * 1000 },
  { label: "Every 15 min", ms: 15 * 60 * 1000 },
  { label: "Every 1 hour", ms: 60 * 60 * 1000 },
  { label: "Every 24 hours", ms: 24 * 60 * 60 * 1000 },
];

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      style={{
        backgroundColor: "#fff",
        borderRadius: "6px",
        padding: "10px 14px",
        border: "1px solid #e0e0e0",
        color: "#1a1a1a",
        fontSize: "13px",
      }}
    >
      <div style={{ marginBottom: "6px", fontWeight: 500, display: "flex", alignItems: "center", gap: "6px" }}>
        {payload.length === 1 && payload[0].color && payload[0].color !== "#ffffff" && (
          <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "2px", backgroundColor: payload[0].color, flexShrink: 0 }} />
        )}
        {label}
      </div>
      {payload.map((entry: any, index: number) => (
        <div key={index} style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "3px" }}>
          {payload.length > 1 && entry.color && entry.color !== "#ffffff" && (
            <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "2px", backgroundColor: entry.color, flexShrink: 0 }} />
          )}
          <span style={{ color: "#444" }}>{entry.name}</span>
          <span style={{ marginLeft: "auto", fontWeight: 600 }}>
            {typeof entry.value === "number" ? entry.value.toLocaleString() : entry.value}
            {entry.dataKey && entry.dataKey.toLowerCase().includes("pct") ? "%" : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function CustomLegend({ payload }: any) {
  if (!payload || payload.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "8px 16px", fontSize: "13px" }}>
      {payload.map((entry: any, index: number) => (
        <div key={index} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "2px", backgroundColor: entry.color, flexShrink: 0 }} />
          <span>{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const query = useGetAeoResearch();
  
  const [isDark, setIsDark] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedIntervalMs, setSelectedIntervalMs] = useState(5 * 60 * 1000);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: query.queryKey });
    }, selectedIntervalMs);
    return () => clearInterval(t);
  }, [autoRefresh, selectedIntervalMs, queryClient, query.queryKey]);

  const loading = query.isLoading || query.isFetching;

  useEffect(() => {
    if (loading) {
      setIsSpinning(true);
      return undefined;
    }
    const t = setTimeout(() => setIsSpinning(false), 600);
    return () => clearTimeout(t);
  }, [loading]);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: query.queryKey });
  };

  const lastRefreshed = query.dataUpdatedAt
    ? (() => {
        const d = new Date(query.dataUpdatedAt);
        const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
        const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return `${time} on ${date}`;
      })()
    : null;

  const data = query.data;
  
  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "#e5e5e5";
  const tickColor = isDark ? "#98999C" : "#71717a";

  const [sorting, setSorting] = useState<SortingState>([]);
  
  const columns: ColumnDef<any>[] = [
    { accessorKey: "name", header: "Study Name", cell: ({ row }) => (
      <a href={row.original.url} target="_blank" rel="noreferrer" className="text-primary hover:underline flex items-center gap-1">
        {row.original.name} <ExternalLink className="w-3 h-3" />
      </a>
    ) },
    { accessorKey: "publisher", header: "Publisher" },
    { accessorKey: "methodology", header: "Methodology" },
    { accessorKey: "date", header: "Date" }
  ];

  const table = useReactTable({
    data: data?.sources || [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="min-h-screen bg-background px-5 py-4 pt-[32px] pb-[32px] pl-[24px] pr-[24px]">
      <div className="max-w-[1400px] mx-auto">
        
        {/* Header */}
        <div className="mb-8 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="pt-2">
            <h1 className="font-bold text-[32px] font-serif tracking-tight">The State of AEO</h1>
            <p className="text-muted-foreground mt-1.5 text-[14px]">The business case for Answer Engine Optimization based on verified industry research.</p>
            
            {DATA_SOURCES.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <span className="text-[12px] text-muted-foreground shrink-0">
                  Data Sources:
                </span>
                {DATA_SOURCES.map((source) => (
                  <span
                    key={source}
                    className="text-[12px] font-bold rounded px-2 py-0.5 truncate print:!bg-[rgb(229,231,235)] print:!text-[rgb(75,85,99)]"
                    title={source}
                    style={{
                      maxWidth: "20ch",
                      backgroundColor: isDark
                        ? "rgba(255,255,255,0.1)"
                        : "rgb(229, 231, 235)",
                      color: isDark ? "#c8c9cc" : "rgb(75, 85, 99)",
                    }}
                  >
                    {source}
                  </span>
                ))}
              </div>
            )}
            
            {lastRefreshed && <p className="text-[12px] text-muted-foreground mt-3">Last refresh: {lastRefreshed}</p>}
          </div>
          
          <div className="flex items-center gap-3 pt-2 print:hidden">
            <div className="relative" ref={dropdownRef}>
              <div
                className="flex items-center rounded-[6px] overflow-hidden h-[26px] text-[12px]"
                style={{
                  backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2",
                  color: isDark ? "#c8c9cc" : "#4b5563",
                }}
              >
                <button onClick={handleRefresh} disabled={loading} className="flex items-center gap-1 px-2 h-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors disabled:opacity-50">
                  <RefreshCw className={`w-3.5 h-3.5 ${isSpinning ? "animate-spin" : ""}`} />
                  Refresh
                </button>
                <div className="w-px h-4 shrink-0" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)" }} />
                <button onClick={() => setDropdownOpen((o) => !o)} className="flex items-center justify-center px-1.5 h-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
              
              {dropdownOpen && (
                <div className="absolute right-0 top-full mt-1 w-48 rounded-md border bg-popover text-popover-foreground shadow-md z-50 py-1">
                  <div className="px-3 py-2 border-b flex items-center justify-between">
                    <span className="text-sm font-medium">Auto-refresh</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
                      <div className="w-7 h-4 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-primary"></div>
                    </label>
                  </div>
                  <div className="py-1">
                    {INTERVAL_OPTIONS.map((opt) => (
                      <button
                        key={opt.ms}
                        onClick={() => setSelectedIntervalMs(opt.ms)}
                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center justify-between"
                      >
                        {opt.label}
                        {selectedIntervalMs === opt.ms && <Check className="w-4 h-4 text-primary" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            <button
              onClick={() => window.print()}
              disabled={loading}
              className="flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors disabled:opacity-50"
              style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }}
              aria-label="Export as PDF"
            >
              <Printer className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setIsDark((d) => !d)}
              className="flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors"
              style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }}
              aria-label="Toggle dark mode"
            >
              {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {(data?.kpis || [1, 2, 3, 4]).map((kpi: any, i) => (
            <Card key={i}>
              <CardContent className="p-6 h-full flex flex-col justify-between">
                {loading || !data ? (
                  <>
                    <Skeleton className="h-4 w-24 mb-2" />
                    <Skeleton className="h-8 w-32 mb-4" />
                    <Skeleton className="h-3 w-48 mt-auto" />
                  </>
                ) : (
                  <>
                    <div>
                      <p className="text-sm text-muted-foreground font-medium">{kpi.label}</p>
                      <p className="text-3xl font-bold mt-1.5" style={{ color: CHART_COLORS.blue }}>{kpi.value}</p>
                      <p className="text-sm mt-2 font-medium">{kpi.detail}</p>
                    </div>
                    <div className="mt-4 pt-3 border-t text-[11px] text-muted-foreground">
                      Source: <a href={kpi.sourceUrl} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">{kpi.source}, {kpi.asOf}</a>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
          
          <Card>
            <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base font-serif">CTR Impact of AI Summaries</CardTitle>
              {!loading && data?.ctrImpact && data.ctrImpact.length > 0 && (
                <CSVLink data={data.ctrImpact} filename="ctr-impact.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }} aria-label="Export chart data as CSV">
                  <Download className="w-3.5 h-3.5" />
                </CSVLink>
              )}
            </CardHeader>
            <CardContent>
              {loading || !data ? <Skeleton className="w-full h-[300px]" /> : (
                <>
                  <ResponsiveContainer width="100%" height={260} debounce={0}>
                    <BarChart data={data.ctrImpact} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                      <XAxis dataKey="scenario" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                      <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                      <Tooltip content={<CustomTooltip />} isAnimationActive={false} cursor={false} />
                      <Bar dataKey="ctrPct" name="CTR" fill={CHART_COLORS.blue} fillOpacity={0.8} activeBar={{ fillOpacity: 1 }} isAnimationActive={false} radius={[2, 2, 0, 0]}>
                         {data.ctrImpact.map((_, index) => (
                           <Cell key={`cell-${index}`} fill={CHART_COLOR_LIST[index % CHART_COLOR_LIST.length]} />
                         ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  {data.ctrImpact[0] && (
                    <div className="mt-3 text-[11px] text-muted-foreground text-center">
                      Source: <a href={data.ctrImpact[0].sourceUrl} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">{data.ctrImpact[0].source}</a>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base font-serif">Average Citations per Response</CardTitle>
              {!loading && data?.citationsPerResponse && data.citationsPerResponse.length > 0 && (
                <CSVLink data={data.citationsPerResponse} filename="citations-per-response.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }} aria-label="Export chart data as CSV">
                  <Download className="w-3.5 h-3.5" />
                </CSVLink>
              )}
            </CardHeader>
            <CardContent>
              {loading || !data ? <Skeleton className="w-full h-[300px]" /> : (
                <>
                  <ResponsiveContainer width="100%" height={260} debounce={0}>
                    <BarChart data={data.citationsPerResponse} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                      <XAxis dataKey="platform" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                      <YAxis tickFormatter={(v) => v.toFixed(1)} tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                      <Tooltip content={<CustomTooltip />} isAnimationActive={false} cursor={false} />
                      <Bar dataKey="avgCitations" name="Citations" fill={CHART_COLORS.purple} fillOpacity={0.8} activeBar={{ fillOpacity: 1 }} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  {data.citationsPerResponse[0] && (
                    <div className="mt-3 text-[11px] text-muted-foreground text-center">
                      Source: <a href={data.citationsPerResponse[0].sourceUrl} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">{data.citationsPerResponse[0].source}</a>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base font-serif">Platform Traffic Share</CardTitle>
              {!loading && data?.platformTrafficShare && data.platformTrafficShare.length > 0 && (
                <CSVLink data={data.platformTrafficShare} filename="platform-traffic-share.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }} aria-label="Export chart data as CSV">
                  <Download className="w-3.5 h-3.5" />
                </CSVLink>
              )}
            </CardHeader>
            <CardContent>
              {loading || !data ? <Skeleton className="w-full h-[300px]" /> : (
                <>
                  <ResponsiveContainer width="100%" height={260} debounce={0}>
                    <PieChart>
                      <Pie 
                        data={data.platformTrafficShare} 
                        dataKey="sharePct" 
                        nameKey="platform" 
                        cx="50%" cy="50%" 
                        outerRadius={80} innerRadius={50}
                        cornerRadius={2} paddingAngle={2} 
                        isAnimationActive={false} stroke="none"
                      >
                        {data.platformTrafficShare.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={CHART_COLOR_LIST[index % CHART_COLOR_LIST.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} isAnimationActive={false} />
                      <Legend content={<CustomLegend />} />
                    </PieChart>
                  </ResponsiveContainer>
                  {data.platformTrafficShare[0] && (
                    <div className="mt-3 text-[11px] text-muted-foreground text-center">
                      Source: <a href={data.platformTrafficShare[0].sourceUrl} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">{data.platformTrafficShare[0].source}</a> ({data.platformTrafficShare[0].period})
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base font-serif">Domain Authority Share</CardTitle>
              {!loading && data?.domainAuthorityShare && data.domainAuthorityShare.length > 0 && (
                <CSVLink data={data.domainAuthorityShare} filename="domain-authority-share.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }} aria-label="Export chart data as CSV">
                  <Download className="w-3.5 h-3.5" />
                </CSVLink>
              )}
            </CardHeader>
            <CardContent>
              {loading || !data ? <Skeleton className="w-full h-[300px]" /> : (
                <>
                  <ResponsiveContainer width="100%" height={260} debounce={0}>
                    <BarChart data={data.domainAuthorityShare} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                      <XAxis dataKey="bucket" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                      <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                      <Tooltip content={<CustomTooltip />} isAnimationActive={false} cursor={false} />
                      <Bar dataKey="sharePct" name="Share" fill={CHART_COLORS.green} fillOpacity={0.8} activeBar={{ fillOpacity: 1 }} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  {data.domainAuthorityShare[0] && (
                    <div className="mt-3 text-[11px] text-muted-foreground text-center">
                      Source: <a href={data.domainAuthorityShare[0].sourceUrl} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">{data.domainAuthorityShare[0].source}</a>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
          
          <Card className="lg:col-span-2">
            <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base font-serif">AI vs Search Citation Share by Category</CardTitle>
              {!loading && data?.sourceTypeShare && data.sourceTypeShare.length > 0 && (
                <CSVLink data={data.sourceTypeShare} filename="source-type-share.csv" className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }} aria-label="Export chart data as CSV">
                  <Download className="w-3.5 h-3.5" />
                </CSVLink>
              )}
            </CardHeader>
            <CardContent>
              {loading || !data ? <Skeleton className="w-full h-[300px]" /> : (
                <>
                  <ResponsiveContainer width="100%" height={300} debounce={0}>
                    <BarChart data={data.sourceTypeShare} margin={{ top: 20, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                      <XAxis dataKey="category" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                      <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                      <Tooltip content={<CustomTooltip />} isAnimationActive={false} cursor={false} />
                      <Legend content={<CustomLegend />} />
                      <Bar dataKey="searchSharePct" name="Traditional Search" fill={CHART_COLORS.blue} fillOpacity={0.8} activeBar={{ fillOpacity: 1 }} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                      <Bar dataKey="aiSharePct" name="AI Summaries" fill={CHART_COLORS.purple} fillOpacity={0.8} activeBar={{ fillOpacity: 1 }} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  {data.sourceTypeShare[0] && (
                    <div className="mt-3 text-[11px] text-muted-foreground text-center">
                      Source: <a href={data.sourceTypeShare[0].sourceUrl} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">{data.sourceTypeShare[0].source}</a>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
          {/* Adoption Section */}
          <section>
            <h2 className="text-xl font-serif font-bold mb-4">Adoption Velocity</h2>
            <div className="space-y-4">
              {loading || !data ? (
                [1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)
              ) : (
                data.adoption.map((stat: any, i) => (
                  <Card key={i}>
                    <CardContent className="p-5">
                      <p className="text-2xl font-bold" style={{ color: CHART_COLORS.blue }}>{stat.value}</p>
                      <p className="text-[15px] font-medium mt-1">{stat.label}</p>
                      <p className="text-sm text-muted-foreground mt-2">{stat.detail}</p>
                      <div className="mt-3 pt-3 border-t text-[11px] text-muted-foreground">
                        Source: <a href={stat.sourceUrl} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">{stat.source}, {stat.asOf}</a>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </section>

          {/* Investment Section */}
          <section>
            <h2 className="text-xl font-serif font-bold mb-4">The Investment Case</h2>
            <div className="space-y-4">
              {loading || !data ? (
                [1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)
              ) : (
                data.investment.map((stat: any, i) => (
                  <Card key={i}>
                    <CardContent className="p-5">
                      <p className="text-2xl font-bold" style={{ color: CHART_COLORS.green }}>{stat.value}</p>
                      <p className="text-[15px] font-medium mt-1">{stat.label}</p>
                      <p className="text-sm text-muted-foreground mt-2">{stat.detail}</p>
                      <div className="mt-3 pt-3 border-t text-[11px] text-muted-foreground">
                        Source: <a href={stat.sourceUrl} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">{stat.source}, {stat.asOf}</a>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </section>
        </div>

        {/* Implications Section */}
        <section className="mb-12">
          <h2 className="text-2xl font-serif font-bold mb-4 text-center">What This Means For Brand Strategy</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {loading || !data ? (
              [1, 2, 3].map((i) => <Skeleton key={i} className="h-40 w-full" />)
            ) : (
              data.implications.map((imp: any, i) => (
                <Card key={i} className="bg-muted/30">
                  <CardContent className="p-6">
                    <h3 className="text-lg font-bold mb-2">{imp.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{imp.detail}</p>
                    <div className="mt-3 pt-3 border-t text-[11px] text-muted-foreground">
                      Source:{" "}
                      {imp.sources.map((s: any, j: number) => (
                        <span key={j}>
                          {j > 0 && "; "}
                          <a href={s.url} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">{s.name}</a>
                        </span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </section>

        {/* Methodology & Sources Table */}
        <section>
          <Card>
            <CardHeader className="px-5 pt-5 pb-3">
              <CardTitle className="text-lg font-serif">Methodology & Sources</CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              {loading || !data ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead>
                      <tr className="border-b">
                        {table.getHeaderGroups().map((headerGroup) => (
                          headerGroup.headers.map((header) => (
                            <th key={header.id} className="py-3 px-2 font-medium text-muted-foreground" onClick={header.column.getToggleSortingHandler()}>
                              <div className="flex items-center gap-1 cursor-pointer select-none">
                                {flexRender(header.column.columnDef.header, header.getContext())}
                                {{ asc: " \u25B2", desc: " \u25BC" }[header.column.getIsSorted() as string] ?? null}
                              </div>
                            </th>
                          ))
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {table.getRowModel().rows.map((row) => (
                        <tr key={row.id} className="hover:bg-muted/50 transition-colors">
                          {row.getVisibleCells().map((cell) => (
                            <td key={cell.id} className="py-3 px-2 align-top">
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

      </div>
    </div>
  );
}
