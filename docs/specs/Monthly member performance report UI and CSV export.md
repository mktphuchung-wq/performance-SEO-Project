## Ý định tính năng đã làm rõ

**Admin chọn tháng báo cáo và một thành viên, xem trước dữ liệu, rồi tải một file CSV.**

Mỗi dòng CSV đại diện cho **một URL thuộc thành viên đó**. File chứa:

- Thông tin URL và project.
- Performance URL trong ba cửa sổ `1M / 3M / 6M`.
- Trend URL trong từng cửa sổ.
- Performance tổng hợp của thành viên trong `1M / 3M / 6M`.
- Khoảng ngày hiện tại và khoảng đối chiếu để số liệu có thể kiểm chứng.

> Điểm cần lưu ý từ codebase: `seo_performance_cache`, `member_performance_rollup` và `member_performance_score` hiện chỉ giữ snapshot mới nhất theo `range_key`. Chúng không đủ để xuất chính xác báo cáo của tháng lịch sử. Tính năng cần cơ chế snapshot theo `report_month`, không được lấy số hiện tại rồi gắn nhãn tháng cũ.

## Prompt dùng để build tính năng

```md
# Feature: Monthly member performance report UI and CSV export

Bạn đang làm việc trong repo `Performance SEO Project`.

## 1. Goals

Build tính năng để admin có thể:

1. Chọn một `report month` theo định dạng `YYYY-MM`.
2. Chọn một thành viên SEO.
3. Xem preview báo cáo performance của thành viên đó.
4. Export đúng một file CSV, trong đó mỗi dòng là một URL thuộc thành viên.
5. Báo cáo phải thể hiện đồng thời:
   - Performance và trend của từng URL ở các range 1M, 3M, 6M.
   - Performance tổng hợp của thành viên ở các range 1M, 3M, 6M.
6. Có thể mở lại báo cáo lịch sử của một tháng mà không bị thay đổi khi refresh dữ liệu tháng sau.

Tên file đề xuất:

`seo-member-report-{member-slug}-{YYYY-MM}.csv`

Ví dụ:

`seo-member-report-nguyen-van-a-2026-08.csv`

## 2. Business intent

Báo cáo dùng để đánh giá kết quả SEO của từng thành viên theo tháng.

Một báo cáo phải trả lời được:

- Thành viên chịu trách nhiệm cho những URL nào?
- Mỗi URL đang có bao nhiêu clicks, impressions, CTR và average position?
- URL tăng, giảm, ổn định, có tín hiệu mới hay không có dữ liệu trong 1M, 3M và 6M?
- Performance Score tổng hợp của thành viên trong 1M, 3M và 6M là bao nhiêu?
- Số liệu được đo trong khoảng ngày nào và so sánh với baseline nào?
- URL nào không đủ điều kiện KPI hoặc không có dữ liệu?

Không tạo công thức performance/trend mới nếu codebase đã có logic tương ứng.

## 3. Đọc codebase trước khi code

Đọc ít nhất các file sau:

- `AGENTS.md`
- `node_modules/next/dist/docs/` cho API/convention Next.js 16.3 đang dùng
- `README.md`
- `docs/specs/PERFORMANCE_SCORE_SPEC_v2.md`
- `app/admin/members/page.tsx`
- `app/dashboard/page.tsx`
- `app/api/me/urls/route.ts`
- `app/api/me/performance/route.ts`
- `app/api/admin/members/route.ts`
- `components/PerformanceTable.tsx`
- `components/MemberComparisonTable.tsx`
- `components/RangeSwitcher.tsx`
- `components/ui.tsx`
- `lib/ranges.ts`
- `lib/performance/growth.ts`
- `lib/performance/score.ts`
- `lib/repositories/performance-cache.ts`
- `lib/repositories/rollups.ts`
- `lib/repositories/kpi-score-rollups.ts`
- `lib/repositories/content-url-monthly-metrics.ts`
- `migrations/013_baseline_history.sql`
- `proxy.ts`

Ưu tiên convention và schema thật trong codebase nếu khác mô tả này.

Repo đang dùng:

- Next.js App Router.
- TypeScript.
- React client components cho các trang dashboard hiện tại.
- PostgreSQL qua raw SQL trong `lib/repositories/*`; không dùng ORM.
- NextAuth.
- `/admin/**` và `/api/admin/**` được bảo vệ bởi `proxy.ts`.
- Migration phải additive và không phá dữ liệu production.

## 4. Định nghĩa thời gian

### 4.1 Report month

`report_month` là tháng chốt báo cáo, dạng `YYYY-MM`.

Ví dụ chọn `2026-08` nghĩa là báo cáo được chốt cho tháng 08/2026.

### 4.2 Range

Dùng đúng ba `RangeKey` hiện có:

- `last_1_month`
- `last_3_months`
- `last_6_months`

Không đưa `all_time` và `custom` vào tính năng này.

Mỗi range phải giữ đúng semantics hiện có:

- Current window.
- Previous window có cùng độ dài.
- Click/impression delta.
- Click/impression growth percentage.
- Growth status.
- Data status.
- KPI score hiện có.

Không hiểu `1M / 3M / 6M` là ba tháng lịch rời rạc. Chúng là ba cửa sổ đo lường theo convention của `lib/ranges.ts`.

### 4.3 Historical correctness

Các bảng hiện tại như:

- `seo_performance_cache`
- `member_performance_rollup`
- `member_performance_score`

được key theo entity và `range_key`, sau đó bị overwrite khi refresh. Vì vậy không được dùng row hiện tại để giả lập báo cáo tháng cũ.

Thiết kế cơ chế snapshot theo ít nhất:

- `report_month`
- member identity
- URL identity
- `range_key`

Yêu cầu:

- Snapshot của tháng đã chốt phải đọc lại được.
- Refresh tháng sau không được thay đổi snapshot tháng trước.
- Generate lại cùng tháng phải idempotent.
- Không xóa hoặc sửa phá vỡ bảng hiện tại.
- Nếu cần migration, chỉ thêm bảng/index/constraint.
- Không backfill hoặc suy diễn các metric không tồn tại.
- Nếu tháng lịch sử chưa có snapshot đầy đủ, UI phải báo rõ `Report snapshot is not available`, không dùng dữ liệu mới nhất thay thế.

Nếu product flow cần tạo snapshot, cung cấp action admin rõ ràng như `Generate report snapshot` hoặc tích hợp snapshot vào monthly refresh, nhưng phải tránh tạo snapshot một phần mà UI hiểu là hoàn chỉnh.

## 5. UI

Tạo trang admin phù hợp với cấu trúc repo, ưu tiên:

`app/admin/reports/members/page.tsx`

Thêm navigation admin tương ứng trong `components/NavHeader.tsx`, ví dụ label:

`Reports`

### 5.1 Bộ lọc

Trang cần có:

- Month picker: `<input type="month">`.
- Member selector.
- Nút `View report`.
- Nút `Export CSV`.
- Loading state.
- Empty state.
- Error state.
- Trạng thái snapshot chưa tồn tại.
- Thời điểm dữ liệu được refresh/chốt.

Nút `Export CSV`:

- Disabled khi chưa chọn member hoặc month.
- Disabled khi báo cáo chưa load thành công.
- Không export file rỗng một cách im lặng.
- Có accessible label và trạng thái focus rõ ràng.

### 5.2 Preview

Preview gồm hai phần:

#### Member summary

Hiển thị theo cột 1M, 3M, 6M:

- Performance/KPI score.
- Clicks.
- Impressions.
- CTR.
- Average position.
- Click delta và growth.
- Impression delta và growth.
- Tổng URL.
- URL có dữ liệu.
- Growing/stable/declining/no-data URL.
- Range start/end.
- Previous range start/end.
- Data refreshed/snapshot time.

#### URL table

Mỗi URL hiển thị:

- Project.
- URL.
- Work type.
- Worked date nếu có.
- KPI inclusion/exclusion.
- Với mỗi range 1M, 3M, 6M:
  - Clicks.
  - Impressions.
  - CTR.
  - Position.
  - Previous clicks.
  - Previous impressions.
  - Click delta.
  - Click growth percentage.
  - Impression delta.
  - Impression growth percentage.
  - Trend/growth status.
  - Data status.

Có thể dùng bảng rộng với horizontal scrolling. Không tạo ba trang hoặc ba lần export riêng nếu một báo cáo có thể thể hiện đủ cả ba range.

## 6. Định nghĩa “performance” và “trend”

### URL performance

URL performance là metric GSC đã tồn tại trong `PerformanceCacheRow`:

- `clicks`
- `impressions`
- `ctr`
- `position`
- previous-period metrics
- absolute deltas
- growth percentages
- `data_status`

### URL trend

Dùng trực tiếp `growth_status` hiện có:

- `growing`
- `declining`
- `stable`
- `new_signal`
- `no_data`

Không thay URL trend bằng `TrendBadge` của composite member KPI nếu hai khái niệm khác nhau.

### Member performance

Member performance gồm:

1. Member rollup từ logic/bảng `member_performance_rollup`.
2. Performance Score từ logic/bảng `member_performance_score`.

Dùng `kpi_score` 0–100 hiện có. Không tự tính trung bình score của URL ở client.

Nếu score là `null`, hiển thị và export rỗng; không đổi thành `0`.

## 7. CSV contract

Xuất UTF-8 CSV có BOM để mở tốt trong Excel.

Mỗi dòng tương ứng một URL. Không tạo nhiều table không đồng nhất trong cùng CSV.

Các trường member summary được lặp lại trên từng URL để file vẫn là một bảng phẳng, dễ filter/pivot/import.

Header dùng `snake_case`, ổn định và machine-readable.

### 7.1 Identity columns

- `report_month`
- `snapshot_created_at`
- `member_name`
- `member_email`
- `project`
- `url`
- `work_type`
- `worked_at`
- `first_worked_at`
- `published_at`
- `kpi_excluded`
- `kpi_excluded_reason`

### 7.2 Member summary columns

Cho mỗi prefix `member_1m`, `member_3m`, `member_6m`:

- `{prefix}_range_start`
- `{prefix}_range_end`
- `{prefix}_previous_range_start`
- `{prefix}_previous_range_end`
- `{prefix}_performance_score`
- `{prefix}_clicks`
- `{prefix}_impressions`
- `{prefix}_ctr`
- `{prefix}_position`
- `{prefix}_previous_clicks`
- `{prefix}_previous_impressions`
- `{prefix}_click_delta`
- `{prefix}_click_growth_pct`
- `{prefix}_impression_delta`
- `{prefix}_impression_growth_pct`
- `{prefix}_url_count`
- `{prefix}_urls_with_data`
- `{prefix}_growing_urls`
- `{prefix}_stable_urls`
- `{prefix}_declining_urls`
- `{prefix}_no_data_urls`

### 7.3 URL range columns

Cho mỗi prefix `url_1m`, `url_3m`, `url_6m`:

- `{prefix}_range_start`
- `{prefix}_range_end`
- `{prefix}_previous_range_start`
- `{prefix}_previous_range_end`
- `{prefix}_clicks`
- `{prefix}_impressions`
- `{prefix}_ctr`
- `{prefix}_position`
- `{prefix}_previous_clicks`
- `{prefix}_previous_impressions`
- `{prefix}_previous_ctr`
- `{prefix}_previous_position`
- `{prefix}_click_delta`
- `{prefix}_click_growth_pct`
- `{prefix}_impression_delta`
- `{prefix}_impression_growth_pct`
- `{prefix}_trend`
- `{prefix}_data_status`
- `{prefix}_error_message`

### 7.4 CSV serialization rules

- Escape dấu phẩy, dấu nháy kép và newline theo RFC 4180.
- Dùng UTF-8 BOM.
- Không export chuỗi format cho UI như `1,204`, `+18.3%`, `—`.
- Number phải là raw numeric value.
- Percentage dùng cùng unit với DB/API hiện tại:
  - `click_growth_pct = 18.3`, không phải `0.183`.
  - CTR giữ raw ratio nếu DB đang giữ ratio, ví dụ `0.123`, không đổi thành chuỗi `12.3%`.
- `null` export thành ô rỗng.
- Boolean export `true` hoặc `false`.
- Không dùng locale-dependent decimal separator.
- Thứ tự URL ổn định: `project`, sau đó `url`.
- Formula-injection protection: nếu text bắt đầu bằng `=`, `+`, `-`, hoặc `@`, neutralize an toàn trước khi ghi CSV.
- API export phải trả:
  - `Content-Type: text/csv; charset=utf-8`
  - `Content-Disposition: attachment; filename="..."`

Ưu tiên generate CSV ở server để authorization, dữ liệu snapshot và contract nằm tại một nguồn duy nhất.

## 8. API đề xuất

Có thể điều chỉnh tên theo convention repo, nhưng cần tách rõ preview và export.

### Preview

`GET /api/admin/reports/members?month=YYYY-MM&memberEmail=...`

Response đề xuất:

```ts
interface MemberMonthlyReportResponse {
  reportMonth: string;
  snapshotCreatedAt: string;
  member: {
    name: string;
    email: string | null;
  };
  ranges: {
    last_1_month: MemberRangeSummary | null;
    last_3_months: MemberRangeSummary | null;
    last_6_months: MemberRangeSummary | null;
  };
  rows: MemberReportUrlRow[];
}
```

### CSV export

`GET /api/admin/reports/members/export?month=YYYY-MM&memberEmail=...`

Validation:

- Month phải đúng `YYYY-MM` và là tháng hợp lệ.
- Member phải tồn tại.
- Không chấp nhận `all_time` hoặc `custom`.
- Snapshot phải tồn tại và hoàn chỉnh.
- Invalid input trả 400.
- Không đăng nhập trả 401 theo auth flow hiện tại.
- Non-admin bị chặn theo `proxy.ts`.
- Member không tồn tại trả 404.
- Snapshot chưa tồn tại trả status/code rõ ràng, ví dụ 404 `REPORT_SNAPSHOT_NOT_FOUND`.

Dùng parameterized SQL. Không nối trực tiếp query parameter vào SQL.

## 9. Repository và snapshot model

Giữ SQL trong `lib/repositories/*`, không viết truy vấn lớn trực tiếp trong component.

Có thể tạo repository riêng, ví dụ:

- `lib/repositories/member-report-snapshots.ts`
- `lib/reports/member-csv.ts`

Snapshot phải lưu đủ dữ liệu để report lịch sử không phụ thuộc vào cache hiện tại.

Có thể dùng:

- Một bảng header cho report/member/month.
- Một bảng summary theo report/range.
- Một bảng URL detail theo report/URL/range.

Hoặc thiết kế tương đương nếu đơn giản hơn.

Constraints/index tối thiểu phải đảm bảo:

- Một snapshot duy nhất cho `(report_month, member identity)`.
- Một summary duy nhất cho `(snapshot_id, range_key)`.
- Một URL metric duy nhất cho `(snapshot_id, content_url_id, range_key)`.
- `range_key` chỉ nhận 1M/3M/6M trong report.
- Foreign key phù hợp.
- Query preview/export có index.

Không lưu toàn bộ CSV blob nếu structured snapshot đủ dùng cho preview và export.

Snapshot phải được tạo transactionally:

1. Tạo hoặc xác định report header.
2. Ghi đủ ba range summary.
3. Ghi URL detail.
4. Chỉ đánh dấu `complete` sau khi toàn bộ dữ liệu thành công.
5. Rollback hoặc giữ trạng thái failed nếu lỗi.

## 10. Ownership semantics

Tôn trọng model ownership hiện tại của repo:

- URL/member attribution phải dùng convention hiện có, đặc biệt logic trong `content-url-works.ts` và repository performance.
- Không tự join chỉ bằng `content_urls.member_name` nếu codebase đã có attribution predicate.
- Ưu tiên member email làm định danh khi có.
- Không làm mất URL chỉ vì member name thay đổi.
- Chỉ export URL thuộc member tại thời điểm snapshot theo semantics hiện có.

## 11. Data integrity rules

Bắt buộc giữ các invariant của repo:

- `No Data ≠ 0`.
- `null` không được ép thành `0`.
- Không có previous period thì delta/growth phải `null`.
- Không tự coi lỗi GSC là no-data.
- Không tự tạo score cho range không hỗ trợ scoring.
- Không sửa công thức growth hoặc KPI score.
- Không đổi `growth_status`.
- Không mutate snapshot lịch sử khi refresh dữ liệu mới, trừ khi có explicit admin regenerate flow và audit rõ ràng.
- Không tạo destructive migration.

## 12. Component và code quality

- Tái sử dụng `Button`, `Card`, `CardHeader`, `EmptyState`, `PageHeader` từ `components/ui.tsx`.
- Tái sử dụng formatter hiện có cho preview.
- Không dùng formatter UI để serialize CSV.
- Tách CSV serialization thành pure function có thể test.
- Tách mapping snapshot → report DTO khỏi React component.
- Dùng `fetchJson` và `messageOf` theo convention hiện tại cho JSON preview.
- Tránh fetch tuần tự 6 API cho 3 range nếu server có thể trả một report thống nhất.
- Không thêm dependency CSV nếu serializer nhỏ và có test đầy đủ; nếu thêm dependency, giải thích lý do.

## 13. Tests and verification

Bổ sung test hoặc verification script theo convention `scripts/verify-*.mjs`.

Phải cover ít nhất:

1. Một member có nhiều URL và đủ dữ liệu 1M/3M/6M.
2. URL có `no_data`: numeric cells phải rỗng, không phải 0.
3. Previous metrics bằng 0 nhưng current > 0: giữ đúng growth logic hiện có.
4. Text chứa comma, quote, newline và ký tự tiếng Việt được export hợp lệ.
5. URL bắt đầu bằng ký tự có nguy cơ CSV formula injection được neutralize.
6. Snapshot tháng cũ không đổi sau khi cache hiện tại được refresh.
7. Member hoặc month không hợp lệ trả lỗi đúng.
8. Snapshot thiếu một trong ba range không được coi là complete.
9. Export filename đúng và response header đúng.
10. Preview và CSV lấy cùng một snapshot, không cho kết quả khác nhau.

Chạy:

```bash
npm run lint
npm run typecheck
npm run build
```

Sau đó chạy verification script mới và các script liên quan đến score/range nếu thay đổi code dùng chung.

## 14. Acceptance criteria

Feature hoàn thành khi:

- Admin mở được trang report từ navigation.
- Admin chọn month và member.
- UI hiển thị member performance ở 1M, 3M, 6M.
- UI hiển thị mỗi URL cùng performance và trend ở 1M, 3M, 6M.
- Admin tải được một CSV đúng contract.
- CSV mở đúng tiếng Việt trong Excel.
- Một URL tương ứng đúng một dòng.
- Các metric `null` không biến thành 0.
- Historical report đọc từ immutable/completed snapshot.
- Tháng chưa có snapshot báo rõ, không âm thầm dùng cache mới nhất.
- Không thay đổi công thức KPI/growth.
- Không phá auth/admin protection.
- Không có destructive migration.
- Lint, typecheck, build và verification đều pass.

## 15. Out of scope

Không làm trong feature này:

- Export PDF/XLSX.
- Gửi email tự động.
- Schedule report.
- Báo cáo project/team.
- Cho non-admin tải báo cáo của người khác.
- Thay đổi công thức Performance Score.
- Thay đổi cách xác định growth status.
- Backfill metric lịch sử bằng dữ liệu suy đoán.
- Export `all_time` hoặc `custom`.

## 16. Kết quả bàn giao

Trong final response, nêu ngắn gọn:

- Files đã thêm/sửa.
- Schema snapshot đã chọn và lý do.
- API/UI flow.
- CSV contract.
- Cách xử lý historical month.
- Các lệnh verification đã chạy và kết quả.
- Mọi giới hạn dữ liệu hoặc backfill còn tồn tại.
```

**Bước tiếp theo dưới 2 phút:** copy toàn bộ prompt trên sang agent ở chế độ Code để agent lập kế hoạch và triển khai.
