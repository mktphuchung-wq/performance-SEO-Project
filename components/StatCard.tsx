export function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white border rounded-lg p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="text-2xl font-semibold text-slate-900 mt-1">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}
