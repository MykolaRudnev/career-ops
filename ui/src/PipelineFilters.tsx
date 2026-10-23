import { Filter, SlidersHorizontal, Star } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Toggle } from "@/components/ui/toggle";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
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
}: {
  pressed: boolean;
  onPressedChange: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Toggle pressed={pressed} onPressedChange={onPressedChange} variant="outline" size="sm" className={cn("h-auto min-h-8 whitespace-normal text-left", className)}>
      {children}
    </Toggle>
  );
}

function PipelineFiltersPanel(props: PipelineFiltersProps) {
  const {
    pipelineView,
    setPipelineView,
    setActiveTab,
    pendingCount,
    evaluatedCount,
    appliedCount,
    searchQuery,
    setSearchQuery,
    matchCategory,
    setMatchCategory,
    categoryCounts,
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

  const showJobFilters = pipelineView !== "manual";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-1 rounded-md bg-muted/50 p-1 sm:grid-cols-4">
        <Button
          type="button"
          size="sm"
          variant={pipelineView === "pending" ? "secondary" : "ghost"}
          className="h-auto min-h-9 whitespace-normal px-2 py-2 text-xs sm:text-sm"
          onClick={() => setPipelineView("pending")}
        >
          Pending ({pendingCount})
        </Button>
        <Button
          type="button"
          size="sm"
          variant={pipelineView === "evaluated" ? "secondary" : "ghost"}
          className="h-auto min-h-9 whitespace-normal px-2 py-2 text-xs sm:text-sm"
          onClick={() => {
            setActiveTab("pipeline");
            setPipelineView("evaluated");
          }}
        >
          Evaluated ({evaluatedCount})
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-auto min-h-9 whitespace-normal px-2 py-2 text-xs sm:text-sm"
          onClick={() => setActiveTab("applied")}
        >
          Applied ({appliedCount})
        </Button>
        <Button
          type="button"
          size="sm"
          variant={pipelineView === "manual" ? "secondary" : "ghost"}
          className="h-auto min-h-9 whitespace-normal px-2 py-2 text-xs sm:text-sm"
          onClick={() => setPipelineView("manual")}
        >
          Manual Job
        </Button>
      </div>

      {showJobFilters && (
        <Input
          type="search"
          placeholder="Filter by title, company, or city..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full"
        />
      )}

      {showJobFilters && (
        <>
          <Collapsible defaultOpen className="rounded-md border border-border p-3">
            <CollapsibleTrigger className="flex w-full items-center justify-between text-sm font-medium text-foreground">
              <span className="inline-flex items-center gap-2">
                <Filter className="size-4 text-muted-foreground" />
                Match categories
              </span>
              <ChevronDown className="size-4 text-muted-foreground" />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 flex flex-wrap gap-2">
              <CategoryChip pressed={matchCategory === "ALL"} onPressedChange={() => setMatchCategory("ALL")}>
                All ({categoryCounts.all})
              </CategoryChip>
              <CategoryChip
                pressed={matchCategory === "BEST_MATCH"}
                onPressedChange={() => setMatchCategory(matchCategory === "BEST_MATCH" ? "ALL" : "BEST_MATCH")}
                className="data-[state=on]:border-primary/50 data-[state=on]:text-primary"
              >
                <Star className="size-3.5" fill={matchCategory === "BEST_MATCH" ? "currentColor" : "none"} />
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
            </CollapsibleContent>
          </Collapsible>

          <Collapsible defaultOpen className="rounded-md border border-border p-3">
            <CollapsibleTrigger className="flex w-full items-center justify-between text-sm font-medium text-foreground">
              Market & location
              <ChevronDown className="size-4 text-muted-foreground" />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["BULK", `US / Intl (${bulkLaneCount})`],
                    ["POLAND", `Poland · manual (${polandCount})`],
                    ["ALL", `All (${marketFacetTotal})`],
                  ] as const
                ).map(([lane, label]) => (
                  <CategoryChip
                    key={lane}
                    pressed={marketLane === lane}
                    onPressedChange={() => {
                      setMarketLane(lane);
                      saveMarketLane(lane);
                    }}
                  >
                    {label}
                  </CategoryChip>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>Country</Label>
                  <Select value={countryFilter} onValueChange={setCountryFilter}>
                    <SelectTrigger className="w-full">
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
                <div className="flex flex-col gap-1.5">
                  <Label>Technology</Label>
                  <Select value={technologyFilter || "__all__"} onValueChange={(v) => setTechnologyFilter(v === "__all__" ? "" : v)}>
                    <SelectTrigger className="w-full">
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
            </CollapsibleContent>
          </Collapsible>

          <div className="rounded-md border border-border p-3">
            <Label className="mb-2 block">Work model</Label>
            <div className="flex flex-wrap gap-2">
              {(["ALL", "Remote", "Hybrid", "Office"] as const).map((m) => (
                <CategoryChip key={m} pressed={modelFilter === m} onPressedChange={() => setModelFilter(m)}>
                  {m}
                </CategoryChip>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function PipelineFilters(props: PipelineFiltersProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <div className={cn("lg:hidden", props.className)}>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" className="w-full justify-center">
              <SlidersHorizontal className="size-4" />
              Filters & views
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Search & filters</SheetTitle>
            </SheetHeader>
            <PipelineFiltersPanel {...props} />
          </SheetContent>
        </Sheet>
      </div>
      <aside
        className={cn(
          "hidden min-w-0 lg:block lg:w-72 xl:w-80 shrink-0 rounded-md border border-border bg-muted/20 p-3 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto lg:overflow-x-hidden",
          props.className
        )}
      >
        <PipelineFiltersPanel {...props} />
      </aside>
    </>
  );
}
