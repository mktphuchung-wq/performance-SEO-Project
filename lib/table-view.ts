export type TableValue = string | number | boolean | Date | null | undefined;

export type TableColumnType = "text" | "number" | "date" | "boolean";

export interface TableColumn<Row> {
  id: string;
  label: string;
  value: (row: Row) => TableValue;
  type?: TableColumnType;
  sortable?: boolean;
  filterable?: boolean;
  groupable?: boolean;
  searchable?: boolean;
  groupLabel?: (value: TableValue) => string;
}

export type TableFilterOperator = "contains" | "equals" | "not_equals" | "gte" | "lte";

export interface TableViewState {
  query: string;
  sortColumn: string;
  sortDirection: "asc" | "desc";
  filterColumn: string;
  filterOperator: TableFilterOperator;
  filterValue: string;
  groupColumn: string;
}

export interface TableGroup<Row> {
  key: string;
  label: string | null;
  rows: Row[];
}

const collator = new Intl.Collator("vi", { numeric: true, sensitivity: "base" });

function normalized(value: TableValue): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLocaleLowerCase("vi")
    .trim();
}

function isEmpty(value: TableValue): boolean {
  return value === null || value === undefined || value === "";
}

function comparable(value: TableValue, type: TableColumnType): string | number | boolean | null {
  if (isEmpty(value)) return null;
  if (type === "number") {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  if (type === "date") {
    const timestamp = value instanceof Date ? value.getTime() : Date.parse(String(value));
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (type === "boolean") return Boolean(value);
  return normalized(value);
}

function compareValues(
  a: TableValue,
  b: TableValue,
  type: TableColumnType,
  direction: "asc" | "desc",
): number {
  const left = comparable(a, type);
  const right = comparable(b, type);
  if (left === null && right === null) return 0;
  // Missing data is not zero and never outranks a real value.
  if (left === null) return 1;
  if (right === null) return -1;
  if (typeof left === "string" && typeof right === "string") {
    const compared = collator.compare(left, right);
    return direction === "asc" ? compared : -compared;
  }
  if (left === right) return 0;
  const compared = left < right ? -1 : 1;
  return direction === "asc" ? compared : -compared;
}

export function defaultFilterOperator(type: TableColumnType = "text"): TableFilterOperator {
  return type === "text" ? "contains" : "equals";
}

function matchesFilter<Row>(row: Row, column: TableColumn<Row>, operator: TableFilterOperator, raw: string): boolean {
  if (!raw.trim()) return true;
  const type = column.type ?? "text";
  const value = column.value(row);

  if (type === "text") {
    const actual = normalized(value);
    const expected = normalized(raw);
    if (operator === "not_equals") return actual !== expected;
    if (operator === "equals") return actual === expected;
    return actual.includes(expected);
  }

  if (type === "boolean") {
    const expected = raw === "true";
    const actual = Boolean(value);
    return operator === "not_equals" ? actual !== expected : actual === expected;
  }

  const actual = comparable(value, type);
  const expected = comparable(raw, type);
  if (actual === null || expected === null) return false;
  if (operator === "gte") return actual >= expected;
  if (operator === "lte") return actual <= expected;
  if (operator === "not_equals") return actual !== expected;
  return actual === expected;
}

function groupValue<Row>(row: Row, column: TableColumn<Row>): { key: string; label: string } {
  const raw = column.value(row);
  if (isEmpty(raw)) return { key: "__empty__", label: "No value" };
  return {
    key: `${typeof raw}:${String(raw)}`,
    label: column.groupLabel?.(raw) ?? String(raw),
  };
}

export function deriveTableView<Row>(
  sourceRows: Row[],
  columns: TableColumn<Row>[],
  state: TableViewState,
): { groups: TableGroup<Row>[]; visibleRows: Row[] } {
  const searchable = columns.filter((column) => column.searchable !== false);
  const needle = normalized(state.query);
  const filterColumn = columns.find((column) => column.id === state.filterColumn);
  const sortColumn = columns.find((column) => column.id === state.sortColumn);
  const groupingColumn = columns.find((column) => column.id === state.groupColumn);

  const visibleRows = sourceRows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !needle || searchable.some((column) => normalized(column.value(row)).includes(needle)))
    .filter(({ row }) => !filterColumn || matchesFilter(row, filterColumn, state.filterOperator, state.filterValue))
    .sort((a, b) => {
      if (!sortColumn) return a.index - b.index;
      const compared = compareValues(
        sortColumn.value(a.row),
        sortColumn.value(b.row),
        sortColumn.type ?? "text",
        state.sortDirection,
      );
      if (compared === 0) return a.index - b.index;
      return compared;
    })
    .map(({ row }) => row);

  if (!groupingColumn) {
    return { visibleRows, groups: [{ key: "__all__", label: null, rows: visibleRows }] };
  }

  const grouped = new Map<string, TableGroup<Row>>();
  for (const row of visibleRows) {
    const group = groupValue(row, groupingColumn);
    const existing = grouped.get(group.key);
    if (existing) existing.rows.push(row);
    else grouped.set(group.key, { key: group.key, label: group.label, rows: [row] });
  }

  const groups = [...grouped.values()].sort((a, b) => collator.compare(a.label ?? "", b.label ?? ""));
  return { visibleRows, groups };
}
