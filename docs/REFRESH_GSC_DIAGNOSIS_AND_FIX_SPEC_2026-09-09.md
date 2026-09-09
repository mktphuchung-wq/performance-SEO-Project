# Refresh Search Console — xác minh và đặc tả sửa

Ngày kiểm tra: 09/09/2026. Trạng thái: P0 đã triển khai trong workspace; migration 016 và 017 đã áp dụng vào database đang cấu hình. Chưa deploy production, chưa cấu hình ba GSC property và chưa chạy lại refresh bằng tài khoản Google có quyền.

## 1. Kết luận đã xác minh

Đã truy vấn database được cấu hình trong môi trường workspace bằng transaction READ ONLY; credentials được nạp nội bộ, không in ra. Ba run trong DB khớp chính xác thông báo người dùng. Chưa đối chiếu deployment/browser đang mở với workspace, chưa kiểm tra quyền Google của phiên đăng nhập.

| Project | URL active | Mapping ở content_urls |
|---|---:|---|
| Stories of Polynesian Pride | 120 | NULL toàn bộ |
| Print Your Wear | 78 | NULL toàn bộ |
| Tartan Vibes Clothing | 40 | NULL toàn bộ |

`project_gsc_properties` hiện có 0 bản ghi. Đây là thiếu cấu hình mapping, không chỉ lỗi đồng bộ giữa hai bảng. Chưa có bằng chứng xác định ai/chức năng nào làm mapping trống hoặc mapping chưa từng được nhập.

| Range | Run ID | Bắt đầu UTC | Kết quả |
|---|---|---|---|
| last_1_month | 35ecc23b-1325-4e33-855c-707a90010418 | 2026-09-09 02:16:19.837 | partial, 238/238 lỗi |
| last_3_months | b9e2c64c-cdca-468b-b977-8eadd21e8b1f | 2026-09-09 02:16:38.562 | partial, 238/238 lỗi |
| last_6_months | 00c4c3ff-03fa-43c8-868a-42c9cf6bfd8e | 2026-09-09 02:16:58.782 | partial, 238/238 lỗi |

Mỗi run có một item `internal`, 238 URL, status `error`, api_call_count = 0; gsc_call_count của run cũng bằng 0. Cả 714 cache rows thuộc ba range đều là error, chia đúng 120/78/40 theo project. Thông báo gốc: `No Search Console property mapped for project "…". Set it in Admin -> Settings.`

Do chưa gọi GSC, OAuth hết hạn, thiếu scope, quyền property và quota không phải nguyên nhân của ba run này. Các điều kiện đó vẫn cần kiểm tra sau khi cấu hình mapping. Migration 001–015 đã có trong schema_migrations của DB kiểm tra; không cần chạy lại 015 để giải quyết sự cố này.

## 2. Chuỗi nguyên nhân trong code hiện tại

1. `lib/sync/sheet.ts`: lấy mapping bằng tên project; không tìm thấy thì gscProperty = null.
2. `lib/repositories/refresh-runs.ts`, planItems: URL thiếu property được gom vào item internal thay vì chặn trước khi chạy.
3. `lib/performance/refresh.ts`, processInternalItem: tạo error cho URL đủ điều kiện, không gọi Google.
4. publishRefreshRun chỉ kiểm tra đủ staged rows, không kiểm tra chất lượng. publishStagedPerformanceCache ghi cả error vào cache chính rồi chạy rollup/scoring/warning. Có bất kỳ failed URL thì đánh dấu partial, kể cả 100% failed.
5. `components/SyncRefreshPanel.tsx`: completed tăng cho cả partial; UI in “3 of 3 ranges refreshed” kèm lỗi. Đây là hoàn thành xử lý lỗi, không phải lấy được dữ liệu.

Hệ quả đã thấy: cache hiện toàn error. Rủi ro xác định từ code: lần chạy lỗi có thể ghi đè metrics hợp lệ cũ và cập nhật timestamp như mới; chưa có bằng chứng rằng trước ba run này đã có metrics hợp lệ bị mất. Không được kết luận traffic thực tế bằng 0 từ cache lỗi.

## 3. Khôi phục chức năng bằng cấu hình

Sau khi được giao triển khai/khôi phục:

1. Dùng tài khoản Google thực sự sẽ chạy refresh, lấy danh sách property từ sites.list. Chọn property chính xác cho từng project, kiểm tra domain/URL-prefix bao phủ URL. Không suy đoán chuỗi property từ tên thương hiệu hoặc hostname.
2. Lưu ba mapping qua Admin Settings hiện có. Repository hiện đã cập nhật content_urls ngay sau khi lưu, nên không cần bắt người dùng sync Sheet lại hay sửa SQL thủ công.
3. Kiểm tra lại bảng mapping có đủ ba project, 238 URL được map, không có lệch mapping. Query nhỏ đọc GSC cho từng property để xác minh quyền và khoảng ngày.
4. Chạy lại ba range, so sánh một số URL có dữ liệu/không có dữ liệu với GSC cùng property, ngày và loại search. Không yêu cầu 238 URL đều có traffic; yêu cầu 0 lỗi cấu hình/quyền và các trạng thái được phân loại đúng.
5. Giữ ba run cũ làm bằng chứng. Không xóa hàng loạt cache/history hoặc reset KPI để che lỗi.

Đây là hướng khôi phục, chưa được thực hiện trong đợt review này. Property chính xác vẫn cần lấy từ phiên Google có quyền.

## 4. Đặc tả P0 — ngăn tái diễn và bảo vệ dữ liệu

### 4.1 Preflight ở server

- Trước enqueue: kiểm tra session.error, token, phạm vi người gọi; resolve project mapping và snapshot URL đủ điều kiện theo range.
- Thiếu mapping của URL đủ điều kiện: trả HTTP 422, code MISSING_GSC_MAPPING, danh sách project + affectedUrlCount + đường dẫn Settings. Không tạo work items, không publish, không gọi scoring. URL not_eligible không bị tính nhầm thành lỗi mapping.
- Kiểm tra property có thể truy cập bằng chính identity thực thi. Thiếu quyền trả lỗi có cấu trúc theo property; lỗi đăng nhập trả 401. Không coi property vắng trong danh sách là no_data.
- Preflight nhiều range dùng chung kết quả kiểm tra cấu hình/quyền khi thích hợp; server vẫn phải kiểm tra tại start, tránh chỉ kiểm tra ở UI. Nếu lỗi chung, không lặp lại cùng một refresh lỗi cho ba range.
- Cố định mapping trong snapshot run. Nếu mapping thay đổi giữa preflight và start, kiểm tra lại bằng revision/fingerprint; không sử dụng xác nhận cũ.

### 4.2 Mapping nhất quán

- `project_gsc_properties` là nguồn cấu hình chính; content_urls.gsc_property là dữ liệu dẫn xuất tương thích hệ thống hiện tại.
- Upsert/delete mapping và cập nhật URL phải nằm trong cùng transaction. Hiện hai câu lệnh chạy tách biệt, có thể lệch nếu câu sau thất bại.
- Validate server: project tồn tại, property lấy từ danh sách có quyền và bao phủ URL của project. Dropdown hiện có không thay thế validation server.
- Không tự đổi project_type khi sửa mapping. Tránh ghép fuzzy tên project âm thầm; nếu chuẩn hóa tên thì phải có kiểm tra collision và kế hoạch backfill riêng.
- Sync chạy đồng thời không được ghi lại mapping cũ/null sau khi Admin sửa: resolve mapping tại bước ghi hoặc dùng version check/retry.

### 4.3 Quy tắc publish và trạng thái

Đề xuất chọn snapshot nguyên tử theo range để KPI không trộn kỳ hoặc trộn lần lấy dữ liệu:

| Kết quả đo | Status | Publish cache/rollup/score/warning |
|---|---|---|
| Tất cả URL đủ điều kiện được xử lý hợp lệ; có thể toàn no_data | success | Có, trong một transaction |
| Một phần URL lỗi | partial | Không; giữ staging để chẩn đoán/retry |
| Toàn bộ URL đủ điều kiện lỗi hoặc lỗi hệ thống | failed | Không |
| Thiếu cấu hình trước enqueue | HTTP 422 | Không |
| Không có URL đủ điều kiện | success với lý do rõ ràng | Không tạo số đo GSC giả |

Thay đổi nghĩa partial phải được áp dụng đồng bộ API/UI: thêm published boolean, last_attempt_at, last_success_at, published_run_id. Không dùng processed_urls hoặc finished_at để chứng minh dữ liệu mới. Nếu giữ cache cũ, hiển thị ngày thực tế và stale; nếu chưa có cache hợp lệ, hiển thị unavailable, không phải 0.

Không xóa lỗi khỏi staging để đạt điều kiện publish. Retry phải hoàn thành đầy đủ snapshot cùng dates/mapping trước khi publish. Ghi cache, rollup, score và warnings trong transaction như thiết kế hiện tại; lỗi giữa chừng rollback toàn bộ. Run lỗi không sinh hoặc đóng cảnh báo KPI từ dữ liệu thiếu.

### 4.4 Hợp đồng lỗi và hiển thị

- Lưu code, stage, project/property, affected count, retryable; chỉ lưu thông báo đã lọc, không token/credential.
- Mã tối thiểu: MISSING_GSC_MAPPING, PROPERTY_ACCESS_DENIED, AUTH_EXPIRED, RATE_LIMITED, TRANSIENT, REQUEST_BUDGET_EXCEEDED, UNKNOWN.
- Giữ nguyên nguyên nhân gốc thay vì chỉ url_errors/“could not be measured”. Status endpoint trả errorsByProject và published.
- Tổng kết riêng success/partial/failed; không tính partial thành “refreshed”. Ví dụ sự cố này: “Không cập nhật được range nào. 238 URL thuộc 3 project thiếu Search Console property.”
- Progress là số URL đã xử lý, không phải số URL lấy dữ liệu thành công. Hiển thị riêng ok/no_data/not_eligible/error và thời điểm cập nhật thành công gần nhất.

## 5. P1 — độ tin cậy sau khi khôi phục

- Wide query hiện đã phân trang 25.000 rows và nhóm theo property; không cần quay lại thiết kế hai request tuần tự cho mọi URL như một phương án tối ưu mới.
- Tuy nhiên API không bảo đảm trả toàn bộ rows. URL vắng trong wide query phải được exact-query xác minh trước khi kết luận no_data; exact cũng chỉ xác nhận kết quả API theo cùng bộ lọc, không chứng minh toàn bộ traffic thực tế bằng 0. Có budget và trạng thái incomplete khi không thể xác minh hết.
- Phân loại lỗi dùng cả HTTP status và Google reason; không gom mọi 403 vào thiếu quyền nếu reason là quota. Retry bounded với jitter/Retry-After cho lỗi tạm thời; không retry missing mapping/quyền sai.
- Luồng hiện do browser gọi /process liên tiếp; đóng tab có thể ngừng yêu cầu item tiếp theo. Muốn chạy bền khi đóng tab cần worker/queue riêng, identity backend và cơ chế token backend; đây là hạng mục riêng, không phải nguyên nhân của 238 lỗi đã thấy.

## 6. Kế hoạch triển khai và nghiệm thu

1. P0: preflight + mapping transaction/validation; publish guard + freshness metadata; lỗi có cấu trúc và summary đúng. Nếu thêm cột dùng migration tiếp sau 015; không sửa migration đã áp dụng. Đọc guide Next.js trong node_modules/next/dist/docs trước khi viết code theo AGENTS.md.
2. Test service/repository trên DB test: thiếu cả ba mapping; thiếu một mapping; mapping hợp lệ; quyền bị thu hồi; 401; 429/503; tất cả no_data; một phần lỗi; toàn lỗi; không có URL đủ điều kiện; rollback publish; retry trùng; mapping/sync đồng thời.
3. Các invariant bắt buộc: lỗi không đổi cache hợp lệ hoặc last_success_at; không đổi KPI/warning; counters không nhân đôi; partial không hiện refreshed; no_data chỉ đến từ query thành công; zero metrics thực sự vẫn là dữ liệu hợp lệ.
4. `npm run verify:refresh`, typecheck, lint phần thay đổi và build. Bổ sung integration tests cho start → process → stage → publish vì test hiện tại chưa bao phủ luồng này.
5. Môi trường thật: lưu mapping đã xác minh, kiểm tra 238 URL được map, chạy 1M → 3M → 6M; ghi run ID, dates, property, API calls, counters và published_run_id. Đối chiếu URL mẫu mỗi project và cache/KPI sau refresh. Xác minh trên đúng deployed target trước khi tuyên bố production fixed.
6. Rollback code phải giữ publish guard hoặc tắt refresh có kiểm soát; không quay lại publisher ghi error lên cache. Giữ run/stage để điều tra; migration thêm cột ưu tiên tương thích ngược.

## 7. Kiểm tra đã thực hiện và giới hạn

- READ ONLY: refresh_runs, refresh_run_items, seo_performance_cache, content_urls, project_gsc_properties, information_schema, schema_migrations.
- `npm run verify:refresh`, `npm run verify:refresh-db`, `npm run verify:refresh-preflight-db`, `npm run typecheck`, `npm run lint`, `npm run build`: PASS. Preflight DB test gọi service thật với mapping trống, xác minh không tạo refresh run và không gọi Google. Các test không chứng minh data GSC sau khi mapping được cấu hình.
- Đã áp dụng migration 016 và 017; chưa trigger refresh thật, chưa sửa mapping, chưa đăng nhập Google để lấy property/kiểm tra browser production. Chưa kiểm tra toàn bộ số liệu rollup/warning đã lưu nên không kết luận mức ảnh hưởng KPI lịch sử.
- Driver pg phát cảnh báo về thay đổi ý nghĩa SSL modes trong phiên bản lớn tương lai; kết nối đọc hiện tại thành công. Đây không phải nguyên nhân sự cố.

## 8. Tài liệu Google đối chiếu

- [Sites.list](https://developers.google.com/webmaster-tools/v1/sites/list): trả property người dùng có quyền truy cập cùng permission level.
- [Search Analytics query](https://developers.google.com/webmaster-tools/v1/searchanalytics/query): giới hạn rows, phân trang và không bảo đảm trả mọi data row.

Các giới hạn API trên được đối chiếu ngày 09/09/2026; không dùng để suy diễn lỗi Google trong ba run chưa gọi API.

## 9. Thực thi P0 ngày 09/09/2026

- `POST /api/refresh/start` preflight mapping từ `project_gsc_properties` trước khi tạo run. Thiếu mapping trả 422 `MISSING_GSC_MAPPING`, có project và số URL bị ảnh hưởng; không gọi GSC, không tạo item/stage/cache/KPI.
- Sau khi mapping đủ, start xác minh property hiện diện trong `sites.list` của chính tài khoản sẽ chạy refresh. Property không truy cập được trả 422 `PROPERTY_ACCESS_DENIED`; OAuth hết hạn trả 401 `AUTH_EXPIRED`.
- Saving mapping chỉ chấp nhận project active, property có thật trong GSC list và property bao phủ toàn bộ active URL của project. Upsert/delete mapping và cập nhật `content_urls` hiện cùng transaction. Sheet sync resolve mapping tại lúc ghi nên không thể ghi lại property stale/null từ snapshot cũ.
- `refresh_runs.published` và `published_at` được thêm bằng `016_refresh_publish_guard.sql`; `seo_performance_cache.published_refresh_run_id` được thêm bằng `017_refresh_publication_lineage.sql`. `refresh_runs.started_at`/`finished_at` là thời điểm attempt, còn cache `refreshed_at` là last success. New run chỉ đặt published sau khi stage, cache, rollup, scoring và warning cùng transaction thành công. Có lỗi URL thì run `partial`/`failed`, không publish cache/KPI/warning.
- UI chỉ tính status `success` có `published=true` là range refreshed. Ví dụ cũ được thay bằng “No ranges were refreshed — …” khi mọi range dừng lỗi.
- Regression checks đã pass: `npm run verify:refresh`, `npm run verify:refresh-db`, `npm run verify:refresh-preflight-db`, `npm run typecheck`, `npm run lint`, `npm run build`; migration 016 và 017 được áp dụng. Build production được chạy sau thay đổi; trạng thái deployment không được suy ra từ local build.
