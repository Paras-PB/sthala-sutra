"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { titleCase } from "@/lib/archive-client";
import type { ArchiveFilters as Filters, Facets } from "@/types/archive";

type ArchiveFiltersProps = {
  facets: Facets;
  filters: Filters;
  onChange: (next: Filters) => void;
};

type FilterField = { key: keyof Filters; label: string; anyLabel: string; options: string[] };

/**
 * Region, type and era selects, populated from the values that actually exist (GET /api/facets).
 * On phones the fields fold behind a toggle so the search stays near the top of the page.
 */
export default function ArchiveFilters({ facets, filters, onChange }: ArchiveFiltersProps) {
  const [open, setOpen] = useState(false);
  const fields: FilterField[] = [
    { key: "region", label: "Region", anyLabel: "All regions", options: facets.regions },
    { key: "category", label: "Heritage type", anyLabel: "All types", options: facets.categories },
    { key: "era", label: "Era", anyLabel: "Any era", options: facets.eras },
  ];
  const activeCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className={`filters ${open ? "open" : ""}`}>
      <div className="filters-heading">
        <h2>Refine the archive</h2>
        <button type="button" className="filters-toggle" aria-expanded={open} aria-controls="filter-fields" onClick={() => setOpen(!open)}>
          Refine{activeCount ? ` (${activeCount})` : ""}
        </button>
        {activeCount > 0 && <button type="button" className="filters-reset" onClick={() => onChange({ region: "", category: "", era: "" })}>Reset</button>}
      </div>
      <div className="filter-fields" id="filter-fields">
        {fields.map((field) => (
          <div className="filter" key={field.key}>
            <label htmlFor={`filter-${field.key}`}>{field.label}</label>
            <div className="select-wrap">
              <select id={`filter-${field.key}`} value={filters[field.key]} onChange={(event) => onChange({ ...filters, [field.key]: event.target.value })}>
                <option value="">{field.anyLabel}</option>
                {field.options.map((option) => <option key={option} value={option}>{field.key === "category" ? titleCase(option) : option}</option>)}
              </select>
              <ChevronDown size={14} aria-hidden />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
