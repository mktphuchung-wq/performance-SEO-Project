# Đặc tả sửa lỗi API response rỗng — Dashboard và Admin

Ngày xác minh: 2026-09-09. Trạng thái: đặc tả, chưa sửa code hoặc dữ liệu.

## 1. Kết luận và bằng chứng

- `.next/dev/logs/next-development.log` ghi lỗi server `(ENOTFOUND) tenant/user postgres.[redacted] not found`, xuất hiện trước lỗi parse JSON Dashboard và quanh thời điểm lỗi Admin.
- Log Browser xác nhận `/api/admin/members?range=last_1_month` và `/api/admin/projects?range=last_1_month` nhận HTTP 500, contentType null, body rỗng. Lỗi số 2 và 4 là cùng loại lỗi ở các request; lỗi số 3 là catch của Promise.all, không phải nguyên nhân DB độc lập.
- `app/dashboard/page.tsx:126-145`: gọi json() trực tiếp, không kiểm tra HTTP status, Promise.all không có catch/finally. Reject từ performance hoặc urls tạo unhandled rejection, loading không được kết thúc. KPI lỗi bị đổi thành score null.
- `app/admin/page.tsx:29-105`: đã phát hiện response rỗng nhưng log ở helper rồi log lại ở effect. Helper chấp nhận payload thiếu rows thành []; effect xóa rows khi lỗi nhưng tổng hợp mảng rỗng có thể hiển thị số 0 như số liệu thật. Chưa có loading state cho chuyển range nên dữ liệu cũ vẫn có thể xuất hiện dưới nhãn range mới trong lúc chờ.
- API me/performance, me/urls, admin/members, admin/projects gọi repository mà không bắt exception thành JSON có cấu trúc.
- `lib/db.ts`: pool được lưu trong global.__pgPool và không tái tạo khi DATABASE_URL thay đổi. Đổi env trong một tiến trình dev còn sống có thể vẫn giữ pool nguồn cũ.
- Kiểm tra trực tiếp hiện tại: nạp cấu hình bằng @next/env, kết nối PostgreSQL với timeout 8 giây, transaction READ ONLY rồi ROLLBACK. Provider hiện tại là Neon pooled; kết nối thành công; schema_migrations có đủ 001–015; member_performance_rollup và project_performance_rollup đều có 0 dòng. Không xuất credential.
- DB trống phải trả JSON thành công với rows [] hoặc rollup null. Không có bằng chứng rằng cần chạy lại migration, reset DB, hoặc sửa migration 015 để giải quyết lỗi này.
- Không phát hiện listener trên các cổng 3000–3002 tại lúc kiểm tra. Chưa kiểm thử HTTP có đăng nhập trên tiến trình mới; chưa xác minh Vercel production. Log cũ không chứng minh lỗi vẫn tồn tại với Neon hiện tại.

Suy luận có bằng chứng mạnh: các lỗi được báo phát sinh khi tiến trình cũ còn truy cập cấu hình/pool Supabase không hợp lệ. Chưa phân biệt chắc chắn pool cũ, biến môi trường ghi đè, hay cấu hình sai tại thời điểm log. Không kết luận hết egress từ các bằng chứng này.

## 2. Kế hoạch thực hiện

### P0 — Xác nhận runtime đúng DB

1. Xác định đúng PID, thư mục làm việc và port của dev server; dừng đúng tiến trình nếu còn chạy. Không kill toàn bộ Node.
2. Xác nhận DATABASE_URL thực tế chỉ bằng provider/pooled và kết quả SELECT 1; không in URL, password hoặc token. Kiểm tra biến cấp process có ghi đè .env.local không.
3. Khởi động mới từ checkout này bằng npm.cmd run dev; dùng port thực tế được Next thông báo. Không cần xóa .next mặc định.
4. Đăng nhập thật; kiểm tra /api/auth/session và bốn endpoint liên quan bằng Network, ghi status, content-type, kích thước body và kết quả JSON đã che dữ liệu cá nhân.
5. Với Neon trống: admin trả {rows:[]}, me/performance trả {rollup:null}, me/urls trả {rows:[]}. Nếu vẫn 5xx, đối chiếu exception server cùng request trước khi đổi cấu hình hay code.
6. Không chạy migrate/reset/sync trong bước chẩn đoán. Việc nạp dữ liệu Sheet/GSC là tác vụ riêng sau khi API hoạt động.

### P1 — Hợp đồng lỗi API

Phạm vi chính: app/api/me/{urls,performance,kpi}/route.ts, app/api/admin/{members,projects}/route.ts. Rà các endpoint summary/content-review/warnings mà hai trang đang gọi để áp dụng cùng hợp đồng khi cần.

- Giữ nguyên payload thành công để không phá consumer khác.
- Response lỗi: `{ "error": "Thông báo an toàn", "code": "DB_UNAVAILABLE", "requestId": "..." }`. Giữ error là string để tương thích consumer hiện có.
- HTTP 400: range không hợp lệ; 401: chưa đăng nhập; 403: thiếu quyền; 503: lỗi kết nối/tạm thời đã nhận diện; 500: lỗi lập trình, schema hoặc lỗi chưa phân loại. Không chuyển mọi DB error thành 503.
- Bắt cả lỗi session và repository trong ranh giới handler. Không trả 200 với []/null khi truy vấn thất bại. Không trả 204 cho các endpoint có hợp đồng JSON này.
- Kiểm tra range bằng tập giá trị thực tế được endpoint hỗ trợ; type cast RangeKey không phải validation. Không thay đổi ý nghĩa custom/all_time ngoài phạm vi.
- Giữ quyền Admin hiện có trong proxy.ts. Đảm bảo request API chưa đăng nhập nhận JSON 401 thay vì redirect HTML; điều hướng trang vẫn dùng login redirect. Không mở quyền để phục vụ test.
- Log server một lần/request với requestId, route, status, error.name, mã lỗi DB và thời gian. Không trả stack, SQL, connection string hoặc thông tin tenant cho client.
- Exception ở proxy/framework hoặc nền tảng timeout vẫn có thể trả HTML/rỗng; frontend bắt buộc phòng vệ độc lập.

### P1 — Bộ đọc JSON dùng chung

Đề xuất lib/http/fetch-json.ts, chạy ở client và không import module server.

- Nhận URL, AbortSignal và validator payload của endpoint.
- Đọc body đúng một lần bằng text(); phân loại HTTP failure, empty body, non-JSON content type (chấp nhận application/json và +json), JSON lỗi, sai shape, network failure.
- HTTP lỗi luôn giữ status gốc kể cả khi body rỗng/HTML; không để SyntaxError che mất HTTP 500.
- Thành công thiếu trường bắt buộc (ví dụ rows) là INVALID_RESPONSE; không ngầm đổi {} thành dữ liệu rỗng.
- Throw lỗi có name/message/code/status/requestId; phân biệt abort do cleanup với timeout. Không log responsePreview, payload hoặc URL chứa thông tin nhạy cảm.
- Helper không console.error; nơi quản lý request quyết định log một lần. Serialize Error thành trường tường minh thay vì truyền Error nguyên khối khiến overlay hiện {}.
- Không retry tự động vô hạn; bản sửa đầu tiên dùng nút Thử lại. Nếu đặt timeout, chọn riêng cho read dashboard, không áp timeout đó cho Sync/Refresh dài hạn.

### P1 — State Dashboard và Admin

- Mỗi nhóm dữ liệu có trạng thái loading/success-empty/success-data/error. Request lỗi không được biến thành KPI null hoặc số 0 mà không có báo lỗi.
- Nhóm selected-range Dashboard: urls và performance cùng một snapshot; commit khi cả hai thành công. KPI có state lỗi riêng nếu giữ khả năng hiển thị hai phần còn lại khi KPI lỗi.
- Nhóm Admin: members và projects commit cùng nhau. Official KPI summary độc lập với range, có loading/error riêng và cập nhật theo dataVersion.
- Dùng AbortController cùng guard chỉ cho request hiện hành cập nhật state; cleanup abort khi đổi range, refresh hoặc unmount. finally của request cũ không được tắt loading request mới.
- Ngay khi đổi range, không hiển thị số liệu range cũ dưới nhãn mới; hiện placeholder cho nhóm đang tải. Loading phải kết thúc khi thành công hoặc lỗi hiện hành.
- Khi lỗi: hiển thị thông báo dễ hiểu và nút Thử lại, các chỉ số phụ thuộc dùng dấu —; không hiện 0 members/0 clicks như dữ liệu đã xác minh. Có thể giữ dữ liệu cũ chỉ khi ghi rõ range và trạng thái cũ, nhưng phương án mặc định là placeholder.
- Khi DB thật sự trống và HTTP 200 hợp lệ: hiện trạng thái chưa có dữ liệu, hướng dẫn Admin cấu hình/Sync Sheet/Refresh; không hiển thị lỗi. Không tự động trigger sync từ GET.
- Summary, content review và warnings phải có error state riêng; bỏ các catch âm thầm chuyển lỗi thành chưa có dữ liệu. Giữ nguyên phạm vi thời gian và công thức KPI.

## 3. Kiểm thử và tiêu chí nghiệm thu

1. DB kết nối đúng và trống: các endpoint trả 200 JSON đúng shape; hai trang hiển thị empty state, không JSON error.
2. DB lỗi kết nối giả lập: API trả 503 JSON có requestId; UI báo lỗi, hết loading, không số 0 giả.
3. Schema thiếu giả lập: API trả 500 JSON, log mã DB phù hợp; không tự migrate hoặc tạo bảng.
4. Response 500 rỗng, 502 HTML, 200 rỗng, JSON hỏng, {} hoặc rows sai kiểu: helper phân loại được; không unhandled rejection.
5. 401/403: giữ status và thông báo đúng; không đọc HTML login như JSON; quyền Admin không suy giảm.
6. Đổi range A sang B nhanh, A trả sau B: chỉ B được commit; abort không tạo thông báo lỗi; unmount không cập nhật state.
7. Một request trong nhóm lỗi: không trộn snapshot; official KPI độc lập không bị xóa theo range.
8. Retry sau phục hồi: dữ liệu hiển thị lại; không phải reload toàn trang; log không nhân đôi ở helper và effect.
9. Có dữ liệu thật: số liệu và công thức không đổi; no-data khác 0 và error.
10. Chạy unit test helper/state cần thiết, route tests với repository mock, npm.cmd run typecheck và npm.cmd run lint. Kiểm thử browser có đăng nhập trên dev mới. Không dùng tài khoản giả/bypass auth trên production.
11. Nếu triển khai sau này: xác minh lại domain production và Vercel Logs; kết quả local không thay thế kiểm thử deployment.

## 4. Ngoài phạm vi

Không thay đổi schema hoặc migration 015, không xóa Supabase/Integration, không chỉnh secret, không nạp dữ liệu, không đổi công thức KPI, không triển khai production trong lượt đặc tả này. Tối ưu pool/timeout cho toàn bộ workload cần đánh giá riêng; không áp timeout chung làm hỏng tác vụ Sync dài.
