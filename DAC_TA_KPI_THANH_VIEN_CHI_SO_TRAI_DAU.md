# Đặc tả KPI thành viên khi Click và Impression trái dấu

## 1. Mục tiêu

Điều chỉnh **KPI Member × Range** khi tổng % thay đổi Click và Impression của thành viên trái dấu, để chỉ số đang tăng có nhiều ảnh hưởng hơn và chỉ số đang giảm có ít ảnh hưởng hơn.

Thay đổi phải:

- giữ nguyên thang điểm 0–100 và mốc trung tính 50;
- không thay đổi URL Score, Project Score hoặc Content KPI;
- không thay đổi cách gán URL cho thành viên, robust baseline, URL weight cap hoặc Official KPI period weights;
- giải thích và tái lập được từ dữ liệu, settings và formula version đã lưu;
- giữ Warning/Audit nhất quán với KPI Member thực tế.

## 2. Phạm vi và giả định đã chốt cho đặc tả

| Nội dung | Quy tắc |
|---|---|
| Grain áp dụng | `Member × Range` cho `last_1_month`, `last_3_months`, `last_6_months` |
| Nguồn xác định dấu | Tổng `click_growth_pct` và `impression_growth_pct` của đúng Member × Range, tính từ current so với previous period |
| Hệ số giảm impact | `d = 0.5` — trọng số của chỉ số đang giảm bị nhân 50% |
| Chuẩn hóa | Trọng số hiệu lực luôn được chuẩn hóa lại để tổng bằng 1 |
| Zero/null | Một chỉ số bằng `0` hoặc `null` không được coi là trái dấu; không điều chỉnh |
| Same-sign | Hai chỉ số cùng dấu giữ nguyên trọng số cấu hình hiện tại |
| Điểm được lưu | `member_performance_score.kpi_score` là điểm sau điều chỉnh |
| Official KPI | Không có công thức mới; tiếp tục blend 1M/3M/6M từ `kpi_score`, nên tự kế thừa thay đổi |
| Project KPI | Không đổi |
| URL Score | Không đổi |

Ngoài phạm vi: thay đổi target growth, smoothing, attribution, exclusion, accountability adjustment, Content KPI và thiết kế lại Warning/Audit workflow.

## 3. Thuật ngữ

- `C`: Click component score của Member × Range, 0–100.
- `I`: Impression component score của Member × Range, 0–100.
- `wc`, `wi`: trọng số Click và Impression lấy từ `kpi_settings`; hiện tại mặc định là `0.7` và `0.3`.
- `d`: hệ số giảm impact, phiên bản đầu là `0.5`.
- `B`: base member score trước điều chỉnh.
- `K`: effective member score sau điều chỉnh, được lưu vào `kpi_score`.

## 4. Công thức chuẩn

### 4.1. Component score của thành viên

Giữ nguyên tập URL, trạng thái score, impression-based weight và URL weight cap hiện tại.

```text
C = weighted_mean(url.click_score, capped_url_weight)
I = weighted_mean(url.impression_score, capped_url_weight)
B = wc × C + wi × I
```

Nếu tổng capped weight bằng 0, `C` và `I` dùng plain mean trên các URL đủ điều kiện, mirror đúng fallback hiện tại của `aggregateScore`.

Khi không có URL đủ điều kiện: `B = K = null`. Không được thay `null` bằng 0.

### 4.2. Xác định trường hợp trái dấu

```text
click_up_impression_down:
  click_growth_pct > 0 AND impression_growth_pct < 0

impression_up_click_down:
  click_growth_pct < 0 AND impression_growth_pct > 0

none:
  tất cả trường hợp còn lại, gồm zero và null
```

Không làm tròn % trước khi so sánh dấu.

### 4.3. Trọng số hiệu lực

```text
Nếu click_up_impression_down:
  raw_wc = wc
  raw_wi = wi × d

Nếu impression_up_click_down:
  raw_wc = wc × d
  raw_wi = wi

Nếu none:
  raw_wc = wc
  raw_wi = wi

effective_wc = raw_wc / (raw_wc + raw_wi)
effective_wi = raw_wi / (raw_wc + raw_wi)

K = clamp(effective_wc × C + effective_wi × I, 0, 100)
```

Với `wc=0.7`, `wi=0.3`, `d=0.5`:

| Trường hợp | Effective Click | Effective Impression |
|---|---:|---:|
| Không điều chỉnh | 70.00% | 30.00% |
| Click tăng, Impression giảm | 82.35% | 17.65% |
| Impression tăng, Click giảm | 53.85% | 46.15% |

Chỉ làm tròn ở UI. Tính toán và persistence giữ precision hiện tại của database.

## 5. Nguồn dữ liệu và tính nhất quán

### 5.1. Dấu tăng/giảm

Dấu phải được tính lại trong cùng score run từ các scoring input row đang dùng, không đọc một rollup có thể thuộc snapshot khác.

Logic tổng current/previous cần được tách thành pure helper dùng chung cho:

- `computeAndStoreRollups`;
- `computeAndStoreScores`;
- test arithmetic.

Nhờ đó, `%` hiển thị và case điều chỉnh luôn đến từ cùng dữ liệu và cùng cửa sổ thời gian.

### 5.2. Robust baseline

Robust baseline vẫn dùng để tạo `url.click_score` và `url.impression_score`. Dấu kích hoạt rule dùng tổng current/previous của Member × Range như UI hiện tại.

Hai khái niệm này có thể khác hướng. Đây là hành vi được chấp nhận, nhưng API/UI phải trả đủ base score, component score và effective weights để giải thích.

## 6. Dữ liệu lưu trữ

Tạo migration additive tiếp theo, không sửa hoặc xóa migration cũ.

Thêm vào `member_performance_score`:

| Cột | Kiểu gợi ý | Ý nghĩa |
|---|---|---|
| `base_kpi_score` | `numeric null` | Điểm 70/30 trước điều chỉnh |
| `click_component_score` | `numeric null` | `C` |
| `impression_component_score` | `numeric null` | `I` |
| `effective_click_weight` | `numeric null` | Trọng số Click sau chuẩn hóa |
| `effective_impression_weight` | `numeric null` | Trọng số Impression sau chuẩn hóa |
| `direction_adjustment` | `text not null default 'none'` | `none`, `click_up_impression_down`, `impression_up_click_down` |
| `opposite_sign_factor` | `numeric null` | `d` đã dùng; null khi không điều chỉnh |
| `formula_version` | `text not null` | Phiên bản công thức, ví dụ `member-opposite-sign-v1` |

Ràng buộc:

- effective weights phải trong `[0,1]` và tổng xấp xỉ 1 khi `kpi_score` khác null;
- component/base/effective score phải trong `[0,100]` hoặc null;
- `direction_adjustment` chỉ nhận ba giá trị đã định nghĩa;
- migration không tự phát minh component score cho dữ liệu cũ; sau migration phải chạy recompute từ cache.

Thêm `effective_score_snapshot numeric null` vào `url_kpi_warnings`. `raw_score_snapshot` tiếp tục giữ URL score gốc; `kpi_drag_points` phải dựa trên effective member-specific URL score.

## 7. Tác động Warning/Audit

Vì Project/URL score vẫn là 70/30 nhưng Member score có effective weights riêng, Warning không được tiếp tục lấy trực tiếp `url_performance_score.score` để tính drag.

Với mỗi Member × Range:

```text
effective_url_score =
  effective_wc × url.click_score
  + effective_wi × url.impression_score

kpi_drag_points =
  max(0, 50 - effective_url_score)
  × member_url_weight_share
```

Yêu cầu:

- member URL weight share phải mirror đúng cap/fallback của KPI Member;
- `settings_snapshot` hoặc `metric_snapshot` phải lưu component scores, base/effective weights, factor, direction và formula version;
- tăng `WARNING_RULE_VERSION` để kết quả mới không ghi đè warning của formula cũ;
- `raw_score_snapshot` là URL score gốc; `effective_score_snapshot` là score thực dùng để tính drag;
- tổng hợp từ effective URL scores phải tái tạo đúng `member_performance_score.kpi_score` trong cùng snapshot, sai số tối đa `1e-9` trước rounding.

## 8. API và UI bắt buộc

Các API trả Member KPI phải bổ sung:

```text
base_kpi_score
click_component_score
impression_component_score
effective_click_weight
effective_impression_weight
direction_adjustment
opposite_sign_factor
formula_version
```

Ở bảng KPI Member:

- `Range score` hiển thị `kpi_score` sau điều chỉnh;
- khi `direction_adjustment != none`, hiển thị một indicator dễ nhận biết;
- phần giải thích phải cho biết base score → effective score, % Click/Impression và trọng số base → effective;
- Project view không hiển thị hoặc áp dụng rule này;
- null tiếp tục hiển thị `—`.

Không yêu cầu thay đổi giao diện mang tính trang trí ngoài thông tin tối thiểu để giải thích điểm.

## 9. Danh sách triển khai theo ưu tiên

### P0 — Đúng công thức và không phá KPI hiện tại

1. **Pure scoring contract**
   - Tạo `aggregateMemberScore` hoặc tương đương.
   - Tái sử dụng đúng capped weights/fallback hiện tại.
   - `aggregateScore` của Project và `computeUrlScore` không đổi hành vi.
   - Same-sign/zero/null cho kết quả bằng logic cũ.

2. **Nguồn dấu đồng nhất**
   - Tách helper tổng current/previous dùng chung cho rollup và score.
   - Recompute endpoint phải tự tính dấu từ cache của đúng range, không phụ thuộc rollup stale.

3. **Persistence có thể audit**
   - Migration additive cho các cột ở mục 6.
   - Update repository upsert/select/type.
   - `kpi_score` lưu điểm effective; `base_kpi_score` lưu điểm trước điều chỉnh.

4. **Tích hợp refresh/recompute**
   - Member dùng aggregator mới.
   - Project tiếp tục aggregator cũ.
   - Official KPI tiếp tục đọc `kpi_score` mà không thêm bonus/penalty tầng 3.

5. **Warning/Audit nhất quán**
   - Warning dùng effective URL score và effective member weights.
   - Lưu snapshot, tăng rule version và giữ lịch sử formula cũ.

6. **Acceptance test P0**
   - Hai case trái dấu cho đúng effective weights nêu ở mục 4.3.
   - Hai case cùng dấu, zero, null không đổi score.
   - Không URL đủ điều kiện trả null.
   - Project score trước/sau giống nhau.
   - Base member score khớp logic cũ trong sai số `1e-9`.
   - Warning drag tái lập đúng từ snapshot.

### P1 — Sẵn sàng phát hành và vận hành

1. **API/UI explainability tối thiểu** theo mục 8.
2. **Migration verification** chạy trong transaction và rollback, kiểm tra schema, constraints và upsert idempotency.
3. **Backfill/recompute** toàn bộ 1M/3M/6M từ cache sau migration; không gọi GSC.
4. **Before/after reconciliation** xuất số Member × Range bị điều chỉnh, min/max/average score delta và xác nhận Project KPI không đổi.
5. **Regression suite**: `verify-score`, warning/audit verification, typecheck và production build đều pass. Assertion cũ `previous=null` so với `previous=0` phải chỉ so sánh scoring semantics, không so metadata baseline khác nhau.
6. **Rollout an toàn**: deploy migration trước, deploy code sau, recompute, rồi mới coi feature active. Nếu recompute thất bại, UI không được trộn row công thức cũ/mới mà không gắn formula version.

### P2 — Theo dõi và quản trị sau phát hành

1. **Report điều chỉnh** lọc được các row `direction_adjustment != none`, gồm base/effective score và score delta.
2. **Guardrail phân phối** theo dõi tỷ lệ row được điều chỉnh và độ dịch chuyển KPI; cảnh báo vận hành nếu score delta vượt ngưỡng được team phê duyệt.
3. **Backtest closed periods** để so sánh mức thay đổi theo thành viên/range trước khi cân nhắc đổi `d=0.5`.
4. **Tài liệu công thức** cập nhật README và Performance Score spec để 70/30 được mô tả là base weights, không còn được hiểu là effective weights trong mọi Member case.

Không đưa vào backlog các hạng mục P3/cosmetic hoặc tối ưu không ảnh hưởng tính đúng, khả năng audit hay vận hành KPI.

## 10. Tiêu chí hoàn thành

Feature chỉ được coi là hoàn thành khi:

- toàn bộ P0 và P1 pass;
- migration và recompute chạy thành công trên môi trường đích;
- reconciliation xác nhận URL/Project KPI không đổi;
- mỗi Member score điều chỉnh giải thích được bằng component scores, raw %, factor và effective weights;
- Warning/Audit dùng đúng cùng formula version và tái tạo được KPI drag;
- không còn test failure chưa phân loại liên quan đến scoring, refresh hoặc warning.

P2 có thể triển khai sau nhưng phải được ghi nhận thành backlog có owner; không chặn release nếu P0/P1 đã đạt đầy đủ.
