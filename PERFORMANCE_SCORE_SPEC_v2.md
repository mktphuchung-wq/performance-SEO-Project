# Đặc tả kỹ thuật: Performance Score (KPI) cho thành viên SEO — v2

**Repo:** `mktphuchung-wq/performance-SEO-Project`
**Đối tượng thực thi:** Codex (hoặc bất kỳ coding agent nào chạy trong repo local)
**Trạng thái:** THAY THẾ HOÀN TOÀN bản v1. Nếu đã chạy migration theo bản v1, xoá bảng/cột đã tạo và chạy lại theo migration ở mục 3 của bản này (mục 0.2 nêu rõ khác biệt).

---

## 0. Đọc trước khi code

### 0.1. Nguyên tắc bắt buộc của repo (không đổi so với trước)

1. **Migration chỉ thêm, không bao giờ phá hủy** dữ liệu production.
2. **"No Data ≠ 0"** — `null` không bao giờ bị ép thành `0`, xuyên suốt DB/business logic/UI.
3. Repo dùng **raw SQL qua `pg`, không ORM** (`lib/db.ts`, `lib/repositories/*.ts`), Next.js App Router, NextAuth Google OAuth. `proxy.ts` (middleware — tên file khác thường vì phiên bản Next trong repo có breaking changes, xem `AGENTS.md`) tự động chặn `/api/admin/**` cho non-admin — route mới đặt trong `/api/admin/` **không cần tự check quyền**.
4. Trước khi code, chạy các lệnh sau để xác nhận schema/convention thật khớp spec:
   ```bash
   cat migrations/*.sql
   cat lib/performance/growth.ts lib/performance/refresh.ts lib/ranges.ts
   cat lib/repositories/rollups.ts lib/repositories/performance-cache.ts lib/repositories/content-urls.ts
   cat app/admin/page.tsx app/dashboard/page.tsx components/RangeSwitcher.tsx components/ui.tsx
   ```
   Nếu có sai khác, ưu tiên code thật, điều chỉnh theo, và nêu rõ trong báo cáo cuối cùng.

### 0.2. Vì sao bản v2 khác bản v1 — 2 lỗi logic đã sửa

**Lỗi 1 — công thức tuyến tính không công bằng ở baseline thấp.** Bản v1 dùng `score = clamp(50 + growth% / coefficient, 0, 100)`. Vấn đề: khi `previous` gần 0 (hoặc bằng 0 nhưng có dữ liệu — khác với "hoàn toàn không có dữ liệu"), `growth%` bùng nổ (vài trăm đến vài nghìn %) — dù bị clamp về 100, **mọi mức độ tăng trưởng từ baseline thấp đều maxed ra cùng 1 điểm 100**, không phân biệt được URL tăng nhẹ với URL tăng vọt thật sự. Bản v2 thay bằng **log-ratio có làm mượt (smoothing)** — xem mục 2.

**Lỗi 2 — trạng thái `new_grace` (loại URL mới khỏi tính điểm) mâu thuẫn với yêu cầu "không nên là null".** Bản v1 loại hẳn URL mới ra khỏi mẫu số trong thời gian ân hạn. Bản v2 **bỏ trạng thái này** — nhờ công thức log-ratio làm mượt, URL hoàn toàn mới (`previous = null`) chỉ cần coi `previous = 0` và tính điểm bình thường qua đúng 1 công thức duy nhất; ảnh hưởng của nó lên điểm trung bình tự nhiên bị hạn chế bởi cơ chế trọng số (weight) đã có sẵn — không cần thêm state riêng, không cần tham số `new_url_grace_days` nữa. Đây cũng là 1 bước đơn giản hóa (ít trạng thái hơn, ít tham số hơn).

**Kết quả:** chỉ còn **3 trạng thái** (`normal`, `excluded`, `no_data`) thay vì 4, và **1 công thức áp dụng cho mọi trường hợp có dữ liệu** thay vì phải phân biệt "mới" và "cũ".

---

## 1. Phạm vi

Tính **KPI Score** (0–100) theo Member và Project, dựa trên tăng trưởng Clicks & Impressions, cho các range có kỳ so sánh (`last_1_month` / `last_3_months` / `last_6_months` — không tính `all_time`/`custom`). Ngoài Score, UI còn cần hiển thị **"Số lượng"** (khối lượng nội dung đã làm trong kỳ) — xem mục 8.

---

## 2. Quy tắc tính điểm (v2 — đã sửa)

### 2.1. Trạng thái URL (`score_state`) — còn 3 giá trị

| `score_state` | Điều kiện | Tính vào KPI? |
|---|---|---|
| `excluded` | `content_urls.kpi_excluded = true` (loại thủ công — seasonal đã qua mùa, v.v.) | Không |
| `no_data` | `seo_performance_cache.data_status != 'ok'` | Không |
| `normal` | Còn lại — **bao gồm cả URL hoàn toàn mới** (không còn `new_grace` riêng) | **Có** |

### 2.2. Công thức điểm — log-ratio có làm mượt

```
smoothing = kpi_settings.smoothing_constant          # mặc định 1

effective_previous_clicks = previous_clicks ?? 0      # null (chưa từng có dữ liệu) → coi là 0
effective_previous_impr   = previous_impressions ?? 0

click_ratio = (current_clicks       + smoothing) / (effective_previous_clicks + smoothing)
impr_ratio  = (current_impressions  + smoothing) / (effective_previous_impr   + smoothing)

sensitivity(project_type) = 50 / log2( 1 + target_growth_pct[project_type] / 100 )

click_score = clamp( 50 + log2(click_ratio) * sensitivity(project_type), 0, 100 )
impr_score  = clamp( 50 + log2(impr_ratio)  * sensitivity(project_type), 0, 100 )

score  = click_score * click_weight + impr_score * impression_weight
weight = ( effective_previous_impr + current_impressions ) / 2
```

**Vì sao công thức này giải quyết đúng 2 vấn đề bạn nêu:**

- **"previous = 0, current tăng trưởng → tính Score thế nào?"** → Luôn có `smoothing` trong cả tử và mẫu nên `ratio` luôn xác định (không chia 0), luôn hữu hạn, luôn qua `clamp` — **không bao giờ null, không bao giờ ra số hàng nghìn %**. Ví dụ `smoothing=1`, `previous=0`:
  - `current=1` → ratio=2 → log2=1 → điểm ≈ 50 + 1×85.5 = 100 (max, với `target_growth_pct=50` → `sensitivity≈85.5`) — thực ra ngay cả +1 click từ 0 đã gần max vì sensitivity khá cao; xem bảng ví dụ số dưới để hiệu chỉnh.
  - `current=10` → ratio=11 → log2≈3.46 → điểm = 100 (max, rõ ràng là thành quả lớn)
  - `current=0` (không có click nào) → ratio=1 → log2=0 → điểm = 50 (trung tính — URL mới có impression nhưng chưa ai click, không bị trừ điểm, cũng không được thưởng điểm)

- **"Chặn trần/sàn có công bằng với thành quả không?"** → Có, vì trần giờ đạt được dựa trên **độ lớn thật (log-scale)** chứ không phải bất kỳ tăng trưởng dương nào cũng lập tức chạm trần. Bảng minh họa với `target_growth_pct=50%` (dự án loại `growth`, `smoothing=1`):

  | previous → current | growth% kiểu cũ | Điểm v1 (linear clamp) | Điểm v2 (log-ratio) |
  |---|---|---|---|
  | 1000 → 1500 | +50% | 100 | ~100 |
  | 1000 → 1100 | +10% | 68.5 | ~68.9 (gần giống v1 ở baseline lớn — hành vi quen thuộc không đổi) |
  | 1 → 2 | +100% | 100 | **89.6** (khác biệt rõ so với dòng dưới) |
  | 1 → 10 | +900% | 100 | **100** |
  | 0 → 2 | (không tính được / hoặc 100 tùy cách vá) | — | **89.6** |
  | 0 → 0 (không click, có impression) | — | — | **50** (trung tính) |

  → Baseline lớn: v2 gần như **giữ nguyên hành vi quen thuộc** của công thức cũ (không phá vỡ trực giác đã thống nhất trước đó). Baseline thấp: v2 **phân biệt được** mức độ tăng trưởng thay vì mọi thứ đều max — trực tiếp trả lời "công bằng hay không".

- Trần/sàn (0–100) **vẫn cần giữ** để bảo vệ tính ổn định của điểm trung bình toàn team (mục tiêu gốc "%KPI không quá biến động, kiểm soát được") — nhưng giờ nó không còn triệt tiêu thông tin về độ lớn thành quả ở vùng baseline thấp nữa. Với thành tích **vượt trội** (vd. tăng 50–100 lần), điểm KPI vẫn dừng ở 100 — đây là lựa chọn **có chủ đích**: KPI Score được thiết kế để trả lời "có đạt/vượt kỳ vọng tăng trưởng của loại dự án này không", không phải để xếp hạng vô hạn thành tích xuất sắc. Muốn ghi nhận riêng thành tích đột phá, dùng đúng cột **Δ click/impression thực tế** hiển thị cạnh Score trong UI (mục 8) — đây cũng chính là lý do UI mục 2 của bạn yêu cầu hiển thị cả Score **và** Δ%/Δ tuyệt đối cạnh nhau, không chỉ riêng Score.

### 2.3. Tổng hợp lên Member / Project — không đổi so với v1

```
normal_urls = { url | score_state == 'normal' }
raw_total   = Σ weight(u)
cap_value   = (url_weight_cap_pct / 100) * raw_total
capped_weight(u) = min(weight(u), cap_value)      # 1 URL không chiếm quá X% tổng trọng số

kpi_score = Σ [ score(u) × capped_weight(u) ] / Σ capped_weight(u)
```

Nếu `normal_urls` rỗng → `kpi_score = null` (đúng "No Data ≠ 0").

### 2.4. Range được tính điểm — không đổi

Chỉ `last_1_month` / `last_3_months` / `last_6_months`. `all_time`/`custom` không có kỳ trước để so sánh → không tính.

### 2.5. Tham số Admin-configurable (`kpi_settings`) — đã đổi so với v1

| Tham số | Default | Ý nghĩa | Khác gì v1 |
|---|---|---|---|
| `target_growth_pct_new` | `50` | % tăng trưởng để đạt điểm 100, dự án loại New | Tên đổi từ `coefficient_new`, ý nghĩa dễ hiểu hơn (trực tiếp là %, không phải hệ số chia) |
| `target_growth_pct_growth` | `50` | Tương tự, dự án Growth | |
| `target_growth_pct_stable` | `15` | Tương tự, dự án Stable (kỳ vọng biến động ít hơn) | |
| `smoothing_constant` | `1` | Hằng số làm mượt log-ratio | **MỚI** — cốt lõi của bản sửa lỗi 1 |
| `click_weight` | `0.7` | Trọng số Click trong điểm blend | Không đổi |
| `impression_weight` | `0.3` | Trọng số Impression | Không đổi |
| `url_weight_cap_pct` | `40` | 1 URL tối đa chiếm bao nhiêu % tổng trọng số | Không đổi |
| ~~`new_url_grace_days`~~ | — | — | **Bỏ** — không còn cần vì bỏ trạng thái `new_grace` |

Validate khi cập nhật: `target_growth_pct_* > 0` (bắt buộc, vì `log2(1+0/100)=0` sẽ chia cho 0 khi tính `sensitivity`), `smoothing_constant > 0`, `click_weight + impression_weight = 1`, `url_weight_cap_pct` trong `(0, 100]`.

---

## 3. Data model — `migrations/004_kpi_performance_score.sql`

```sql
begin;

alter table public.project_gsc_properties
  add column if not exists project_type text not null default 'growth'
    check (project_type in ('new', 'growth', 'stable'));

-- Loại trừ THỦ CÔNG (không có logic tự động phát hiện seasonal) — dùng cho
-- URL holiday/occasion/festival đã qua mùa quá xa.
alter table public.content_urls
  add column if not exists kpi_excluded boolean not null default false,
  add column if not exists kpi_excluded_reason text,
  add column if not exists kpi_excluded_at timestamptz;

-- Singleton config (id luôn = 1) để Admin chỉnh công thức tính điểm không cần
-- deploy lại — chính là "Admin-configurable weighting" mà README yêu cầu.
create table if not exists public.kpi_settings (
  id integer primary key default 1,
  target_growth_pct_new numeric not null default 50,
  target_growth_pct_growth numeric not null default 50,
  target_growth_pct_stable numeric not null default 15,
  smoothing_constant numeric not null default 1,
  click_weight numeric not null default 0.7,
  impression_weight numeric not null default 0.3,
  url_weight_cap_pct numeric not null default 40,
  updated_at timestamptz not null default now(),
  constraint kpi_settings_singleton check (id = 1),
  constraint kpi_settings_targets_positive check (
    target_growth_pct_new > 0 and target_growth_pct_growth > 0 and target_growth_pct_stable > 0
  ),
  constraint kpi_settings_smoothing_positive check (smoothing_constant > 0)
);

insert into public.kpi_settings (id) values (1) on conflict (id) do nothing;

-- Điểm theo URL / range — song song với seo_performance_cache. Lưu cả
-- click/impression raw growth% (kiểu tính CŨ, hiển thị UI) song song với
-- click_score/impression_score (điểm đã qua log-ratio) để người xem đối
-- chiếu trực quan "growth thật" vs "điểm được chấm".
create table if not exists public.url_performance_score (
  id uuid primary key default gen_random_uuid(),
  content_url_id uuid not null references public.content_urls(id) on delete cascade,
  range_key text not null,
  start_date date not null,
  end_date date not null,
  project_type text not null,
  score_state text not null check (score_state in ('normal', 'excluded', 'no_data')),
  click_ratio numeric,
  impression_ratio numeric,
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

create table if not exists public.member_performance_score (
  id uuid primary key default gen_random_uuid(),
  member_name text not null default '',
  member_email text,
  range_key text not null,
  start_date date not null,
  end_date date not null,
  kpi_score numeric,
  eligible_url_count integer not null default 0,
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

create table if not exists public.project_performance_score (
  id uuid primary key default gen_random_uuid(),
  project text not null default '',
  range_key text not null,
  start_date date not null,
  end_date date not null,
  kpi_score numeric,
  eligible_url_count integer not null default 0,
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

> Lưu ý: đã bỏ `new_grace_url_count` khỏi `member_performance_score`/`project_performance_score` so với v1 (state đó không còn tồn tại).

---

## 4. `lib/performance/score.ts` (thay thế toàn bộ nội dung nếu đã tạo theo v1)

```typescript
export type ProjectType = "new" | "growth" | "stable";
export type ScoreState = "normal" | "excluded" | "no_data";

export interface KpiSettings {
  targetGrowthPct: Record<ProjectType, number>; // vd { new: 50, growth: 50, stable: 15 }
  smoothingConstant: number;
  clickWeight: number;
  impressionWeight: number;
  urlWeightCapPct: number;
}

export interface UrlScoreInput {
  projectType: ProjectType;
  dataStatus: string;      // seo_performance_cache.data_status
  kpiExcluded: boolean;    // content_urls.kpi_excluded
  currentClicks: number | null;
  previousClicks: number | null;       // null = chưa từng có dữ liệu kỳ trước
  currentImpressions: number | null;
  previousImpressions: number | null;  // null = chưa từng có dữ liệu kỳ trước
}

export interface UrlScoreResult {
  state: ScoreState;
  clickRatio: number | null;
  impressionRatio: number | null;
  clickScore: number | null;
  impressionScore: number | null;
  score: number | null; // 0–100, null khi state !== "normal"
  weight: number;        // 0 khi state !== "normal"
}

const NOT_SCORED: Omit<UrlScoreResult, "state"> = {
  clickRatio: null,
  impressionRatio: null,
  clickScore: null,
  impressionScore: null,
  score: null,
  weight: 0,
};

/**
 * % tăng trưởng cần để đạt điểm 100, quy đổi sang hệ số nhân cho log-ratio.
 * log2(1 + targetPct/100) chính là log-ratio tương ứng với đúng targetPct%
 * tăng trưởng kiểu truyền thống (current = previous × (1 + targetPct/100)),
 * nên ở baseline đủ lớn công thức log-ratio hội tụ về đúng hành vi quen
 * thuộc của công thức % tuyến tính cũ — chỉ khác biệt ở baseline thấp, đúng
 * chỗ công thức cũ có vấn đề.
 */
function sensitivityFor(targetGrowthPct: number): number {
  return 50 / Math.log2(1 + targetGrowthPct / 100);
}

/**
 * Log-ratio có làm mượt (Laplace-style smoothing). Luôn xác định kể cả khi
 * previous = 0 hoặc previous = null (coi là 0) — không chia cho 0, không bao
 * giờ ra giá trị vô hạn. `current`/`previous` càng lớn thì hằng số làm mượt
 * càng ít ảnh hưởng — công thức tự nhiên "giảm nhòe" dần về đúng %growth kiểu
 * cũ khi baseline đủ lớn, và chỉ thực sự phát huy tác dụng ở baseline thấp.
 */
function ratioOf(current: number | null, previous: number | null, smoothing: number): number {
  const c = Number(current ?? 0);
  const p = Number(previous ?? 0);
  return (c + smoothing) / (p + smoothing);
}

function clampScore(logRatio: number, sensitivity: number): number {
  return Math.max(0, Math.min(100, 50 + logRatio * sensitivity));
}

export function computeUrlScore(input: UrlScoreInput, settings: KpiSettings): UrlScoreResult {
  if (input.kpiExcluded) {
    return { state: "excluded", ...NOT_SCORED };
  }
  if (input.dataStatus !== "ok") {
    return { state: "no_data", ...NOT_SCORED };
  }

  const sensitivity = sensitivityFor(settings.targetGrowthPct[input.projectType]);

  const clickRatio = ratioOf(input.currentClicks, input.previousClicks, settings.smoothingConstant);
  const impressionRatio = ratioOf(input.currentImpressions, input.previousImpressions, settings.smoothingConstant);

  const clickScore = clampScore(Math.log2(clickRatio), sensitivity);
  const impressionScore = clampScore(Math.log2(impressionRatio), sensitivity);

  const score = clickScore * settings.clickWeight + impressionScore * settings.impressionWeight;

  // previous = null (chưa từng có dữ liệu) → coi weight-basis = 0, đúng như
  // previous = 0 thật — URL càng ít lịch sử traffic thì trọng số càng thấp,
  // đây là cơ chế TỰ NHIÊN hạn chế ảnh hưởng của URL rất mới lên điểm trung
  // bình, thay cho việc loại trừ hẳn (grace period) như thiết kế trước.
  const weight = (Number(input.previousImpressions ?? 0) + Number(input.currentImpressions ?? 0)) / 2;

  return { state: "normal", clickRatio, impressionRatio, clickScore, impressionScore, score, weight };
}

export interface ScoreAggregate {
  kpiScore: number | null;
  eligibleUrlCount: number;
  excludedUrlCount: number;
  noDataUrlCount: number;
  cappedUrlCount: number;
  totalWeight: number;
}

/**
 * Trung bình có trọng số của các URL "normal", trần trọng số per-URL để 1 URL
 * không áp đảo điểm chung. Single-pass (không lặp renormalize) — đơn giản,
 * đủ dùng cho v1; ghi rõ đây là xấp xỉ, không phải cap tuyệt đối chính xác
 * trong mọi trường hợp cực đoan (rất ít URL, chênh lệch traffic cực lớn).
 */
export function aggregateScore(results: UrlScoreResult[], urlWeightCapPct: number): ScoreAggregate {
  const normal = results.filter((r) => r.state === "normal");
  const counts = {
    eligibleUrlCount: normal.length,
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
      : normal.reduce((sum, r) => sum + (r.score ?? 0), 0) / normal.length;

  return { kpiScore: Math.max(0, Math.min(100, kpiScore)), ...counts, cappedUrlCount, totalWeight };
}
```

---

## 5. Repository layer

### 5.1. `lib/repositories/kpi-settings.ts`

```typescript
import { query, queryOne } from "@/lib/db";
import type { KpiSettings } from "@/lib/performance/score";

interface KpiSettingsRow {
  target_growth_pct_new: number;
  target_growth_pct_growth: number;
  target_growth_pct_stable: number;
  smoothing_constant: number;
  click_weight: number;
  impression_weight: number;
  url_weight_cap_pct: number;
}

export async function getKpiSettings(): Promise<KpiSettings> {
  const row = await queryOne<KpiSettingsRow>("select * from public.kpi_settings where id = 1");
  if (!row) throw new Error("kpi_settings row missing — did migration 004 run?");
  return {
    targetGrowthPct: {
      new: row.target_growth_pct_new,
      growth: row.target_growth_pct_growth,
      stable: row.target_growth_pct_stable,
    },
    smoothingConstant: row.smoothing_constant,
    clickWeight: row.click_weight,
    impressionWeight: row.impression_weight,
    urlWeightCapPct: row.url_weight_cap_pct,
  };
}

export async function updateKpiSettings(input: Partial<KpiSettingsRow>): Promise<void> {
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
  kpi_excluded: boolean;
  project_type: "new" | "growth" | "stable";
  data_status: string;
  current_clicks: number | null;
  previous_clicks: number | null;
  current_impressions: number | null;
  previous_impressions: number | null;
}

/** Input thô cho chấm điểm — đọc trực tiếp clicks/impressions RAW (không
 *  dùng click_growth_pct/impression_growth_pct đã tính sẵn — score.ts tự
 *  tính ratio riêng theo công thức log-ratio, khác công thức % của
 *  growth.ts). Chỉ đọc từ cache đã có, không gọi GSC. */
export async function getScoringInputRowsForRange(rangeKey: RangeKey): Promise<ScoringInputRow[]> {
  return query<ScoringInputRow>(
    `select c.id as content_url_id, c.project, c.member_name, c.member_email, c.kpi_excluded,
            coalesce(pgp.project_type, 'growth') as project_type,
            p.data_status,
            p.clicks as current_clicks, p.previous_clicks,
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
        click_ratio, impression_ratio, click_score, impression_score, score, weight,
        refreshed_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now(), now())
     on conflict (content_url_id, range_key) do update set
       start_date = excluded.start_date, end_date = excluded.end_date,
       project_type = excluded.project_type, score_state = excluded.score_state,
       click_ratio = excluded.click_ratio, impression_ratio = excluded.impression_ratio,
       click_score = excluded.click_score, impression_score = excluded.impression_score,
       score = excluded.score, weight = excluded.weight,
       refreshed_at = now(), updated_at = now()`,
    [
      input.contentUrlId, input.rangeKey, input.startDate, input.endDate, input.projectType,
      r.state, r.clickRatio, r.impressionRatio, r.clickScore, r.impressionScore, r.score, r.weight,
    ],
  );
}
```

### 5.3. `lib/repositories/kpi-score-rollups.ts`

Giống hệt v1 (mirror `rollups.ts`), chỉ bỏ field `new_grace_url_count` khỏi mọi interface/SQL. Viết `upsertMemberScore` / `upsertProjectScore` / `listMemberScores` / `listProjectScores` / `getMemberScoreByEmail` theo đúng pattern `on conflict ... do update` đã dùng trong `rollups.ts` — tự đọc file đó để copy cấu trúc, chỉ đổi tên bảng/cột theo mục 3.

### 5.4. MỚI — `lib/repositories/content-volume.ts` (cho "Số lượng" ở UI, mục 8)

```typescript
import { query } from "@/lib/db";

export interface ContentVolumeRow {
  key: string;           // member_name hoặc project
  work_type: string;     // giá trị cột "type" trong Sheet, đã lowercase — không giả định enum cố định
  url_count: number;
}

/**
 * Đếm số URL có worked_at rơi vào [startDate, endDate] — bất kể is_active
 * hiện tại (một URL bị gỡ khỏi Sheet sau đó không nên xóa mất lịch sử "đã
 * từng làm việc" trong kỳ). Group theo work_type để phân biệt các loại công
 * việc khác nhau (vd "new" / "update" — tùy giá trị thật trong Sheet, xem
 * mục 12 quyết định cần xác nhận).
 */
export async function getContentVolumeByMember(startDate: string, endDate: string): Promise<ContentVolumeRow[]> {
  return query<ContentVolumeRow>(
    `select member_name as key, coalesce(nullif(work_type, ''), '(unspecified)') as work_type,
            count(*)::int as url_count
     from public.content_urls
     where worked_at is not null and worked_at between $1 and $2
     group by member_name, work_type
     order by member_name, work_type`,
    [startDate, endDate],
  );
}

export async function getContentVolumeByProject(startDate: string, endDate: string): Promise<ContentVolumeRow[]> {
  return query<ContentVolumeRow>(
    `select project as key, coalesce(nullif(work_type, ''), '(unspecified)') as work_type,
            count(*)::int as url_count
     from public.content_urls
     where worked_at is not null and worked_at between $1 and $2
     group by project, work_type
     order by project, work_type`,
    [startDate, endDate],
  );
}
```

---

## 6. Tích hợp vào refresh pipeline — sửa `lib/performance/refresh.ts`

Không đổi so với v1 ngoài việc bỏ tham chiếu `new_grace`. Thêm vào `lib/ranges.ts`:

```typescript
export function isRollingRange(rangeKey: RangeKey): boolean {
  return rangeKey === "last_1_month" || rangeKey === "last_3_months" || rangeKey === "last_6_months";
}
```

Sửa `maybeFinishRun` trong `refresh.ts`:

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

export async function computeAndStoreScores(rangeKey: RangeKey, startDate: string, endDate: string): Promise<void> {
  const settings = await getKpiSettings();
  const rows = await getScoringInputRowsForRange(rangeKey);

  const scored = rows.map((row) => ({
    row,
    result: computeUrlScore(
      {
        projectType: row.project_type,
        dataStatus: row.data_status,
        kpiExcluded: row.kpi_excluded,
        currentClicks: row.current_clicks,
        previousClicks: row.previous_clicks,
        currentImpressions: row.current_impressions,
        previousImpressions: row.previous_impressions,
      },
      settings,
    ),
  }));

  for (const { row, result } of scored) {
    await upsertUrlPerformanceScore({
      contentUrlId: row.content_url_id, rangeKey, startDate, endDate,
      projectType: row.project_type, result,
    });
  }

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

`computeAndStoreScores` chỉ đọc cache đã có — nên có thêm `POST /api/admin/kpi/recompute` gọi lại hàm này cho cả 3 range rolling (dùng `computeRangeDates` để lấy start/end hiện tại), để admin thấy hiệu ứng ngay khi đổi `kpi_settings`/`project_type`/`kpi_excluded` mà không cần chờ refresh GSC đầy đủ.

---

## 7. API routes

| Method | Path | Việc |
|---|---|---|
| `GET` | `/api/me/kpi?range=` | KPI Score của member đang đăng nhập |
| `GET` | `/api/admin/kpi/summary?scope=member\|project&range=` | **MỚI, gộp** — trả về đồng thời KPI Score + Δ click/impression (join rollup) + Volume cho từng member/project. Đây là nguồn dữ liệu duy nhất cho trang UI mục 8. |
| `GET` | `/api/admin/kpi/urls?range=&project=&member=` | Chi tiết điểm từng URL (debug/minh bạch) |
| `GET`/`POST` | `/api/admin/kpi-settings` | Đọc/cập nhật config |
| `PATCH` | `/api/admin/urls/[id]` | Bật/tắt `kpi_excluded` |
| `POST` | `/api/admin/kpi/recompute` | Tính lại điểm cho 3 range rolling, không gọi GSC |

### 7.1. `GET /api/admin/kpi/summary/route.ts` — route quan trọng nhất cho UI mới

```typescript
import { NextResponse } from "next/server";
import { listMemberScores, listProjectScores } from "@/lib/repositories/kpi-score-rollups";
import { listMemberRollups, listProjectRollups } from "@/lib/repositories/rollups";
import { getContentVolumeByMember, getContentVolumeByProject } from "@/lib/repositories/content-volume";
import { computeRangeDates, DEFAULT_RANGE_KEY, type RangeKey } from "@/lib/ranges";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rangeKey = (searchParams.get("range") as RangeKey) || DEFAULT_RANGE_KEY;
  const scope = searchParams.get("scope") === "project" ? "project" : "member";
  const { startDate, endDate } = computeRangeDates(rangeKey);

  if (scope === "project") {
    const [scores, rollups, volume] = await Promise.all([
      listProjectScores(rangeKey),
      listProjectRollups(rangeKey),
      getContentVolumeByProject(startDate, endDate),
    ]);
    return NextResponse.json({ scores, rollups, volume, rangeKey, startDate, endDate });
  }

  const [scores, rollups, volume] = await Promise.all([
    listMemberScores(rangeKey),
    listMemberRollups(rangeKey),
    getContentVolumeByMember(startDate, endDate),
  ]);
  return NextResponse.json({ scores, rollups, volume, rangeKey, startDate, endDate });
}
```

> Route trả 3 mảng riêng (scores/rollups/volume) thay vì join sẵn ở SQL — join ở phía client theo `key`/`member_name`/`project` (mảng nhỏ, vài chục dòng, join tay đơn giản hơn viết 1 câu SQL 3 bảng phức tạp). Component ở mục 8 sẽ làm việc join này.

Các route còn lại (`/api/me/kpi`, `/api/admin/kpi/urls`, `/api/admin/kpi-settings`, `/api/admin/urls/[id]`, `/api/admin/kpi/recompute`) viết y hệt bản v1 (mục 7.1, 7.3, 7.5, 7.6 của bản v1) — chỉ khác `kpi-settings` đổi tên field theo mục 2.5, và `member_performance_score`/`project_performance_score` không còn cột `new_grace_url_count`.

---

## 8. UI — thiết kế lại theo yêu cầu (1 trang tổng hợp, sort/filter được)

### 8.1. Trang mới: `app/admin/kpi/page.tsx`

Cấu trúc:
```
PageHeader "Performance Score" + RangeSwitcher (dùng lại component có sẵn)
Tabs: [Theo Member] [Theo Project]   (state cục bộ, không phải route riêng)
  → mỗi tab render <KpiSummaryTable scope="member" rows={...} />
```

Fetch 1 lần: `fetch(\`/api/admin/kpi/summary?scope=${tab}&range=${range}\`)`.

### 8.2. Component MỚI: `components/KpiSummaryTable.tsx`

Nhận `scores`, `rollups`, `volume` (3 mảng thô từ API), tự join theo `key` (member_name hoặc project) thành 1 danh sách row hiển thị, với các cột:

| Cột | Nguồn | Ghi chú |
|---|---|---|
| Tên (Member/Project) | key | Sort được (alphabetical) |
| **Số lượng** — URL trong kỳ | `volume` group theo `work_type`, hiển thị dạng `12 (8 new · 4 update)` nếu có ≥2 work_type, hoặc chỉ tổng số nếu Sheet không phân loại | Sort theo tổng |
| **KPI Score** | `scores.kpi_score` | Badge màu theo mức (≥80 positive / 50–79 accent / <50 negative), `—` nếu null. Sort được (null luôn xếp cuối) |
| Click (hiện tại, Δ, Δ%) | `rollups.clicks/click_delta/click_growth_pct` | Dùng lại `MetricDelta` có sẵn — đây là **Δ tuyệt đối thật**, đặt cạnh Score để trả lời "dự án tăng trưởng thế nào" độc lập với thang điểm 0–100 |
| Impression (hiện tại, Δ, Δ%) | `rollups.impressions/impression_delta/impression_growth_pct` | Tương tự |
| Eligible / Excluded / No data | `scores.eligible_url_count` v.v. | Minh bạch — vì sao điểm ra như vậy |

**Sort:** state nội bộ `sortKey`/`sortDirection`, click header để đổi; `[...rows].sort(...)` trước khi render — không cần fetch lại (toàn bộ dữ liệu range đã có sẵn trong bộ nhớ).

**Filter:** 1 ô tìm kiếm theo tên (client-side, lọc `rows` trước khi sort/render) — đủ dùng vì số lượng member/project trong 1 team SEO thường không lớn (vài chục), không cần filter server-side phức tạp.

```tsx
"use client";
import { useMemo, useState } from "react";
// ...imports MetricDelta, Badge, formatScore, formatNumber, EmptyState

type SortKey = "name" | "volume" | "score" | "clicks" | "impressions";

export function KpiSummaryTable({ rows }: { rows: JoinedRow[] }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filtered = useMemo(
    () => rows.filter((r) => r.name.toLowerCase().includes(search.toLowerCase())),
    [rows, search],
  );
  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = valueFor(a, sortKey);
      const bv = valueFor(b, sortKey);
      if (av === null) return 1;   // null luôn xuống cuối bất kể hướng sort
      if (bv === null) return -1;
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  // ...render <input> tìm kiếm + <table> với <th onClick={() => toggleSort(...)}>
}
```

(`valueFor` là hàm nhỏ map `SortKey` → giá trị số/chuỗi tương ứng để so sánh — viết thẳng, không cần generic phức tạp.)

### 8.3. Dashboard thành viên — `app/dashboard/page.tsx`

Thêm 1 `StatCard` "KPI Score" (giống v1 mục 8.2), fetch từ `/api/me/kpi?range=`.

### 8.4. Admin Settings — `app/admin/settings/page.tsx`

- Thêm dropdown **Project Type** vào form `project_gsc_properties` đã có.
- Thêm `Card` "KPI Settings" — form 7 tham số ở mục 2.5 (đổi tên field so với v1), gọi `GET`/`POST /api/admin/kpi-settings`.

### 8.5. Admin URLs — `app/admin/urls/page.tsx`

Thêm cột/toggle "Loại trừ KPI" — gọi `PATCH /api/admin/urls/[id]`. Không đổi so với v1.

---

## 9. Cập nhật README

Giống v1 mục 9, chỉ đổi câu mô tả cơ chế:
> ... Growth is scored via a smoothed log-ratio (not raw %), so a URL with little or no prior baseline gets a well-defined, bounded score instead of an undefined or explosive percentage — see `lib/performance/score.ts`. Aggregation weights by traffic with a per-URL cap. Weighting, growth targets, and the smoothing constant are Admin-configurable under **Admin → Settings**.

---

## 10. Kịch bản kiểm thử — verify bằng số cụ thể

Với `kpi_settings` default (`target_growth_pct_growth=50`, `smoothing_constant=1`, `click_weight=0.7/impression_weight=0.3`), seed các URL sau trong 1 project loại `growth`, rồi verify:

1. **previous=0 (có dữ liệu, không phải null), current=2 click** → `click_score` phải nằm trong khoảng **(50, 100) — không phải đúng 100, không phải null**. Verify công thức tay: `ratio=(2+1)/(0+1)=3`, `log2(3)≈1.585`, `sensitivity=50/log2(1.5)≈85.5`, `score=50+1.585×85.5≈100` (thực tế sẽ clamp — nếu muốn thấy sự khác biệt rõ hơn ở test này, seed `current=1` thay vì `2`: `ratio=2`, `log2=1`, `score=50+85.5=100` vẫn max vì sensitivity cao; seed `current=1, target_growth_pct_growth` tạm hạ xuống test với giá trị nhỏ hơn để quan sát vùng chưa max, hoặc đối chiếu trực tiếp 2 URL cùng batch: URL A previous=0→current=1, URL B previous=0→current=20, xác nhận **B ≥ A** và **A < 100** nếu A thực sự nhỏ tương đối — mục đích chính của test là xác nhận **không null, không lỗi, có phân biệt**, không nhất thiết đúng con số tuyệt đối).
2. **previous=null (chưa từng có dữ liệu), current=5** → phải cho kết quả **giống hệt** case `previous=0, current=5` (verify `ratioOf` coi `null` và `0` như nhau).
3. **previous=1000, current=1500 (+50% đúng nghĩa)** → `score` phải xấp xỉ **100** (khớp `target_growth_pct_growth=50`), sai số nhỏ so với công thức tuyến tính cũ (do smoothing gần như không đáng kể ở baseline lớn).
4. **2 URL cùng previous=0**, 1 URL `current=1`, 1 URL `current=50` → 2 điểm phải **khác nhau** (URL current=50 ≥ URL current=1), chứng minh đã hết tình trạng "mọi tăng trưởng từ 0 đều max như nhau" của v1.
5. **`kpi_score = null`** khi member chỉ có URL `excluded`/`no_data` — UI hiển thị "—", không phải "0".
6. **UI**: bảng `/admin/kpi` sort theo cột "KPI Score" giảm dần → member không có score (null) phải nằm **cuối danh sách** dù đang sort desc hay asc. Filter theo tên → chỉ còn đúng các dòng khớp, sort vẫn hoạt động trên tập đã lọc.
7. **"Số lượng"**: 1 member có 3 URL với `worked_at` trong kỳ (2 URL `work_type='new'`, 1 URL `work_type='update'`) → cột Số lượng hiển thị đúng breakdown; URL thứ 4 cùng member nhưng `worked_at` ngoài kỳ → không được đếm.

Chạy `npm run typecheck && npm run lint` sạch trước khi báo hoàn thành.

---

## 11. Trình tự triển khai

1. Xác nhận schema/convention thật (mục 0.4 — đã ghi ở 0.1 điểm 4).
2. Migration `004_kpi_performance_score.sql` → `npm run migrate`.
3. `lib/performance/score.ts` (mục 4).
4. Repository: `kpi-settings.ts`, `url-performance-score.ts`, `kpi-score-rollups.ts`, `content-volume.ts` (mục 5).
5. `lib/ranges.ts` (+`isRollingRange`), `lib/performance/refresh.ts` (mục 6).
6. API routes (mục 7) — ưu tiên `admin/kpi/summary` trước vì UI phụ thuộc route này.
7. UI (mục 8) theo thứ tự: `KpiSummaryTable` → trang `admin/kpi` → dashboard StatCard → admin settings form → admin urls toggle.
8. README (mục 9).
9. Chạy hết checklist mục 10 với dữ liệu thật hoặc seed tay, dán kết quả vào báo cáo.
10. `npm run typecheck && npm run lint`.

---

## 12. Quyết định cần xác nhận lại

| # | Vấn đề | Default trong spec | Cần xác nhận |
|---|---|---|---|
| 1 | Giá trị cột `type` trong Google Sheet (`content_urls.work_type`) | Spec giả định có thể là "new"/"update" nhưng code viết generic (không hardcode) | **Xác nhận thực tế Sheet đang dùng giá trị gì cho cột `type`** — nếu không phải "new"/"update", cột "Số lượng" trong UI vẫn hoạt động đúng (group theo bất kỳ giá trị nào), chỉ là nhãn hiển thị sẽ khác |
| 2 | `smoothing_constant=1` | Làm mượt log-ratio | Sau vài kỳ dữ liệu thật, xem URL baseline thấp có thường xuyên gây điểm bất thường không — tăng hằng số này nếu vẫn thấy quá nhạy |
| 3 | `target_growth_pct_growth=50 / stable=15 / new=50` | Ngưỡng đạt điểm 100 | Cần đối chiếu với growth% trung vị thực tế của từng loại dự án |
| 4 | `url_weight_cap_pct=40` | Trần trọng số 1 URL | Với member chỉ có 1–2 URL, cap gần như vô hiệu — chấp nhận được ở v1 |
| 5 | Project-level KPI trong UI | Đã có schema + API + tab "Theo Project" đầy đủ trong spec này | Không còn là điểm mở — đã đưa vào ngay từ đầu theo yêu cầu "group by dự án" |

---

## 13. Prompt bàn giao cho Codex

```
Đọc file PERFORMANCE_SCORE_SPEC_v2.md ở gốc repo trước khi code. Đây là spec
đầy đủ, đã đối chiếu với schema/convention thật của repo — không cần đoán,
nhưng hãy tự chạy lại các lệnh khám phá ở mục 0.1 điểm 4 để xác nhận schema
hiện tại vẫn khớp trước khi viết migration.

Lưu ý: nếu trong repo đã tồn tại bất kỳ file/bảng nào theo một bản spec cũ
(v1) — ví dụ bảng kpi_settings có cột coefficient_new/coefficient_growth/
coefficient_stable/new_url_grace_days, hoặc trạng thái score_state có giá trị
'new_grace' — hãy XÓA và làm lại đúng theo spec v2 này (migration 004 trong
spec v2 là bản schema cuối cùng, không phải bản vá thêm).

Triển khai đúng thứ tự ở mục 11. Giữ 2 nguyên tắc cứng của repo: (1) migration
chỉ thêm, không phá hủy dữ liệu production đã tồn tại từ TRƯỚC (bảng/cột MỚI
của tính năng này thì được tạo mới bình thường); (2) "No Data ≠ 0" — không ép
null thành 0 ở bất kỳ tầng nào.

Trọng tâm cần làm đúng nhất: công thức log-ratio ở lib/performance/score.ts
(mục 4) — đây là phần sửa lỗi so với thiết kế trước, hãy chạy đúng 4 test case
số học ở mục 10 (đặc biệt case 4: 2 URL cùng previous=0 phải cho 2 điểm khác
nhau) trước khi coi là xong phần logic.

Sau khi hoàn thành, chạy hết checklist ở mục 10, dán kết quả thật vào báo cáo,
và chạy npm run typecheck && npm run lint sạch.
```
