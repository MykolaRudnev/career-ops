import { SlidersHorizontal, Star } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toggle } from "@/components/ui/toggle";
import { saveMarketLane, type MarketLane } from "./marketLane";
import { cn } from "@/lib/utils";

export type MatchCategory = "ALL" | "BEST_MATCH" | "REACT_NEXT" | "SHOPIFY" | "MAGENTO" | "NODE" | "SENIOR_LEAD";

export type PipelineFiltersProps = {
  pipelineView: "pending" | "evaluated" | "manual";
  setPipelineView: (view: "pending" | "evaluated" | "manual") => void;
  setActiveTab: (tab: "pipeline" | "analytics" | "applied" | "cvs" | "settings") => void;
  pendingCount: number;
  evaluatedCount: number;
  appliedCount: number;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  matchCategory: MatchCategory;
  setMatchCategory: (value: MatchCategory) => void;
  categoryCounts: {
    all: number;
    bestMatch: number;
    reactNext: number;
    shopify: number;
    magento: number;
    node: number;
    seniorLead: number;
  };
  marketLane: MarketLane;
  setMarketLane: (lane: MarketLane) => void;
  bulkLaneCount: number;
  polandCount: number;
  marketFacetTotal: number;
  countryFilter: string;
  setCountryFilter: (value: string) => void;
  countryOptions: [string, number][];
  currentListCount: number;
  technologyFilter: string;
  setTechnologyFilter: (value: string) => void;
  technologyOptions: string[];
  modelFilter: "ALL" | "Remote" | "Hybrid" | "Office";
  setModelFilter: (value: "ALL" | "Remote" | "Hybrid" | "Office") => void;
  className?: string;
};

function CategoryChip({
  pressed,
  onPressedChange,
  children,
  className,
  title,
}: {
  pressed: boolean;
  onPressedChange: () => void;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <Toggle
      pressed={pressed}
      onPressedChange={onPressedChange}
      variant="outline"
      size="sm"
      title={title}
      className={cn("h-auto min-h-8 max-w-full whitespace-normal px-2.5 py-1.5 text-left text-xs sm:text-sm", className)}
    >
      {children}
    </Toggle>
  );
}

function MatchCategoryChips({
  matchCategory,
  setMatchCategory,
  categoryCounts,
}: Pick<PipelineFiltersProps, "matchCategory" | "setMatchCategory" | "categoryCounts">) {
  return (
    <div className="flex flex-wrap gap-2">
      <CategoryChip pressed={matchCategory === "ALL"} onPressedChange={() => setMatchCategory("ALL")}>
        All ({categoryCounts.all})
      </CategoryChip>
      <CategoryChip
        pressed={matchCategory === "BEST_MATCH"}
        onPressedChange={() => setMatchCategory(matchCategory === "BEST_MATCH" ? "ALL" : "BEST_MATCH")}
        className="data-[state=on]:border-primary/50 data-[state=on]:text-primary"
      >
        <Star className="size-3.5 shrink-0" fill={matchCategory === "BEST_MATCH" ? "currentColor" : "none"} />
        Best ({categoryCounts.bestMatch})
      </CategoryChip>
      <CategoryChip
        pressed={matchCategory === "REACT_NEXT"}
        onPressedChange={() => setMatchCategory(matchCategory === "REACT_NEXT" ? "ALL" : "REACT_NEXT")}
      >
        React & Next.js ({categoryCounts.reactNext})
      </CategoryChip>
      <CategoryChip
        pressed={matchCategory === "SHOPIFY"}
        onPressedChange={() => setMatchCategory(matchCategory === "SHOPIFY" ? "ALL" : "SHOPIFY")}
      >
        Shopify ({categoryCounts.shopify})
      </CategoryChip>
      <CategoryChip
        pressed={matchCategory === "MAGENTO"}
        onPressedChange={() => setMatchCategory(matchCategory === "MAGENTO" ? "ALL" : "MAGENTO")}
      >
        Magento 2 ({categoryCounts.magento})
      </CategoryChip>
      <CategoryChip pressed={matchCategory === "NODE"} onPressedChange={() => setMatchCategory(matchCategory === "NODE" ? "ALL" : "NODE")}>
        Node.js ({categoryCounts.node})
      </CategoryChip>
      <CategoryChip
        pressed={matchCategory === "SENIOR_LEAD"}
        onPressedChange={() => setMatchCategory(matchCategory === "SENIOR_LEAD" ? "ALL" : "SENIOR_LEAD")}
      >
        Senior & Lead ({categoryCounts.seniorLead})
      </CategoryChip>
    </div>
  );
}

function PipelineViewTabs(props: PipelineFiltersProps) {
  const { pipelineView, setPipelineView, setActiveTab, pendingCount, evaluatedCount, appliedCount } = props;

  return (
    <Tabs
      value={pipelineView}
      onValueChange={(value) => {
        if (value === "pending" || value === "evaluated" || value === "manual") {
          if (value === "evaluated") setActiveTab("pipeline");
          setPipelineView(value);
        }
      }}
      className="w-full min-w-0"
    >
      <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1 sm:grid-cols-4">
        <TabsTrigger value="pending" className="min-w-0 px-2 py-2">
          <span className="truncate">Pending ({pendingCount})</span>
        </TabsTrigger>
        <TabsTrigger value="evaluated" className="min-w-0 px-2 py-2">
          <span className="truncate">Evaluated ({evaluatedCount})</span>
        </TabsTrigger>
        <button
          type="button"
          className="inline-flex min-w-0 items-center justify-center whitespace-normal rounded-sm px-2 py-2 text-xs font-medium text-muted-foreground ring-offset-background transition-all hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
          onClick={() => setActiveTab("applied")}
        >
          <span className="truncate">Applied ({appliedCount})</span>
        </button>
        <TabsTrigger value="manual" className="min-w-0 px-2 py-2">
          <span className="truncate">Manual Job</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

function MarketQuickToggles({
  marketLane,
  setMarketLane,
  bulkLaneCount,
  polandCount,
  marketFacetTotal,
}: Pick<PipelineFiltersProps, "marketLane" | "setMarketLane" | "bulkLaneCount" | "polandCount" | "marketFacetTotal">) {
  const lanes = (
    [
      ["BULK", `US / Intl (${bulkLaneCount})`, "Non-Poland roles — safe for bulk queue"],
      ["POLAND", `Poland · manual (${polandCount})`, "Poland roles: pick Apply on each row"],
      ["ALL", `All (${marketFacetTotal})`, "Show every market"],
    ] as const
  );

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label className="text-xs text-muted-foreground">Quick market</Label>
      <div className="flex flex-wrap gap-2">
        {lanes.map(([lane, label, title]) => (
          <CategoryChip
            key={lane}
            pressed={marketLane === lane}
            onPressedChange={() => {
              setMarketLane(lane);
              saveMarketLane(lane);
            }}
            className={cn("max-w-full")}
            title={title}
          >
            {label}
          </CategoryChip>
        ))}
      </div>
    </div>
  );
}

function FilterToolbarGrid(props: PipelineFiltersProps) {
  const {
    searchQuery,
    setSearchQuery,
    marketLane,
    setMarketLane,
    bulkLaneCount,
    polandCount,
    marketFacetTotal,
    countryFilter,
    setCountryFilter,
    countryOptions,
    currentListCount,
    technologyFilter,
    setTechnologyFilter,
    technologyOptions,
    modelFilter,
    setModelFilter,
  } = props;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-4">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="min-w-0">
          <Label className="mb-1.5 block text-xs text-muted-foreground">Search</Label>
          <Input
            type="search"
            placeholder="Title, company, or city…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full min-w-0"
          />
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="min-w-0">
            <Label className="mb-1.5 block text-xs text-muted-foreground">Market</Label>
            <Select
              value={marketLane}
              onValueChange={(lane) => {
                const next = lane as MarketLane;
                setMarketLane(next);
                saveMarketLane(next);
              }}
            >
              <SelectTrigger className="w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BULK">US / Intl ({bulkLaneCount})</SelectItem>
                <SelectItem value="POLAND">Poland · manual ({polandCount})</SelectItem>
                <SelectItem value="ALL">All markets ({marketFacetTotal})</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0">
            <Label className="mb-1.5 block text-xs text-muted-foreground">Country</Label>
            <Select value={countryFilter} onValueChange={setCountryFilter}>
              <SelectTrigger className="w-full min-w-0">
                <SelectValue placeholder="All countries" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All countries ({currentListCount})</SelectItem>
                {countryOptions.map(([country, count]) => (
                  <SelectItem key={country} value={country}>
                    {country} ({count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0">
            <Label className="mb-1.5 block text-xs text-muted-foreground">Technology</Label>
            <Select value={technologyFilter || "__all__"} onValueChange={(v) => setTechnologyFilter(v === "__all__" ? "" : v)}>
              <SelectTrigger className="w-full min-w-0">
                <SelectValue placeholder="All technologies" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All technologies</SelectItem>
                {technologyOptions.map((technology) => (
                  <SelectItem key={technology} value={technology}>{technology}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <MarketQuickToggles
          marketLane={marketLane}
          setMarketLane={setMarketLane}
          bulkLaneCount={bulkLaneCount}
          polandCount={polandCount}
          marketFacetTotal={marketFacetTotal}
        />
        <div className="min-w-0">
          <Label className="mb-1.5 block text-xs text-muted-foreground">Work model</Label>
          <div className="flex flex-wrap gap-2">
            {(["ALL", "Remote", "Hybrid", "Office"] as const).map((m) => (
              <CategoryChip key={m} pressed={modelFilter === m} onPressedChange={() => setModelFilter(m)}>
                {m}
              </CategoryChip>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DesktopJobFilters(props: PipelineFiltersProps) {
  return (
    <div className="hidden min-w-0 flex-col gap-3 md:flex">
      <FilterToolbarGrid {...props} />
      <div className="min-w-0 space-y-2 border-t border-border pt-3">
        <Label className="text-xs text-muted-foreground">Match focus</Label>
        <MatchCategoryChips
          matchCategory={props.matchCategory}
          setMatchCategory={props.setMatchCategory}
          categoryCounts={props.categoryCounts}
        />
      </div>
    </div>
  );
}

function MobileJobFilters(props: PipelineFiltersProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const { searchQuery, setSearchQuery, pipelineView } = props;
  if (pipelineView === "manual") return null;

  return (
    <div className="flex min-w-0 flex-col gap-3 md:hidden">
      <Input
        type="search"
        placeholder="Title, company, or city…"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="w-full min-w-0"
      />
      <MarketQuickToggles
        marketLane={props.marketLane}
        setMarketLane={props.setMarketLane}
        bulkLaneCount={props.bulkLaneCount}
        polandCount={props.polandCount}
        marketFacetTotal={props.marketFacetTotal}
      />
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Match focus</Label>
        <MatchCategoryChips
          matchCategory={props.matchCategory}
          setMatchCategory={props.setMatchCategory}
          categoryCounts={props.categoryCounts}
        />
      </div>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="w-full justify-center gap-2">
            <SlidersHorizontal className="size-4" />
            Country, technology & work model
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Location filters</SheetTitle>
          </SheetHeader>
          <div className="mt-4 flex flex-col gap-4 pb-4">
            <FilterToolbarGrid {...props} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Full-width pipeline toolbar (views + filters) above the job table. */
export function PipelineFilters(props: PipelineFiltersProps) {
  const { pipelineView, className } = props;
  const showJobFilters = pipelineView !== "manual";

  return (
    <div className={cn("w-full min-w-0 overflow-x-hidden border-b border-border py-3", className)}>
      <div className="flex min-w-0 flex-col gap-3">
        <PipelineViewTabs {...props} />
        {showJobFilters && (
          <>
            <DesktopJobFilters {...props} />
            <MobileJobFilters {...props} />
          </>
        )}
      </div>
    </div>
  );
}
