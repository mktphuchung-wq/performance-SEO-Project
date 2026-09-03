"use client";

import { Fragment, type ReactElement, type ReactNode, useMemo, useState } from "react";
import {
  defaultFilterOperator,
  deriveTableView,
  type TableColumn,
  type TableColumnType,
  type TableFilterOperator,
  type TableGroup,
} from "@/lib/table-view";
import { inputClass } from "@/components/ui";

interface TableViewOptions {
  initialSort?: { column: string; direction?: "asc" | "desc" };
  initialGroup?: string;
}

export interface TableViewResult<Row> {
  columns: TableColumn<Row>[];
  groups: TableGroup<Row>[];
  visibleRows: Row[];
  totalCount: number;
  query: string;
  setQuery: (value: string) => void;
  sortColumn: string;
  setSortColumn: (value: string) => void;
  sortDirection: "asc" | "desc";
  setSortDirection: (value: "asc" | "desc") => void;
  filterColumn: string;
  setFilterColumn: (value: string) => void;
  filterOperator: TableFilterOperator;
  setFilterOperator: (value: TableFilterOperator) => void;
  filterValue: string;
  setFilterValue: (value: string) => void;
  groupColumn: string;
  setGroupColumn: (value: string) => void;
  wrap: boolean;
  setWrap: (value: boolean) => void;
  reset: () => void;
  isDirty: boolean;
  initialSortColumn: string;
  initialSortDirection: "asc" | "desc";
}

export function useTableView<Row>(
  rows: Row[],
  columns: TableColumn<Row>[],
  options: TableViewOptions = {},
): TableViewResult<Row> {
  const initialSortColumn = options.initialSort?.column ?? columns.find((column) => column.sortable !== false)?.id ?? "";
  const initialSortDirection = options.initialSort?.direction ?? "asc";
  const [query, setQuery] = useState("");
  const [sortColumn, setSortColumn] = useState(initialSortColumn);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">(initialSortDirection);
  const [filterColumn, setFilterColumn] = useState("");
  const [filterOperator, setFilterOperator] = useState<TableFilterOperator>("contains");
  const [filterValue, setFilterValue] = useState("");
  const [groupColumn, setGroupColumn] = useState(options.initialGroup ?? "");
  const [wrap, setWrap] = useState(false);

  const derived = useMemo(
    () =>
      deriveTableView(rows, columns, {
        query,
        sortColumn,
        sortDirection,
        filterColumn,
        filterOperator,
        filterValue,
        groupColumn,
      }),
    [rows, columns, query, sortColumn, sortDirection, filterColumn, filterOperator, filterValue, groupColumn],
  );

  function reset() {
    setQuery("");
    setSortColumn(initialSortColumn);
    setSortDirection(initialSortDirection);
    setFilterColumn("");
    setFilterOperator("contains");
    setFilterValue("");
    setGroupColumn(options.initialGroup ?? "");
    setWrap(false);
  }

  return {
    columns,
    ...derived,
    totalCount: rows.length,
    query,
    setQuery,
    sortColumn,
    setSortColumn,
    sortDirection,
    setSortDirection,
    filterColumn,
    setFilterColumn,
    filterOperator,
    setFilterOperator,
    filterValue,
    setFilterValue,
    groupColumn,
    setGroupColumn,
    wrap,
    setWrap,
    reset,
    isDirty:
      Boolean(query || filterColumn || groupColumn || wrap) ||
      sortColumn !== initialSortColumn ||
      sortDirection !== initialSortDirection,
    initialSortColumn,
    initialSortDirection,
  };
}

const OPERATORS: Record<TableColumnType, Array<{ value: TableFilterOperator; label: string }>> = {
  text: [
    { value: "contains", label: "contains" },
    { value: "equals", label: "is" },
    { value: "not_equals", label: "is not" },
  ],
  number: [
    { value: "equals", label: "=" },
    { value: "gte", label: "≥" },
    { value: "lte", label: "≤" },
    { value: "not_equals", label: "≠" },
  ],
  date: [
    { value: "equals", label: "on" },
    { value: "gte", label: "on or after" },
    { value: "lte", label: "on or before" },
  ],
  boolean: [
    { value: "equals", label: "is" },
    { value: "not_equals", label: "is not" },
  ],
};

const compactInput = `${inputClass} min-w-[130px] py-1.5`;

export function TableViewControls<Row>({ view, noun = "rows" }: { view: TableViewResult<Row>; noun?: string }) {
  const sortable = view.columns.filter((column) => column.sortable !== false);
  const filterable = view.columns.filter((column) => column.filterable !== false);
  const groupable = view.columns.filter((column) => column.groupable === true);
  const activeFilter = view.columns.find((column) => column.id === view.filterColumn);
  const activeType = activeFilter?.type ?? "text";

  function changeFilterColumn(value: string) {
    view.setFilterColumn(value);
    const type = view.columns.find((column) => column.id === value)?.type ?? "text";
    view.setFilterOperator(defaultFilterOperator(type));
    view.setFilterValue("");
  }

  return (
    <div className="border-b border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="min-w-[190px] flex-[2_1_240px]">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-subtle">Search</span>
          <input
            type="search"
            value={view.query}
            onChange={(event) => view.setQuery(event.target.value)}
            placeholder="Search this table…"
            className={compactInput}
          />
        </label>

        <label className="min-w-[145px] flex-1">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-subtle">Sort by</span>
          <select value={view.sortColumn} onChange={(event) => view.setSortColumn(event.target.value)} className={compactInput}>
            {sortable.map((column) => (
              <option key={column.id} value={column.id}>{column.label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => view.setSortDirection(view.sortDirection === "asc" ? "desc" : "asc")}
          aria-label={`Sort ${view.sortDirection === "asc" ? "descending" : "ascending"}`}
          title={`Currently ${view.sortDirection === "asc" ? "ascending" : "descending"}`}
          className="min-h-9 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-neutral-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {view.sortDirection === "asc" ? "↑ Asc" : "↓ Desc"}
        </button>

        <label className="min-w-[145px] flex-1">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-subtle">Filter by</span>
          <select value={view.filterColumn} onChange={(event) => changeFilterColumn(event.target.value)} className={compactInput}>
            <option value="">No filter</option>
            {filterable.map((column) => (
              <option key={column.id} value={column.id}>{column.label}</option>
            ))}
          </select>
        </label>

        {activeFilter && (
          <>
            <label className="min-w-[110px] flex-1">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-subtle">Condition</span>
              <select
                value={view.filterOperator}
                onChange={(event) => view.setFilterOperator(event.target.value as TableFilterOperator)}
                className={compactInput}
              >
                {OPERATORS[activeType].map((operator) => (
                  <option key={operator.value} value={operator.value}>{operator.label}</option>
                ))}
              </select>
            </label>
            <label className="min-w-[150px] flex-[1.5]">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-subtle">Value</span>
              {activeType === "boolean" ? (
                <select value={view.filterValue} onChange={(event) => view.setFilterValue(event.target.value)} className={compactInput}>
                  <option value="">Choose…</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              ) : (
                <input
                  type={activeType === "number" ? "number" : activeType === "date" ? "date" : "text"}
                  value={view.filterValue}
                  onChange={(event) => view.setFilterValue(event.target.value)}
                  className={compactInput}
                />
              )}
            </label>
          </>
        )}

        <label className="min-w-[145px] flex-1">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-subtle">Group by</span>
          <select value={view.groupColumn} onChange={(event) => view.setGroupColumn(event.target.value)} className={compactInput}>
            <option value="">No grouping</option>
            {groupable.map((column) => (
              <option key={column.id} value={column.id}>{column.label}</option>
            ))}
          </select>
        </label>

        <button
          type="button"
          aria-pressed={view.wrap}
          onClick={() => view.setWrap(!view.wrap)}
          className={`min-h-9 rounded-lg border px-3 py-1.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
            view.wrap ? "border-accent bg-accent-soft text-accent-hover" : "border-line-strong bg-surface text-ink hover:bg-neutral-soft"
          }`}
        >
          Wrap text
        </button>

        <button
          type="button"
          onClick={view.reset}
          disabled={!view.isDirty}
          className="min-h-9 rounded-lg px-2 py-1.5 text-sm font-medium text-accent hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:text-ink-subtle disabled:hover:bg-transparent"
        >
          Reset
        </button>
      </div>
      <p className="mt-2 text-[12px] text-ink-subtle" aria-live="polite">
        Showing {view.visibleRows.length} of {view.totalCount} {noun}
        {view.groupColumn && view.visibleRows.length > 0
          ? ` in ${view.groups.length} group${view.groups.length === 1 ? "" : "s"}`
          : ""}.
      </p>
    </div>
  );
}

export function TableViewport<Row>({ view, children, className = "" }: { view: TableViewResult<Row>; children: ReactNode; className?: string }) {
  return <div className={`overflow-x-auto ${view.wrap ? "table-wrap-enabled" : ""} ${className}`}>{children}</div>;
}

export function TableViewBody<Row>({
  view,
  colSpan,
  renderRow,
  className = "",
  emptyMessage = "No rows match the current table view.",
}: {
  view: TableViewResult<Row>;
  colSpan: number;
  renderRow: (row: Row, index: number) => ReactElement;
  className?: string;
  emptyMessage?: string;
}) {
  let rowIndex = 0;
  return (
    <tbody className={className}>
      {view.visibleRows.length === 0 ? (
        <tr>
          <td colSpan={colSpan} className="px-5 py-8 text-center text-sm text-ink-muted">{emptyMessage}</td>
        </tr>
      ) : (
        view.groups.map((group) => (
          <Fragment key={group.key}>
            {group.label !== null && (
              <tr className="border-y border-line bg-accent-soft/45">
                <th colSpan={colSpan} scope="rowgroup" className="px-4 py-2 text-left text-xs font-medium text-accent-hover">
                  {group.label} <span className="font-normal text-ink-subtle">({group.rows.length})</span>
                </th>
              </tr>
            )}
            {group.rows.map((row) => renderRow(row, rowIndex++))}
          </Fragment>
        ))
      )}
    </tbody>
  );
}
