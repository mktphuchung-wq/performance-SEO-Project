# Đặc tả kỹ thuật: Performance Score (KPI) cho thành viên SEO

**Repo:** `mktphuchung-wq/performance-SEO-Project`
**Đối tượng thực thi:** Claude Code, chạy trực tiếp trong repo local
**Trạng thái:** Sẵn sàng triển khai — đã đối chiếu với schema/code thật của repo (không phải giả định)

---

## 0. Cách đọc tài liệu này (đọc trước khi code)

Tài liệu này được viết sau khi đã **trực tiếp đọc code thật** của repo (migrations, `lib/performance/*`, `lib/repositories/*`, API routes, components). Mọi tên bảng, tên cột, tên hàm, convention nêu dưới đây là **thật**, không phải suy đoán — trừ khi ghi rõ "MỚI" (cần tạo).

Nguyên tắc bắt buộc của repo mà spec này **tuân thủ tuyệt đối**:
1. **Migration chỉ được thêm, không bao giờ phá hủy** (xem `migrations/003_*.sql` comment). Toàn bộ SQL ở mục 3 là `create table if not exists` / `add column if not exists`.
2. **"No Data ≠ 0"** — `null` không bao giờ bị ép thành `0`. Quy tắc này áp dụng xuyên suốt cho Performance Score: thành viên chưa có URL nào đủ điều kiện → `kpi_score = null`, không phải `0`.
3. Trước khi code, Claude Code nên tự chạy lại các lệnh khám phá bên dưới để xác nhận schema hiện tại chưa đổi kể từ khi spec này được viết:
   ```bash
   cat migrations/*.sql
   cat lib/performance/growth.ts lib/performance/refresh.ts lib/performance/aggregate.ts lib/ranges.ts
   cat lib/repositories/rollups.ts lib/repositories/performance-cache.ts lib/repositories/content-urls.ts lib/repositories/project-gsc-properties.ts
   cat app/admin/page.tsx app/admin/members/page.tsx app/admin/projects/page.tsx app/dashboard/page.tsx
   ```
   Nếu có sai khác với spec, **ưu tiên code thật trong repo**, điều chỉnh theo, và ghi chú lại chỗ đã đổi.

**README hiện tại có dòng này** (trong phần Ranges):
> KPI scoring (Quantity / Quality / Final KPI) is intentionally **not** part of this version; it's deferred until Quality has a defined measurement process and Admin-configurable weighting is designed.

Spec này chính là phần **"Admin-configurable weighting"** mà README đang chờ. Sau khi triển khai xong, cập nhật lại đoạn README này (mục 10).

---

## 1. Tóm tắt & Phạm vi

Xây dựng **Performance Score** (0–100, gọi tắt "KPI Score") cho từng **Member** và **Project**, tính từ % Growth (Clicks & Impressions) của các URL họ phụ trách, theo 3 nguyên tắc đã thống nhất:

1. **URL mới (New) không bị tính là "không tăng trưởng"** — loại khỏi mẫu số tính điểm trong thời gian ân hạn (grace period), không cộng cũng không trừ.
2. **Growth đột biến (vd. 1→10 click = +900%) không được làm lệch điểm** — chặn trần điểm số (clamp) + trọng số theo traffic thực (URL traffic thấp có ảnh hưởng thấp lên điểm tổng).
3. **Đơn giản hóa** — tái sử dụng tối đa dữ liệu và trạng thái (`data_status`, `growth_status`) mà pipeline hiện tại **đã tính sẵn**, không gọi thêm GSC API, không thêm state machine mới ngoài mức cần thiết.

**Không nằm trong phạm vi v1:** phần "Quality" (chất lượng nội dung) mà README nhắc tới — spec này chỉ giải quyết phần Quantity/Growth-based score như đã thảo luận.

---

## 2. Quy tắc tính điểm (đã chốt, đơn giản hóa từ thảo luận)

### 2.1. Trạng thái của một URL trong 1 range (chỉ tính cho `last_1_month` / `last_3_months` / `last_6_months` — xem 2.4)

| `score_state` | Điều kiện | Tính vào KPI? |
|---|---|---|
| `excluded` | `content_urls.kpi_excluded = true` (admin loại thủ công — seasonal đã qua mùa, v.v.) | Không |
| `no_data` | `seo_performance_cache.data_status != 'ok'` | Không |
| `new_grace` | `growth_status = 'new_signal'` (chưa có kỳ trước để so sánh) **và** tuổi URL < `new_url_grace_days` | Không — **đây là cơ chế giải quyết mục tiêu 1** |
| `normal` | Còn lại (có đủ dữ liệu kỳ hiện tại + kỳ trước) | **Có** |

> URL mới sau khi qua "grace period" sẽ **tự động** rơi vào `normal` ở kỳ refresh sau, vì lúc đó cache đã có dữ liệu kỳ trước để so sánh — không cần logic đặc biệt nào thêm, không cần bịa số target tuyệt đối.

### 2.2. Công thức điểm cho 1 URL ở trạng thái `normal`

```
coefficient = kpi_settings.coefficient[project.project_type]   # 'new' | 'growth' | 'stable'

click_score       = clamp( 50 + click_growth_pct       / coefficient, 0, 100 )
impression_score  = clamp( 50 + impression_growth_pct  / coefficient, 0, 100 )

score  = click_score * click_weight + impression_score * impression_weight
weight = ( previous_impressions + current_impressions ) / 2
```

- `growth_pct = 0%` → điểm = 50 (đi ngang = trung bình).
- `growth_pct = +900%` (1→10 click) → **bị clamp về 100**, không vượt trần — **giải quyết mục tiêu 2 (phần 1/2)**.
- `weight` dùng **trung bình impression 2 kỳ**, không dùng current đơn thuần — URL vừa nhảy vọt từ traffic gần 0 thì weight cũng gần 0, gần như không ảnh hưởng điểm tổng — **giải quyết mục tiêu 2 (phần 2/2)**.
- `coefficient` theo loại dự án — dự án `stable` cần biên độ hẹp hơn mới đạt điểm tối đa (vì kỳ vọng ít biến động), dự án `growth`/`new` biên độ chuẩn.

### 2.3. Tổng hợp lên Member / Project

```
normal_urls = { url | score_state == 'normal' }
raw_total   = Σ weight(u) for u in normal_urls
cap_value   = (url_weight_cap_pct / 100) * raw_total

capped_weight(u) = min(weight(u), cap_value)     # 1 URL không chiếm quá X% tổng trọng số

kpi_score = Σ [ score(u) * capped_weight(u) ] / Σ capped_weight(u)
```

- Nếu `normal_urls` rỗng → `kpi_score = null` (không phải 0 — đúng nguyên tắc "No Data ≠ 0" của repo).
- Cap trọng số là **single-pass** (không lặp renormalize nhiều vòng) — đơn giản, đủ tốt cho v1, có ghi chú rõ trong code là xấp xỉ.

### 2.4. Range nào được tính điểm

Chỉ `last_1_month`, `last_3_months`, `last_6_months` — vì đây là các range **có kỳ trước để so sánh** (rolling window, xem `lib/ranges.ts`). `all_time` và `custom` **không tính KPI Score** (không có baseline để so growth) — trả về không có bản ghi / `null`, tương tự cách `all_time` đã xử lý `click_delta = null` hiện tại.

### 2.5. Tham số có thể chỉnh (Admin-configurable — bảng `kpi_settings`, xem mục 3)

| Tham số | Default đề xuất | Ý nghĩa |
|---|---|---|
| `coefficient_new` | `1.0` | Biên độ growth cho dự án loại New |
| `coefficient_growth` | `1.0` | Biên độ growth cho dự án loại Growth (±50% growth → điểm 100/0) |
| `coefficient_stable` | `0.3` | Biên độ growth cho dự án loại Stable (±15% growth → điểm 100/0) |
| `new_url_grace_days` | `30` | Số ngày URL mới được miễn tính KPI |
| `click_weight` | `0.7` | Trọng số Click trong điểm blend |
| `impression_weight` | `0.3` | Trọng số Impression trong điểm blend (cộng với click_weight = 1) |
| `url_weight_cap_pct` | `40` | 1 URL tối đa chiếm bao nhiêu % tổng trọng số của member |

> Các số default này là **điểm khởi đầu hợp lý**, không phải số đã được kiểm chứng bằng dữ liệu lịch sử thật — xem mục 12 để xác nhận lại sau khi có vài kỳ dữ liệu thật.

---

## 3. Thay đổi Data Model — `migrations/004_kpi_performance_score.sql` (MỚI)

Chỉ thêm, không sửa/xóa gì trên bảng cũ ngoài `add column if not exists`.

```sql
begin;

-- Mỗi dự án có kỳ vọng tăng trưởng khác nhau, nên hệ số tính điểm đọc theo
-- cột này thay vì dùng chung 1 target cho mọi dự án.
alter table public.project_gsc_properties
  add column if not exists project_type text not null default 'growth'
    check (project_type in ('new', 'growth', 'stable'));

-- Loại trừ THỦ CÔNG (đúng như yêu cầu — không có logic tự động phát hiện
-- seasonal), dùng cho URL holiday/occasion/festival đã qua mùa quá xa.
alter table public.content_urls
  add column if not exists kpi_excluded boolean not null default false,
  add column if not exists kpi_excluded_reason text,
  add column if not exists kpi_excluded_at timestamptz;

-- Bảng config dạng singleton (luôn chỉ có 1 dòng, id = 1) để Admin chỉnh các
-- tham số ở mục 2.5 mà không cần deploy lại. Đây chính là phần
-- "Admin-configurable weighting" mà README đang note là điều kiện để KPI
-- scoring được triển khai.
create table if not exists public.kpi_settings (
  id integer primary key default 1,
  coefficient_new numeric not null default 1,
  coefficient_growth numeric not null default 1,
  coefficient_stable numeric not null default 0.3,
  new_url_grace_days integer not null default 30,
  click_weight numeric not null default 0.7,
  impression_weight numeric not null default 0.3,
  url_weight_cap_pct numeric not null default 40,
  updated_at timestamptz not null default now(),
  constraint kpi_settings_singleton check (id = 1)
);

insert into public.kpi_settings (id) values (1) on conflict (id) do nothing;

-- Điểm số theo từng URL / range — song song với seo_performance_cache,
-- nhưng lưu góc nhìn "đã chấm điểm" thay vì số liệu thô.
create table if not exists public.url_performance_score (
  id uuid primary key default gen_random_uuid(),
  content_url_id uuid not null references public.content_urls(id) on delete cascade,
  range_key text not null,
  start_date date not null,
  end_date date not null,
  project_type text not null,
  score_state text not null
    check (score_state in ('normal', 'new_grace', 'excluded', 'no_data')),
  click_growth_pct numeric,
  impression_growth_pct numeric,
  click_score numeric,
  impression_score numeric,
  score numeric,
  weight numeric not null default 0,
  refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists url_performance_score_url_range_key
  on public.url_performance_score (content_url_id, range_key);
create index if not exists url_performance_score_range_idx
  on public.url_performance_score (range_key);

-- KPI theo Member — song song với member_performance_rollup.
create table if not exists public.member_performance_score (
  id uuid primary key default gen_random_uuid(),
  member_name text not null default '',
  member_email text,
  range_key text not null,
  start_date date not null,
  end_date date not null,
  kpi_score numeric,
  eligible_url_count integer not null default 0,
  normal_url_count integer not null default 0,
  new_grace_url_count integer not null default 0,
  excluded_url_count integer not null default 0,
  no_data_url_count integer not null default 0,
  capped_url_count integer not null default 0,
  total_weight numeric not null default 0,
  refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists member_performance_score_member_range_key
  on public.member_performance_score (member_name, range_key);

-- KPI theo Project — song song với project_performance_rollup, cùng shape
-- với member_performance_score ở trên.
create table if not exists public.project_performance_score (
  id uuid primary key default gen_random_uuid(),
  project text not null default '',
  range_key text not null,
  start_date date not null,
  end_date date not null,
  kpi_score numeric,
  eligible_url_count integer not null default 0,
  normal_url_count integer not null default 0,
  new_grace_url_count integer not null default 0,
  excluded_url_count integer not null default 0,
  no_data_url_count integer not null default 0,
  capped_url_count integer not null default 0,
  total_weight numeric not null default 0,
  refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists project_performance_score_project_range_key
  on public.project_performance_score (project, range_key);

commit;
```

---

## 4. Business logic thuần (MỚI) — `lib/performance/score.ts`

Song song với `lib/performance/growth.ts` (pure functions, không đụng DB), theo đúng phong cách comment giải thích "vì sao" đang có trong repo.

```typescript
export type ProjectType = "new" | "growth" | "stable";
export type ScoreState = "normal" | "new_grace" | "excluded" | "no_data";

export interface KpiSettings {
  coefficient: Record<ProjectType, number>;
  newUrlGraceDays: number;
  clickWeight: number;
  impressionWeight: number;
  urlWeightCapPct: number;
}

export interface UrlScoreInput {
  projectType: ProjectType;
  dataStatus: string;      // seo_performance_cache.data_status
  growthStatus: string;    // seo_performance_cache.growth_status
  kpiExcluded: boolean;    // content_urls.kpi_excluded
  workedAt: string | null; // content_urls.worked_at
  endDate: string;         // range end_date, để tính tuổi URL
  clickGrowthPct: number | null;
  impressionGrowthPct: number | null;
  currentImpressions: number | null;
  previousImpressions: number | null;
}

export interface UrlScoreResult {
  state: ScoreState;
  clickScore: number | null;
  impressionScore: number | null;
  score: number | null; // 0–100, null khi state !== "normal"
  weight: number;        // 0 khi state !== "normal"
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000,
  );
}

/**
 * Quy growth% về thang điểm 0–100 có chặn trần/sàn. 0% growth = điểm 50
 * (baseline). Coefficient quyết định cần tăng trưởng bao nhiêu % để chạm 100.
 * Chính việc clamp là thứ ngăn 1 URL đột biến (vd. 1 → 10 click, +900%) kéo
 * điểm vượt quá mức của bất kỳ URL tăng trưởng vững chắc nào khác — nó chỉ
 * đạt cùng trần 100 như một URL tăng trưởng đáng tin cậy, không hơn.
 */
function clampScore(growthPct: number | null, coefficient: number): number | null {
  if (growthPct === null) return null;
  const raw = 50 + growthPct / coefficient;
  return Math.max(0, Math.min(100, raw));
}

const NOT_SCORED: Omit<UrlScoreResult, "state"> = {
  clickScore: null,
  impressionScore: null,
  score: null,
  weight: 0,
};

/**
 * Chấm điểm 1 URL cho 1 range. Không gọi DB — nhận input đã join sẵn từ
 * repository layer (xem mục 5). "no_data" / "excluded" / "new_grace" đều cho
 * cùng kết quả (không tính điểm) — khác nhau chỉ ở lý do, phục vụ hiển thị
 * minh bạch cho admin, không ảnh hưởng công thức.
 */
export function computeUrlScore(input: UrlScoreInput, settings: KpiSettings): UrlScoreResult {
  if (input.kpiExcluded) {
    return { state: "excluded", ...NOT_SCORED };
  }
  if (input.dataStatus !== "ok") {
    return { state: "no_data", ...NOT_SCORED };
  }
  if (input.growthStatus === "new_signal") {
    // Chưa có kỳ trước để so sánh. Thay vì bịa ra một ngưỡng tuyệt đối để
    // chấm điểm, URL mới đơn giản là KHÔNG được tính (không cộng, không trừ)
    // trong thời gian ân hạn — rồi tự động chuyển sang "normal" ở kỳ sau khi
    // cache đã có đủ dữ liệu kỳ trước để so sánh.
    const age = input.workedAt ? daysBetween(input.workedAt, input.endDate) : 0;
    if (age < settings.newUrlGraceDays) {
      return { state: "new_grace", ...NOT_SCORED };
    }
    return { state: "no_data", ...NOT_SCORED }; // hết ân hạn nhưng vẫn chưa có baseline — hiếm gặp
  }

  const coefficient = settings.coefficient[input.projectType];
  const clickScore = clampScore(input.clickGrowthPct, coefficient);
  const impressionScore = clampScore(input.impressionGrowthPct, coefficient);

  if (clickScore === null && impressionScore === null) {
    return { state: "no_data", ...NOT_SCORED };
  }

  const score =
    clickScore !== null && impressionScore !== null
      ? clickScore * settings.clickWeight + impressionScore * settings.impressionWeight
      : (clickScore ?? impressionScore)!;

  const weight = (Number(input.previousImpressions ?? 0) + Number(input.currentImpressions ?? 0)) / 2;

  return { state: "normal", clickScore, impressionScore, score, weight };
}

export interface ScoreAggregate {
  kpiScore: number | null;
  eligibleUrlCount: number;
  normalUrlCount: number;
  newGraceUrlCount: number;
  excludedUrlCount: number;
  noDataUrlCount: number;
  cappedUrlCount: number;
  totalWeight: number;
}

/**
 * Trung bình có trọng số của các URL "normal", với trần trọng số per-URL để
 * 1 URL không thể áp đảo điểm của member/project (rủi ro tương tự việc clamp
 * xử lý cho 1 URL đột biến, nhưng ở phía trọng số: vd. member có 2 URL mà 1
 * URL chiếm 95% traffic).
 *
 * Cap là single-pass (không lặp renormalize nhiều vòng) — đơn giản, đủ dùng
 * cho v1. Trường hợp hiếm (rất ít URL, chênh lệch traffic cực lớn) có thể lệch
 * nhẹ so với cap lý tưởng; chấp nhận được, ghi rõ ở đây để không ai ngỡ ngàng.
 */
export function aggregateScore(results: UrlScoreResult[], urlWeightCapPct: number): ScoreAggregate {
  const normal = results.filter((r) => r.state === "normal");
  const counts = {
    eligibleUrlCount: normal.length,
    normalUrlCount: normal.length,
    newGraceUrlCount: results.filter((r) => r.state === "new_grace").length,
    excludedUrlCount: results.filter((r) => r.state === "excluded").length,
    noDataUrlCount: results.filter((r) => r.state === "no_data").length,
  };

  if (normal.length === 0) {
    return { kpiScore: null, ...counts, cappedUrlCount: 0, totalWeight: 0 };
  }

  const rawTotal = normal.reduce((sum, r) => sum + r.weight, 0);
  const capValue = rawTotal > 0 ? (urlWeightCapPct / 100) * rawTotal : 0;

  let cappedUrlCount = 0;
  const cappedWeights = normal.map((r) => {
    if (capValue > 0 && r.weight > capValue) {
      cappedUrlCount += 1;
      return capValue;
    }
    return r.weight;
  });

  const totalWeight = cappedWeights.reduce((a, b) => a + b, 0);
  const kpiScore =
    totalWeight > 0
      ? normal.reduce((sum, r, i) => sum + (r.score ?? 0) * cappedWeights[i], 0) / totalWeight
      : normal.reduce((sum, r) => sum + (r.score ?? 0), 0) / normal.length; // fallback: mọi weight = 0

  return {
    kpiScore: Math.max(0, Math.min(100, kpiScore)),
    ...counts,
    cappedUrlCount,
    totalWeight,
  };
}
```

---

## 5. Repository layer (MỚI)

Mirror chính xác 2 file đã có: `lib/repositories/rollups.ts` (upsert + list, `on conflict ... do update`) và `lib/repositories/performance-cache.ts` (query join với `content_urls`). Tạo 3 file mới:

### 5.1. `lib/repositories/kpi-settings.ts`

```typescript
import { query, queryOne } from "@/lib/db";
import type { KpiSettings } from "@/lib/performance/score";

interface KpiSettingsRow {
  coefficient_new: number;
  coefficient_growth: number;
  coefficient_stable: number;
  new_url_grace_days: number;
  click_weight: number;
  impression_weight: number;
  url_weight_cap_pct: number;
}

export async function getKpiSettings(): Promise<KpiSettings> {
  const row = await queryOne<KpiSettingsRow>("select * from public.kpi_settings where id = 1");
  if (!row) throw new Error("kpi_settings row missing — did migration 004 run?");
  return {
    coefficient: { new: row.coefficient_new, growth: row.coefficient_growth, stable: row.coefficient_stable },
    newUrlGraceDays: row.new_url_grace_days,
    clickWeight: row.click_weight,
    impressionWeight: row.impression_weight,
    urlWeightCapPct: row.url_weight_cap_pct,
  };
}

export async function updateKpiSettings(input: Partial<KpiSettingsRow>): Promise<void> {
  // Xây UPDATE động chỉ trên các field được truyền vào — theo đúng tinh thần
  // "chỉ thêm/chỉnh cái cần", giữ các field khác nguyên giá trị hiện tại.
  const entries = Object.entries(input).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const setClause = entries.map(([key], i) => `${key} = $${i + 1}`).join(", ");
  const values = entries.map(([, v]) => v);
  await query(`update public.kpi_settings set ${setClause}, updated_at = now() where id = 1`, values);
}
```

### 5.2. `lib/repositories/url-performance-score.ts`

```typescript
import { query } from "@/lib/db";
import type { UrlScoreResult } from "@/lib/performance/score";
import type { RangeKey } from "@/lib/ranges";

export interface ScoringInputRow {
  content_url_id: string;
  project: string;
  member_name: string;
  member_email: string | null;
  worked_at: string | null;
  kpi_excluded: boolean;
  project_type: "new" | "growth" | "stable";
  data_status: string;
  growth_status: string;
  click_growth_pct: number | null;
  impression_growth_pct: number | null;
  current_impressions: number | null;
  previous_impressions: number | null;
}

/** Input thô cho việc chấm điểm — join content_urls + project_gsc_properties
 *  vào đúng seo_performance_cache đã có sẵn của range này. Không gọi GSC. */
export async function getScoringInputRowsForRange(rangeKey: RangeKey): Promise<ScoringInputRow[]> {
  return query<ScoringInputRow>(
    `select c.id as content_url_id, c.project, c.member_name, c.member_email,
            c.worked_at, c.kpi_excluded,
            coalesce(pgp.project_type, 'growth') as project_type,
            p.data_status, p.growth_status,
            p.click_growth_pct, p.impression_growth_pct,
            p.impressions as current_impressions, p.previous_impressions
     from public.seo_performance_cache p
     join public.content_urls c on c.id = p.content_url_id
     left join public.project_gsc_properties pgp on pgp.project = c.project
     where p.range_key = $1 and c.is_active = true`,
    [rangeKey],
  );
}

export interface UpsertUrlScoreInput {
  contentUrlId: string;
  rangeKey: RangeKey;
  startDate: string;
  endDate: string;
  projectType: string;
  result: UrlScoreResult;
}

export async function upsertUrlPerformanceScore(input: UpsertUrlScoreInput): Promise<void> {
  const r = input.result;
  await query(
    `insert into public.url_performance_score
       (content_url_id, range_key, start_date, end_date, project_type, score_state,
        click_score, impression_score, score, weight, refreshed_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), now())
     on conflict (content_url_id, range_key) do update set
       start_date = excluded.start_date,
       end_date = excluded.end_date,
       project_type = excluded.project_type,
       score_state = excluded.score_state,
       click_score = excluded.click_score,
       impression_score = excluded.impression_score,
       score = excluded.score,
       weight = excluded.weight,
       refreshed_at = now(),
       updated_at = now()`,
    [
      input.contentUrlId, input.rangeKey, input.startDate, input.endDate, input.projectType,
      r.state, r.clickScore, r.impressionScore, r.score, r.weight,
    ],
  );
}

export interface UrlScoreDisplayRow {
  content_url_id: string;
  url: string;
  project: string;
  member_name: string;
  score_state: string;
  score: number | null;
  click_score: number | null;
  impression_score: number | null;
  weight: number;
}

/** Bảng chi tiết cho admin — để trả lời "vì sao URL này ra điểm này". */
export async function listUrlScores(
  rangeKey: RangeKey,
  filters: { project?: string; memberName?: string },
): Promise<UrlScoreDisplayRow[]> {
  const conditions = ["c.is_active = true", "s.range_key = $1"];
  const params: unknown[] = [rangeKey];
  if (filters.project) { params.push(filters.project); conditions.push(`c.project = $${params.length}`); }
  if (filters.memberName) { params.push(filters.memberName); conditions.push(`c.member_name = $${params.length}`); }

  return query<UrlScoreDisplayRow>(
    `select s.content_url_id, c.url, c.project, c.member_name,
            s.score_state, s.score, s.click_score, s.impression_score, s.weight
     from public.url_performance_score s
     join public.content_urls c on c.id = s.content_url_id
     where ${conditions.join(" and ")}
     order by s.score desc nulls last`,
    params,
  );
}
```

### 5.3. `lib/repositories/kpi-score-rollups.ts`

Mirror `rollups.ts` — 1 file xử lý cả Member và Project (đúng như file gốc đang gộp chung).

```typescript
import { query } from "@/lib/db";
import type { ScoreAggregate } from "@/lib/performance/score";
import type { RangeKey } from "@/lib/ranges";

export interface UpsertScoreRollupInput extends ScoreAggregate {
  key: string; // member_name hoặc project
  rangeKey: RangeKey;
  startDate: string;
  endDate: string;
}

export async function upsertMemberScore(memberEmail: string | null, input: UpsertScoreRollupInput): Promise<void> {
  await query(
    `insert into public.member_performance_score
       (member_name, member_email, range_key, start_date, end_date, kpi_score,
        eligible_url_count, normal_url_count, new_grace_url_count, excluded_url_count,
        no_data_url_count, capped_url_count, total_weight, refreshed_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now(), now())
     on conflict (member_name, range_key) do update set
       member_email = excluded.member_email,
       start_date = excluded.start_date, end_date = excluded.end_date,
       kpi_score = excluded.kpi_score,
       eligible_url_count = excluded.eligible_url_count,
       normal_url_count = excluded.normal_url_count,
       new_grace_url_count = excluded.new_grace_url_count,
       excluded_url_count = excluded.excluded_url_count,
       no_data_url_count = excluded.no_data_url_count,
       capped_url_count = excluded.capped_url_count,
       total_weight = excluded.total_weight,
       refreshed_at = now(), updated_at = now()`,
    [
      input.key, memberEmail, input.rangeKey, input.startDate, input.endDate, input.kpiScore,
      input.eligibleUrlCount, input.normalUrlCount, input.newGraceUrlCount, input.excludedUrlCount,
      input.noDataUrlCount, input.cappedUrlCount, input.totalWeight,
    ],
  );
}

// upsertProjectScore: cùng shape, insert vào public.project_performance_score,
// on conflict (project, range_key) — không có member_email. Mirror y hệt trên.

export interface MemberScoreRow extends ScoreAggregate {
  member_name: string;
  member_email: string | null;
  range_key: string;
  refreshed_at: string;
}

export async function listMemberScores(rangeKey: RangeKey): Promise<MemberScoreRow[]> {
  return query<MemberScoreRow>(
    "select * from public.member_performance_score where range_key = $1 order by kpi_score desc nulls last",
    [rangeKey],
  );
}

export async function getMemberScoreByEmail(email: string, rangeKey: RangeKey): Promise<MemberScoreRow | null> {
  const rows = await query<MemberScoreRow>(
    "select * from public.member_performance_score where range_key = $1 and lower(member_email) = lower($2)",
    [rangeKey, email],
  );
  return rows[0] ?? null;
}

// listProjectScores: cùng pattern, đọc từ project_performance_score.
```

> Ghi chú cho Claude Code: phần `upsertProjectScore` / `listProjectScores` chỉ nêu tắt ở trên vì **giống hệt cấu trúc** phần Member — hãy viết đầy đủ theo đúng cách `rollups.ts` đã làm cho `project_performance_rollup` (đọc file đó để copy pattern chính xác).

---

## 6. Tích hợp vào refresh pipeline — sửa `lib/performance/refresh.ts`

### 6.1. Thêm export nhỏ vào `lib/ranges.ts`

`ROLLING_MONTHS` hiện là const nội bộ chưa export. Thêm 1 hàm export (thuần thêm, không sửa gì khác):

```typescript
/** true cho các range có kỳ trước để so sánh (1M/3M/6M) — false cho all_time/custom. */
export function isRollingRange(rangeKey: RangeKey): boolean {
  return rangeKey === "last_1_month" || rangeKey === "last_3_months" || rangeKey === "last_6_months";
}
```

### 6.2. Sửa `maybeFinishRun` trong `refresh.ts`

Vị trí hiện tại:
```typescript
async function maybeFinishRun(run: RefreshRun): Promise<void> {
  if (run.status === "running" && run.pending_content_url_ids.length === 0) {
    await computeAndStoreRollups(run.range_key as RangeKey, run.start_date, run.end_date);
    await finishRefreshRun(run.id, "success");
  }
}
```

Đổi thành:
```typescript
async function maybeFinishRun(run: RefreshRun): Promise<void> {
  if (run.status === "running" && run.pending_content_url_ids.length === 0) {
    const rangeKey = run.range_key as RangeKey;
    await computeAndStoreRollups(rangeKey, run.start_date, run.end_date);
    if (isRollingRange(rangeKey)) {
      await computeAndStoreScores(rangeKey, run.start_date, run.end_date);
    }
    await finishRefreshRun(run.id, "success");
  }
}
```

### 6.3. Thêm hàm `computeAndStoreScores` (đặt ngay dưới `computeAndStoreRollups` trong cùng file, cùng phong cách)

```typescript
export async function computeAndStoreScores(rangeKey: RangeKey, startDate: string, endDate: string): Promise<void> {
  const settings = await getKpiSettings();
  const rows = await getScoringInputRowsForRange(rangeKey);

  const scored = rows.map((row) => ({
    row,
    result: computeUrlScore(
      {
        projectType: row.project_type,
        dataStatus: row.data_status,
        growthStatus: row.growth_status,
        kpiExcluded: row.kpi_excluded,
        workedAt: row.worked_at,
        endDate,
        clickGrowthPct: row.click_growth_pct,
        impressionGrowthPct: row.impression_growth_pct,
        currentImpressions: row.current_impressions,
        previousImpressions: row.previous_impressions,
      },
      settings,
    ),
  }));

  for (const { row, result } of scored) {
    await upsertUrlPerformanceScore({
      contentUrlId: row.content_url_id,
      rangeKey, startDate, endDate,
      projectType: row.project_type,
      result,
    });
  }

  // Group theo member/project — cùng pattern Map đang dùng trong computeAndStoreRollups ở trên.
  const byMember = new Map<string, typeof scored>();
  const byProject = new Map<string, typeof scored>();
  for (const item of scored) {
    const memberKey = item.row.member_name || "(unassigned)";
    const projectKey = item.row.project || "(unassigned)";
    if (!byMember.has(memberKey)) byMember.set(memberKey, []);
    if (!byProject.has(projectKey)) byProject.set(projectKey, []);
    byMember.get(memberKey)!.push(item);
    byProject.get(projectKey)!.push(item);
  }

  for (const [memberName, items] of byMember) {
    const aggregate = aggregateScore(items.map((i) => i.result), settings.urlWeightCapPct);
    const email = items.find((i) => i.row.member_email)?.row.member_email ?? null;
    await upsertMemberScore(email, { key: memberName, rangeKey, startDate, endDate, ...aggregate });
  }

  for (const [project, items] of byProject) {
    const aggregate = aggregateScore(items.map((i) => i.result), settings.urlWeightCapPct);
    await upsertProjectScore({ key: project, rangeKey, startDate, endDate, ...aggregate });
  }
}
```

(Nhớ thêm các import mới ở đầu file: `computeUrlScore`, `aggregateScore` từ `./score`; `getKpiSettings` từ `@/lib/repositories/kpi-settings`; `getScoringInputRowsForRange`, `upsertUrlPerformanceScore` từ `@/lib/repositories/url-performance-score`; `upsertMemberScore`, `upsertProjectScore` từ `@/lib/repositories/kpi-score-rollups`; `isRollingRange` từ `@/lib/ranges`.)

### 6.4. Tính năng phụ (nên có, không bắt buộc v1): Recompute không cần GSC

Vì `computeAndStoreScores` chỉ đọc từ cache đã có (`seo_performance_cache`) — **không gọi GSC API** — nên có thể expose một action riêng để admin bấm "Recompute scores" ngay sau khi đổi `project_type`, `kpi_excluded`, hoặc `kpi_settings`, mà không cần chờ 1 lượt refresh đầy đủ (vốn tốn thời gian vì gọi GSC theo batch 20 URL/lần). Xem endpoint ở mục 7.6.

---

## 7. API routes

Tất cả route admin nằm dưới `/api/admin/**` đã tự động được `proxy.ts` chặn non-admin (xem `adminPathPrefixes` trong `proxy.ts`) — **không cần tự check `session.user.isAdmin` trong các route mới này**, y hệt các route admin hiện có.

| Method | Path | Việc | Ghi chú |
|---|---|---|---|
| `GET` | `/api/me/kpi?range=` | KPI Score của member đang đăng nhập | Mirror `/api/me/performance` |
| `GET` | `/api/admin/kpi/members?range=` | Leaderboard KPI theo member | Mirror `/api/admin/members` |
| `GET` | `/api/admin/kpi/projects?range=` | Leaderboard KPI theo project | Mirror `/api/admin/projects` |
| `GET` | `/api/admin/kpi/urls?range=&project=&member=` | Chi tiết điểm từng URL (debug/minh bạch) | Mirror `/api/admin/urls` |
| `GET` | `/api/admin/kpi-settings` | Đọc config hiện tại | (MỚI) |
| `POST` | `/api/admin/kpi-settings` | Cập nhật config | Body: các field trong bảng mục 2.5, tất cả optional |
| `PATCH` | `/api/admin/urls/[id]` | Bật/tắt `kpi_excluded` cho 1 URL | (MỚI, dynamic route — repo đã có tiền lệ `app/dashboard/url/[id]/page.tsx`) |
| `POST` | `/api/admin/kpi/recompute` | Tính lại điểm cho cả 3 range rolling, không gọi GSC | Optional, mục 6.4 |

### 7.1. `GET /api/me/kpi/route.ts`

```typescript
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getMemberScoreByEmail } from "@/lib/repositories/kpi-score-rollups";
import { DEFAULT_RANGE_KEY, type RangeKey } from "@/lib/ranges";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const rangeKey = (searchParams.get("range") as RangeKey) || DEFAULT_RANGE_KEY;
  const score = await getMemberScoreByEmail(session.user.email, rangeKey);
  return NextResponse.json({ score });
}
```

### 7.2–7.4. Các route `GET /api/admin/kpi/*`

Mirror `app/api/admin/urls/route.ts` — parse `range`/`project`/`member` từ query, gọi repository tương ứng, trả `NextResponse.json({ rows })`.

### 7.5. `app/api/admin/kpi-settings/route.ts`

```typescript
import { NextResponse } from "next/server";
import { getKpiSettings, updateKpiSettings } from "@/lib/repositories/kpi-settings";

export async function GET() {
  return NextResponse.json({ settings: await getKpiSettings() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  // Validate: coefficients > 0, weights trong [0,1] và cộng lại = 1, cap trong (0,100], grace >= 0.
  // Trả 400 với message rõ ràng nếu sai — theo đúng phong cách validate đang có
  // trong app/api/admin/project-gsc-properties/route.ts.
  await updateKpiSettings(body);
  return NextResponse.json({ ok: true });
}
```

### 7.6. `app/api/admin/urls/[id]/route.ts` (MỚI, dynamic route)

```typescript
import { NextResponse } from "next/server";
import { setKpiExclusion } from "@/lib/repositories/content-urls"; // hàm mới, xem dưới

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const kpiExcluded = Boolean(body.kpiExcluded);
  const reason = body.reason ? String(body.reason) : null;
  await setKpiExclusion(params.id, kpiExcluded, reason);
  return NextResponse.json({ ok: true });
}
```

Thêm vào `lib/repositories/content-urls.ts`:
```typescript
export async function setKpiExclusion(id: string, excluded: boolean, reason: string | null): Promise<void> {
  await query(
    `update public.content_urls
     set kpi_excluded = $2, kpi_excluded_reason = $3,
         kpi_excluded_at = case when $2 then now() else null end,
         updated_at = now()
     where id = $1`,
    [id, excluded, reason],
  );
}
```

### 7.7. Mở rộng `POST /api/admin/project-gsc-properties` để nhận `projectType`

Sửa `app/api/admin/project-gsc-properties/route.ts`: thêm `const projectType = body.projectType ? String(body.projectType) : "growth";`, truyền vào `upsertProjectGscProperty(project, gscProperty, notes, projectType)`. Sửa `lib/repositories/project-gsc-properties.ts` để `upsertProjectGscProperty` nhận thêm tham số `projectType` và đưa vào câu `insert ... on conflict ... do update set project_type = excluded.project_type`.

---

## 8. UI

### 8.1. `lib/format.ts` — thêm (không sửa gì cũ)

```typescript
export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return Math.round(value).toString();
}

export const SCORE_STATE_LABELS: Record<string, string> = {
  normal: "Scored",
  new_grace: "New (grace period)",
  excluded: "Excluded",
  no_data: "No data",
};
```

### 8.2. Dashboard thành viên — `app/dashboard/page.tsx`

Thêm 1 lệnh `fetch(\`/api/me/kpi?range=${range}\`)` song song với 2 fetch hiện có, thêm 1 `StatCard`:
```tsx
<StatCard
  label="KPI Score"
  value={formatScore(score?.kpi_score)}
  sub={score ? `${score.normal_url_count} scored · ${score.new_grace_url_count} new · ${score.excluded_url_count} excluded` : undefined}
/>
```
Đặt cạnh các StatCard hiện có (Clicks/Impressions/CTR).

### 8.3. Admin Overview — `app/admin/page.tsx`

Thêm 1 `StatCard` "Avg KPI Score" (trung bình `kpi_score` non-null của toàn team) vào grid StatCard hiện có.

### 8.4. Bảng leaderboard KPI (component MỚI) — `components/KpiScoreTable.tsx`

**Không sửa `RollupTable.tsx` hiện có** — tạo component riêng để không ảnh hưởng 2 nơi đang dùng nó (giữ đúng tinh thần "chỉ thêm" của repo, áp dụng cả cho code chứ không riêng migration). Cột: Rank, Member/Project, KPI Score (badge màu theo mức: ≥80 `positive`, 50–79 `accent`, <50 `negative`, dùng `Badge` có sẵn trong `components/ui.tsx`), Scored URLs, New (grace), Excluded, No data, Capped.

Gắn vào `app/admin/members/page.tsx` và `app/admin/projects/page.tsx` (đọc trước 2 file này để theo đúng pattern fetch/filter đang có ở đó, tương tự `app/admin/urls/page.tsx`).

### 8.5. Admin Settings — `app/admin/settings/page.tsx`

- Thêm dropdown **Project Type** (`new` / `growth` / `stable`) vào ngay form đang có cho `project_gsc_properties` (phần map project ↔ GSC property).
- Thêm 1 `Card` mới "KPI Settings" — form chỉnh 7 tham số ở mục 2.5, gọi `GET`/`POST /api/admin/kpi-settings`. Theo đúng pattern `useState` + `useEffect` fetch + `Field`/`inputClass` đang dùng trong file này.

### 8.6. Admin URLs — `app/admin/urls/page.tsx`

Thêm cột "KPI" vào bảng (hoặc thêm prop `showKpiColumn` cho `PerformanceTable`) — hiển thị badge Excluded/toggle, gọi `PATCH /api/admin/urls/[id]` khi admin bật/tắt loại trừ, có ô nhập lý do ngắn.

---

## 9. Cập nhật README

Sửa đoạn trong README hiện đang ghi:
> KPI scoring (Quantity / Quality / Final KPI) is intentionally **not** part of this version; it's deferred until Quality has a defined measurement process and Admin-configurable weighting is designed.

Thành (giữ nguyên giọng văn kỹ thuật, súc tích của README gốc):
> **Performance Score (KPI)** is now computed per Member and per Project from Clicks/Impressions growth, scoped to `last_1_month` / `last_3_months` / `last_6_months` (ranges with a comparable previous period). New URLs are excluded during a grace period rather than scored as flat, per-URL growth is clamped to a 0–100 band before aggregation, and aggregation weights by traffic with a per-URL cap — see `lib/performance/score.ts`. Weighting, coefficients, and the grace period are Admin-configurable under **Admin → Settings**. A **Quality** dimension is still deferred.

---

## 10. Kịch bản kiểm thử (Claude Code tự verify trước khi báo xong)

Bắt buộc chạy `npm run typecheck` và `npm run lint` sạch trước khi coi là hoàn thành. Ngoài ra, verify bằng dữ liệu thật hoặc seed thủ công các case sau trong `seo_performance_cache`/`content_urls`:

1. **Mục tiêu 1 — URL mới không bị phạt:** 1 member có 3 URL, trong đó 2 URL `worked_at` = hôm qua (chưa có kỳ trước, `growth_status='new_signal'`) và 1 URL bình thường tăng 20%. → Kỳ vọng: `member_performance_score.new_grace_url_count = 2`, `kpi_score` chỉ phản ánh URL còn lại (≈ điểm của riêng URL đó, không bị kéo xuống bởi 2 URL kia).
2. **Mục tiêu 2 — Growth đột biến bị chặn:** 1 URL từ 1→10 click (previous_impressions=5, current_impressions=8), 1 URL khác previous_impressions=5000, current_impressions=5200, tăng 30% click bình thường. → Kỳ vọng: `url_performance_score.score` của URL đột biến = 100 (clamp), nhưng `weight` của nó rất nhỏ so với URL kia; `kpi_score` tổng của member gần với điểm của URL traffic lớn, **không** bị kéo lên gần 100 chỉ vì 1 URL nhỏ.
3. **`all_time` không tính điểm:** chạy refresh cho `all_time` → không có dòng nào được ghi vào `url_performance_score`/`member_performance_score` cho `range_key='all_time'` (không lỗi, chỉ đơn giản là skip).
4. **Không eligible URL nào:** member chỉ có URL `excluded`/`no_data` → `kpi_score = null` trong DB và UI hiển thị "—", không phải "0".
5. **Loại trừ thủ công:** admin bật `kpi_excluded` cho 1 URL đang có `score_state='normal'`, gọi lại refresh (hoặc recompute) → URL đó chuyển sang `excluded`, biến mất khỏi mẫu số, `kpi_score` của member đổi theo đúng logic (không còn URL đó trong tổng trọng số).
6. **Đổi `project_type`:** đổi 1 project từ `growth` sang `stable`, recompute → coefficient nhỏ hơn (0.3 thay vì 1.0) khiến cùng 1 mức growth% cho điểm cao hơn hoặc thấp hơn đúng theo công thức — verify bằng tay 1 URL cụ thể.

---

## 11. Trình tự triển khai đề xuất cho Claude Code

1. Đọc lại các file ở mục 0 để xác nhận schema/convention chưa đổi.
2. Viết `migrations/004_kpi_performance_score.sql`, chạy `npm run migrate` cục bộ, kiểm tra `\d` các bảng mới trong Postgres.
3. Viết `lib/performance/score.ts` (thuần, không DB) — có thể viết unit test nhỏ ngay tại đây nếu repo có setup test (kiểm tra repo có Jest/Vitest không; nếu không có, bỏ qua, không tự ý thêm framework test mới ngoài phạm vi yêu cầu).
4. Viết 3 file repository ở mục 5.
5. Sửa `lib/ranges.ts` (thêm `isRollingRange`) và `lib/performance/refresh.ts` (mục 6).
6. Viết các API routes ở mục 7.
7. Làm UI ở mục 8, theo đúng thứ tự: format.ts → dashboard → admin overview → KpiScoreTable → admin members/projects pages → admin settings → admin urls.
8. Cập nhật README (mục 9).
9. Chạy hết checklist mục 10 bằng dữ liệu thật hoặc seed tay.
10. `npm run typecheck && npm run lint` sạch.

---

## 12. Quyết định cần xác nhận lại (không phải lỗi thiết kế — chỉ là số chưa có dữ liệu lịch sử để chốt)

| # | Vấn đề | Default trong spec | Khi nào nên xem lại |
|---|---|---|---|
| 1 | `coefficient_growth=1.0`, `coefficient_stable=0.3` | Biên độ ±50%/±15% | Sau 1–2 kỳ dữ liệu thật, xem phân phối growth% thực tế theo từng loại dự án có khớp kỳ vọng "điểm 50 là trung vị" không |
| 2 | `new_url_grace_days=30` | 1 tháng | Tùy chu kỳ index thực tế của site — nếu SEO cần lâu hơn để lên top, tăng số này |
| 3 | `click_weight=0.7 / impression_weight=0.3` | Ưu tiên Click hơn Impression | Xác nhận đúng độ ưu tiên kinh doanh — nếu Impression (độ phủ) cũng quan trọng ngang Click thì đổi về 0.5/0.5 |
| 4 | `url_weight_cap_pct=40` | 1 URL tối đa 40% trọng số | Với member có rất ít URL (1–2 URL), cap này gần như vô hiệu — chấp nhận được ở v1 |
| 5 | Project-level KPI (mục 3, `project_performance_score`) | Đã đưa vào schema đầy đủ | Nếu muốn ship nhanh hơn, có thể **bỏ qua phần UI** cho Project KPI ở v1 (chỉ làm Member), vẫn tính và lưu DB sẵn để bật UI sau mà không cần đổi schema |
| 6 | Auto-recompute khi đổi `project_type`/`kpi_excluded`/`kpi_settings` (mục 6.4) | Nêu là "nên có", không bắt buộc | Nếu muốn UX tức thời, gọi `computeAndStoreScores` cho cả 3 range ngay trong các route PATCH/POST tương ứng thay vì chờ nút "Recompute" riêng |

---

## 13. Prompt gợi ý để bàn giao cho Claude Code

```
Đọc file PERFORMANCE_SCORE_SPEC.md ở gốc repo. Trước khi code, hãy tự chạy lại
các lệnh khám phá ở mục 0 để xác nhận schema/convention thật khớp với spec.
Nếu có khác biệt, ưu tiên code thật trong repo, điều chỉnh theo, và nêu rõ chỗ
đã đổi so với spec khi báo cáo lại.

Triển khai theo đúng thứ tự ở mục 11. Giữ đúng 2 nguyên tắc cứng của repo:
(1) migration chỉ thêm, không phá hủy; (2) "No Data ≠ 0" — không bao giờ ép
null thành 0 ở bất kỳ tầng nào (DB, business logic, UI).

Sau khi xong, chạy hết checklist ở mục 10 và dán kết quả (số liệu thật hoặc
mô tả case đã test) vào báo cáo cuối cùng.
```
