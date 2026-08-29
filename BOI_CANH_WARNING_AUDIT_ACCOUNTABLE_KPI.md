# Bối cảnh: Warning / Audit / Accountable KPI

**Dự án:** Performance SEO Project  
**Ngày tổng hợp:** 29/08/2026  
**Trạng thái:** Bối cảnh đã thống nhất để tiếp tục hoàn thiện policy và đặc tả triển khai  
**Nguồn đề xuất gần nhất:** `C:\Users\user\Downloads\Dac_Ta_Warning_Audit_Content_V2.md`

> Đây là tài liệu bối cảnh và handoff, không tự động cấp quyền sửa code hoặc triển khai. Khi bắt đầu implementation, phải đối chiếu lại repo, DB, đặc tả cuối cùng và hướng dẫn Next.js trong `AGENTS.md`.

## 1. Vấn đề cần giải quyết

KPI Performance hiện tại phản ánh biến động traffic Search Console, nhưng chưa phân biệt được nguyên nhân suy giảm:

1. URL giảm do lỗi thực sự như content lỗi thời, technical issue, cannibalization hoặc lỗi vận hành nội bộ — phải tính đầy đủ vào KPI.
2. URL giảm do yếu tố đã được xác minh là ngoài tầm kiểm soát như thay đổi nhu cầu thị trường, SERP feature mới hoặc một tác động bên ngoài có bằng chứng — cần được xem xét riêng.

Mục tiêu không phải tạo cơ chế miễn điểm, mà tách hai câu hỏi:

- **Observed Performance KPI:** Traffic thực tế đã diễn biến như thế nào?
- **Accountable Performance KPI:** Phần kết quả nào hợp lý để quy trách nhiệm cho member sau một quy trình audit có bằng chứng và phê duyệt?

Observed KPI luôn được bảo toàn. Accountable KPI chỉ được tạo sau khi audit đã kết thúc và được duyệt.

## 2. Hiện trạng cách tính KPI

### 2.1. Ba tầng tính điểm

```text
URL metrics
→ URL score
→ Member score theo từng range 1M / 3M / 6M
→ Official KPI = kết hợp ba range theo trọng số
```

Official KPI mặc định:

```text
25% × 1M + 50% × 3M + 25% × 6M
```

Nếu member có cấu hình chiến lược cá nhân thì dùng trọng số cá nhân; nếu một kỳ không có dữ liệu, trọng số các kỳ còn lại được renormalize thay vì coi kỳ thiếu là 0.

### 2.2. URL score

- Click score chiếm 70%.
- Impression score chiếm 30%.
- Traffic không đổi tương ứng gần mức trung tính 50.
- Tăng trưởng đạt target có thể đạt 100.
- Suy giảm kéo điểm xuống dưới 50 và có thể chạm sàn 0.
- Member range score là trung bình URL score có trọng số theo impressions.
- Mỗi URL có weight cap mặc định 40% raw total, áp dụng theo cơ chế single-pass hiện tại.

### 2.3. Attribution theo member

Attribution được xác định theo work events nằm trong range. Một URL có thể xuất hiện dưới nhiều member và được tính đầy đủ cho từng member. Vì vậy tác động KPI của một URL là thuộc tính của:

```text
URL × member × range × score snapshot
```

Không thể chỉ lưu Warning ở grain URL.

## 3. Case khởi nguồn: Hướng Dương

Snapshot được refresh ngày 28/08/2026:

| Kỳ | Click tổng | Impression tổng | KPI range |
|---|---:|---:|---:|
| 1M | -26,56% | -28,54% | 14,72 |
| 3M | +10,70% | -35,41% | 27,45 |
| 6M | +14,71% | +0,87% | 33,26 |

Official KPI:

```text
14,72 × 25% + 27,45 × 50% + 33,26 × 25% = 25,72
```

Điểm thấp không đến từ thiếu dữ liệu:

- 22 URL eligible.
- 0 excluded.
- 0 no-data.
- 0 URL chạm cap.
- Có đủ 1M, 3M và 6M.

Nguyên nhân là hiệu ứng lệch cơ cấu: một số URL tăng mạnh giúp tổng clicks 3M/6M nhìn ổn, nhưng các URL cũ có nhiều impressions lại giảm và mang trọng số lớn. Ví dụ:

- `what-do-irish-people-look-like` chiếm khoảng 25–28% trọng số trong 3M/6M và là nguồn kéo điểm lớn nhất.
- `irish-surnames` và `what-do-scottish-people-look-like` cũng có weight lớn và score thấp.
- Các URL tăng mạnh có weight nhỏ hơn và score bị chặn tối đa ở 100 nên không bù hết phần giảm của các URL lớn.

Case này chứng minh tổng traffic và KPI URL-weighted trả lời hai câu hỏi khác nhau, đồng thời tạo nhu cầu audit nguyên nhân thay vì tự động miễn điểm.

## 4. Các quyết định đã thống nhất

### 4.1. Workflow không bao giờ tự đổi điểm

- `needs_audit`: không đổi KPI.
- `in_progress`: không đổi KPI, kể cả quá SLA.
- SLA chỉ đo hiệu quả vận hành và cảnh báo tồn đọng.
- Chỉ audit `resolved` và đã được phê duyệt mới có thể tạo Accountable KPI khác Observed KPI.

Điều này loại bỏ lỗ hổng chuyển URL xấu sang `in_progress` trước ngày review để né KPI, đồng thời giữ khả năng tái lập.

### 4.2. Không loại URL và không giảm weight

Không dùng exclusion hoặc weight reduction vì chúng làm thay đổi mẫu số và có thể khiến các URL còn lại được lợi gián tiếp.

Giữ nguyên URL weight và chỉ trung hòa phần giảm:

```text
accountable_url_score =
  raw_score + external_share × max(0, 50 - raw_score)
```

Quy tắc:

- Chỉ áp dụng khi `raw_score < 50`.
- Không bao giờ biến external cause thành điểm thưởng trên 50.
- `external_share = 0`: giữ nguyên raw score.
- `external_share = 0.5`: trung hòa một nửa phần dưới 50.
- `external_share = 1`: đưa URL về đúng 50.

### 4.3. Chỉ dùng ba mức external share

```text
0 / 0.5 / 1
```

Đây là đánh đổi có chủ đích: ưu tiên tính nhất quán và khả năng giải thích hơn độ chính xác giả tạo như 0,37 hoặc 0,82.

### 4.4. Bốn kết luận audit

| Kết luận | External share | Xử lý |
|---|---:|---|
| `controllable` | 0 | Giữ nguyên điểm |
| `external_verified` | 1 | Trung hòa phần giảm về 50 |
| `mixed` | 0,5 | Trung hòa một nửa phần giảm |
| `insufficient_evidence` | 0 | Giữ nguyên điểm |

Mặc định luôn nghiêng về accountable: không đủ bằng chứng thì không điều chỉnh.

### 4.5. Anomaly không phải bằng chứng external cause

Anomaly chỉ cho biết một tháng khác thường so với lịch sử. Nó không chứng minh member không chịu trách nhiệm.

Hệ thống anomaly/baseline hiện chỉ quyết định tháng nào được dùng làm baseline. Nó không được dùng để tự động miễn hoặc trung hòa điểm kỳ hiện tại.

## 5. Warning và Mandatory Audit

### 5.1. Warning phải dựa trên impact

Không dùng nhãn `stable ±1%` làm trigger vì quá nhạy và không xét quy mô traffic.

Ngưỡng khởi tạo để backtest, chưa phải policy cuối:

**Early Warning 1M**, thỏa tất cả:

- `data_status = ok`.
- Click giảm khoảng 15–20% trở lên.
- Mức giảm tuyệt đối vượt ngưỡng tối thiểu.
- URL score dưới 40.
- KPI drag của URL đối với member từ 0,5 điểm trở lên.

**Mandatory Audit 3M**:

- URL score 3M dưới 40 và KPI drag từ 1 điểm trở lên; hoặc
- Warning xuất hiện trong hai closed-month evaluations liên tiếp.

### 5.2. Công thức KPI drag

```text
kpi_drag_points =
  max(0, 50 - url_score)
  × member_capped_url_weight
  ÷ member_total_capped_weight
```

Nếu `member_total_capped_weight = 0`, phải mirror fallback của aggregate hiện tại:

```text
kpi_drag_points =
  max(0, 50 - url_score) ÷ eligible_url_count
```

### 5.3. Closed-period và daily monitoring

1M/3M/6M hiện là rolling ranges và có thể refresh hằng ngày. Các cửa sổ liên tiếp chồng lấn gần như hoàn toàn, nên không được coi hai daily refresh là hai kỳ độc lập.

Quyết định cần áp dụng:

- Daily signal có thể dùng cho monitoring UI.
- Warning chính thức và điều kiện “hai kỳ liên tiếp” phải dựa trên monthly cutoff/closed-month evaluations.
- Mỗi Warning phải có idempotency key theo URL, member, range, start date, end date và rule version.
- Không tạo audit case trùng nếu đã có case đang mở cho cùng URL và khoảng nguyên nhân.

## 6. Bằng chứng và governance

### 6.1. External cause không được suy ra tự động

Việc một Google core update xảy ra cùng thời điểm không đủ để kết luận `external_verified`. Core update có thể tác động toàn thị trường, nhưng cũng có thể bộc lộ vấn đề content thuộc trách nhiệm nội bộ.

Audit `external_verified` hoặc `mixed` tối thiểu cần:

- Khoảng thời gian bị ảnh hưởng.
- Query/page/device/country nào giảm.
- Cohort hoặc bằng chứng cho thấy xu hướng không chỉ xảy ra riêng URL/site.
- Technical, index, content và cannibalization check.
- SERP snapshot/báo cáo hoặc nguồn đối chứng.
- Confidence note.
- Người đề xuất và người phê duyệt khác nhau.

### 6.2. Ràng buộc phê duyệt

DB và API phải enforce:

- `approved_by != proposed_by`.
- `resolved` bắt buộc có conclusion, approved by và approved at.
- `external_verified`/`mixed` bắt buộc có evidence.
- Chỉ audit approved mới được tạo adjustment.
- `effective_end >= effective_start`.
- External share chỉ thuộc `{0, 0.5, 1}`.
- Mọi adjustment/restatement phải có audit event tương ứng.

### 6.3. Append-only log

Append-only không chỉ là tên bảng. Cần:

- Không có API sửa/xóa event.
- DB role không được update/delete event, hoặc có trigger từ chối mutation.
- Actor dùng immutable account ID/email.
- Event lưu previous state, next state, actor, timestamp, policy version và detail.

## 7. Newpost và baseline

### 7.1. Xét theo URL, không theo project

Project có thể chứa cả URL mới và URL cũ. Dữ liệu hiện tại:

- Print Your Wear: 67/67 URL có work event `new`.
- Stories of Polynesian Pride: 111/112 URL `new`.
- Tartan Vibes Clothing: 2 URL `new`, 24 URL `existing`.

Dùng:

- `content_url_works.work_kind`.
- `content_urls.published_at`.
- `baseline_sample_count`.

Không tạo `is_newpost_project`.

### 7.2. Adjustment eligibility

Định hướng:

```text
adjustment_eligible =
  evidence package đạt chuẩn
  AND URL đủ tuổi/lịch sử theo policy
```

Baseline giúp xác định mức giảm có bất thường so với lịch sử, nhưng không tự chứng minh nguyên nhân external. Team cần chốt một trong hai policy:

1. Bắt buộc baseline đủ mạnh trước mọi adjustment — guardrail thận trọng.
2. Cho phép ngoại lệ khi bằng chứng external độc lập rất mạnh, kèm cấp duyệt cao hơn.

`baseline_sample_count` là số complete baseline windows, không phải số tháng. Ngưỡng phải theo range; không dùng một con số chung cho 1M, 3M và 6M.

### 7.3. Trạng thái dữ liệu hiện tại

- `content_url_monthly_metrics`: 0 dòng.
- URL có monthly history: 0.
- `baseline_lookback_periods`: 1.
- Anomaly/manual override đã ghi nhận: 0.

Do đó baseline/anomaly hiện mới tồn tại trong code/schema nhưng chưa vận hành thực tế. Giai đoạn 1 vẫn có thể chạy Warning bằng dữ liệu rolling hiện tại; Giai đoạn 2 cần backfill và score snapshot/versioning trước khi shadow Accountable KPI đáng tin cậy.

## 8. Kiến trúc xử lý

Adjustment phải nằm ở tầng URL aggregation, không đặt riêng trong `composite-score.ts`.

```text
URL metrics
→ raw URL score
→ approved adjustment/neutralization
→ raw member range score + accountable member range score
→ Observed Official KPI + Accountable Official KPI
```

Các điểm tích hợp chính trong repo hiện tại:

- `lib/performance/score.ts`: URL scoring và member aggregation.
- `lib/performance/refresh.ts`: compute/store score theo range.
- `lib/performance/composite-score.ts`: kết hợp 1M/3M/6M sau khi range score đã có.
- `lib/repositories/content-url-works.ts`: member attribution theo range.
- `lib/repositories/content-url-monthly-metrics.ts`: baseline/anomaly history.
- `migrations/004_kpi_performance_score.sql`: score tables và global `kpi_excluded` hiện tại.
- `migrations/013_baseline_history.sql`: monthly history và anomaly override.

Không dùng `content_urls.kpi_excluded` cho audit adjustment vì đây là flag toàn cục, không có phạm vi thời gian.

## 9. Grain và data model mục tiêu

### 9.1. Warning impact

Warning phải lưu member-specific impact:

```text
url_kpi_warnings {
  id,
  content_url_id,
  member_name,
  range_key,
  start_date,
  end_date,
  rule_version,
  metric_snapshot,
  attribution_snapshot,
  raw_score_snapshot,
  capped_weight_snapshot,
  member_total_weight_snapshot,
  kpi_drag_points,
  triggered_at,
  resolved_at
}
```

### 9.2. Audit case

Audit nguyên nhân có thể nằm ở cấp URL và liên kết với một hoặc nhiều Warning impact:

```text
url_kpi_audits {
  id,
  content_url_id,
  status,
  conclusion,
  evidence,
  confidence_note,
  proposed_by,
  proposed_at,
  approved_by,
  approved_at,
  sla_deadline,
  resolved_at
}
```

Không lưu `sla_breached` boolean. Tính breach từ deadline và resolved time, hoặc ghi một append-only breach event.

### 9.3. Score-bound adjustment

`effective_start/end` một mình chưa đủ vì external event có thể chỉ chiếm một phần của rolling 3M/6M. Giai đoạn đầu nên bind adjustment vào score snapshot cụ thể:

```text
url_kpi_adjustments {
  id,
  audit_id,
  content_url_id,
  member_name,
  range_key,
  start_date,
  end_date,
  score_run_id,
  formula_version,
  settings_snapshot,
  attribution_snapshot,
  external_share,
  raw_score_snapshot,
  accountable_score_snapshot,
  policy_version,
  approved_at
}
```

Không tự động lấy kết luận của score 3M áp cho toàn bộ score 6M. Nếu muốn prorate theo thời gian bị ảnh hưởng, cần thiết kế month-level adjustment ở giai đoạn sau.

### 9.4. Audit events

```text
url_kpi_audit_events {
  id,
  audit_id,
  content_url_id,
  event_type,
  previous_state,
  next_state,
  actor_id,
  occurred_at,
  policy_version,
  detail
}
```

## 10. Khả năng tái lập và versioning

`policy_version` chưa đủ để tái lập KPI. Một score snapshot cần khóa:

- Formula version.
- KPI settings snapshot.
- Raw URL metrics.
- Baseline values/sample count.
- Member attribution.
- Raw và capped weights.
- Range start/end.
- Score run ID.
- Approved adjustments.

Hiện `url_performance_score` chỉ giữ bản mới nhất của mỗi `URL × range_key`, nên Giai đoạn 2 cần score history/snapshot trước khi có thể restate một kỳ một cách đáng tin cậy.

## 11. Dashboard metrics cần định nghĩa

```text
adjustment_uplift =
  accountable_kpi - observed_kpi

adjusted_url_exposure =
  sum(capped_weight của URL có external_share > 0)
  ÷ total_capped_weight

external_adjusted_exposure =
  sum(capped_weight × external_share)
  ÷ total_capped_weight

pending_audit_exposure =
  sum(capped_weight của URL có audit chưa resolved)
  ÷ total_capped_weight
```

Nếu total weight bằng 0, exposure phải có quy tắc fallback rõ ràng hoặc trả `N/A`, không chia cho 0.

Dashboard luôn hiển thị song song:

- Observed KPI.
- Accountable KPI.
- Adjustment uplift.
- Adjusted/external exposure.
- Pending audit exposure.
- Số audit overdue.
- Policy/formula version của kỳ.

## 12. Lộ trình triển khai

### Giai đoạn 1 — Warning/Audit, không đổi KPI

- Tạo Warning theo impact.
- Audit queue, SLA, evidence và approval.
- Chỉ cần Warning/Audit/Event tối thiểu; chưa cần Accountable KPI production.
- KPI chính thức vẫn là Observed KPI.
- Backfill monthly history song song.
- Có thể dừng ở giai đoạn này mà vẫn tạo giá trị vận hành.

### Giai đoạn 2 — Shadow Accountable KPI

- Bổ sung score history/snapshot và adjustment.
- Tính Accountable KPI song song, không dùng đánh giá chính thức.
- Backtest ngưỡng Warning/Mandatory Audit.
- Đo audit workload, consistency và mức thay đổi ranking.
- Chạy tối thiểu 2–3 kỳ, nhưng không dùng số kỳ làm tiêu chí duy nhất.

### Giai đoạn 3 — Accountable KPI chính thức

- Chỉ bật sau khi policy và workflow đạt tiêu chí go/no-go.
- Khóa period/version.
- Restatement có append-only audit log.
- Adjustment exposure lớn phải có cấp duyệt cao hơn.
- Observed KPI vẫn được giữ và hiển thị vĩnh viễn.

## 13. Tiêu chí go/no-go sau Giai đoạn 2

Team cần chốt target trước khi bắt đầu shadow mode. Các metric tối thiểu:

- Tỷ lệ Mandatory Audit đóng trong SLA.
- Median/P95 thời gian audit.
- Số giờ audit trên mỗi kỳ.
- Tỷ lệ `insufficient_evidence`.
- Mức đồng thuận auditor/approver.
- Warning precision hoặc actionable yield.
- Tỷ lệ member có adjustment.
- Median/P95 adjustment uplift.
- External-adjusted exposure.
- Số case vượt ngưỡng exposure cần duyệt cấp cao.
- Số trường hợp adjustment thay đổi ranking đáng kể.
- Phân bố audit theo member/project để phát hiện bias hoặc gaming.

“False positive Warning” cần được định nghĩa trước khi đo, ví dụ Warning tự hồi phục trong hai closed months mà không có vấn đề actionable hoặc external cause.

## 14. Guardrails vận hành

- Audit ưu tiên theo KPI drag, không theo số lượng URL.
- Có thể giới hạn queue và ưu tiên nhóm URL tạo khoảng 80% tổng KPI drag.
- Không cho người đề xuất tự duyệt.
- Không điều chỉnh khi thiếu evidence.
- Không áp adjustment tự động từ anomaly/core-update label.
- Không cho adjustment vô thời hạn hoặc tự lan sang range khác.
- Nếu external-adjusted exposure vượt ngưỡng policy, cần cấp duyệt cao hơn.
- Các ngưỡng 15–20%, score 40, drag 0,5/1 và exposure 20–30% đều là giá trị thử nghiệm, phải cấu hình và backtest, không hard-code.

## 15. Blocker phải chốt trước implementation

### P0

1. Grain `URL × member × range × score snapshot` cho Warning và adjustment.
2. Closed-period, daily monitoring, idempotency và duplicate audit policy.
3. Score snapshot/history và versioning để KPI tái lập được.
4. Quy tắc partial overlap giữa external event và rolling 1M/3M/6M.

### P1

1. Ngưỡng Warning/Mandatory Audit sau backtest.
2. Absolute click-loss floor.
3. Baseline requirement theo từng range.
4. Evidence schema và cohort chuẩn.
5. Approval roles và escalation threshold.
6. Exposure formulas và zero-weight fallback.
7. Warning resolution/reopen policy.
8. Go/no-go target của Giai đoạn 2.

## 16. Phạm vi không giải quyết

- Không thay thế Content Review KPI đang chấm chất lượng công việc bằng checklist.
- Không tự động xác định nguyên nhân external chỉ từ GSC URL metrics.
- Không thay đổi Observed KPI hiện tại.
- Không dùng audit để che giấu traffic decline thực tế.
- Không dùng Accountable KPI production trước khi shadow/backtest đạt yêu cầu.
- Không giải quyết toàn bộ bài toán causal attribution giữa nhiều member cùng làm một URL; V1 của tính năng kế thừa attribution hiện tại và phải hiển thị attribution snapshot minh bạch.

## 17. Thứ tự công việc đề xuất cho Agent tiếp theo

1. Xác nhận bốn quyết định P0 với người quản lý KPI.
2. Chuyển tài liệu bối cảnh này thành đặc tả implementation cuối cùng.
3. Trước khi code, đọc `AGENTS.md` và relevant Next.js docs trong `node_modules/next/dist/docs/`.
4. Kiểm tra migration/schema thực tế và dữ liệu production trước khi chọn data model cuối.
5. Thiết kế Giai đoạn 1 độc lập, không kéo Accountable KPI production vào scope.
6. Viết acceptance criteria và test matrix cho state transitions, approval, idempotency, attribution và zero-weight edge case.
7. Chỉ sau khi Giai đoạn 1 ổn định mới thiết kế score history và shadow Accountable KPI.

## 18. Tài liệu/code tham chiếu

- `C:\Users\user\Downloads\Dac_Ta_Warning_Audit_Content_V2.md`
- `PERFORMANCE_SCORE_SPEC_v2.md`
- `lib/performance/score.ts`
- `lib/performance/refresh.ts`
- `lib/performance/composite-score.ts`
- `lib/performance/growth.ts`
- `lib/performance/anomaly.ts`
- `lib/repositories/content-url-works.ts`
- `lib/repositories/content-url-monthly-metrics.ts`
- `migrations/004_kpi_performance_score.sql`
- `migrations/011_work_events.sql`
- `migrations/013_baseline_history.sql`

