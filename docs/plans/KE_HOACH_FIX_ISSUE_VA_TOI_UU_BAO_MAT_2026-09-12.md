# Kế hoạch xử lý dependency issues và tăng cường bảo mật

Ngày lập: 2026-09-12  
Phạm vi: Performance SEO Project  
Tài liệu đầu vào: `docs/plans/NPM_AUDIT_REMEDIATION_2026-09-12.md`

## 1. Mục tiêu thực thi

Kế hoạch này xử lý các dependency vulnerability đã được xác minh, bổ sung lớp
bảo vệ cho authentication, authorization, API, OAuth token, HTTP response,
database và chuỗi cung ứng. Việc triển khai phải giữ nguyên giao diện hiện tại:
không thay đổi bố cục, nội dung hiển thị, màu sắc, typography, navigation,
responsive behavior, trạng thái loading/empty/error hay luồng thao tác đang dùng.

Kế hoạch được coi là hoàn tất khi đồng thời đạt các điều kiện:

- `npm audit --omit=dev` không còn `critical` hoặc `high`.
- Full `npm audit` không còn `critical` hoặc `high`; mọi `moderate` còn lại phải
  có lý do, phạm vi ảnh hưởng, biện pháp giảm thiểu và thời hạn xử lý được ghi lại.
- Mọi Route Handler nhạy cảm tự kiểm tra session và quyền; Proxy chỉ là lớp lọc
  sớm, không phải lớp authorization duy nhất.
- OAuth access token và refresh token không xuất hiện trong client session,
  JSON response, HTML, browser storage hoặc log.
- Tất cả UI route trọng yếu vượt qua visual regression, interaction regression,
  responsive và keyboard checks trên cùng dữ liệu baseline.
- Typecheck, lint, production build và các workflow verification liên quan đều đạt.

## 2. Hiện trạng đã xác minh

### Dependency audit

| Phạm vi audit | Moderate | High | Critical | Tổng package node |
| --- | ---: | ---: | ---: | ---: |
| Tất cả dependency | 3 | 20 | 2 | 25 |
| Production dependency (`--omit=dev`) | 3 | 3 | 2 | 8 |

Các package node trong production audit là `next`, `next-auth`, `sharp`,
`postcss`, `nanoid`, `googleapis`, `googleapis-common` và `qs`.

Trạng thái phiên bản tại thời điểm lập kế hoạch:

| Root package | Đang dùng | Phiên bản registry đã kiểm tra | Quyết định |
| --- | --- | --- | --- |
| `next` | `16.3.0` | `16.3.5` | P0: nâng theo patch, pin exact |
| `eslint-config-next` | `16.3.0` | `16.3.5` | P0: đồng bộ đúng phiên bản với `next` |
| `next-auth` | `4.24.15` | `4.24.15` | Giữ nguyên; peer range hỗ trợ Next `^16` |
| `googleapis` | `174.0.0` | `180.0.0` | P1: nâng riêng và kiểm tra luồng Google API |
| `@tailwindcss/postcss` | `4.3.3` resolved | `4.3.3` | Giữ root version; làm mới dependency con |
| `eslint` | `9.39.5` | `10.10.0` | Giữ major 9 trong đợt này |

Không đưa React 19.3, TypeScript 7, ESLint 10, Node types 22 hoặc các upgrade
không liên quan vào cùng thay đổi. Việc tách phạm vi này giảm rủi ro thay đổi
rendering, CSS compilation và lint behavior.

### Bề mặt bảo mật ứng dụng

- `next.config.ts` chưa khai báo security headers.
- Proxy đang bảo vệ `/dashboard`, `/admin`, `/api/me`, `/api/admin`, `/api/sync`
  và `/api/refresh`.
- Có 41 file Route Handler dưới `/api/admin`; 29 file hiện chưa tự gọi kiểm tra
  session/quyền trong handler và đang phụ thuộc vào Proxy.
- `lib/auth.ts` hiện đưa `accessToken` vào đối tượng session. Vì
  `SessionProvider` được mount ở root layout, token có thể được trả về client qua
  endpoint session của NextAuth.
- Các route sync/refresh có kiểm tra access token, nhưng cần kiểm tra `isAdmin`
  ngay tại handler và ràng buộc thao tác với actor/run hợp lệ.
- `.env*` đã được ignore, chỉ `.env.example` được track. Không thấy secret được
  hard-code trong source đã kiểm tra.
- Database đang dùng TLS với `rejectUnauthorized: false`; dữ liệu được mã hóa
  trên đường truyền nhưng certificate chưa được xác minh đầy đủ.
- Không thấy `dangerouslySetInnerHTML`, `eval` hoặc ghi cookie bằng client code
  trong phạm vi đã quét. React escaping hiện tại phải được giữ nguyên.
- CSV export đã escape dấu nháy/dòng mới và neutralize tiền tố công thức
  `=`, `+`, `-`, `@`; behavior này phải có regression coverage.

## 3. Phạm vi và nguyên tắc giữ nguyên UI

### Trong phạm vi

- `package.json`, `package-lock.json` và dependency tree.
- Authentication/authorization helpers, Proxy và toàn bộ protected Route Handler.
- Session DTO, OAuth token lifecycle và secret handling.
- Security headers, CSP, cache policy, CSRF/origin checks và rate limiting.
- Server-side input validation, safe error response, logging và database TLS.
- CI/security verification và UI non-regression gate.

### Phải giữ nguyên

- Các route, link, tên navigation và thứ tự navigation hiện tại.
- Token màu, font Roboto/Roboto Mono, light color scheme, spacing, radius,
  typography, table density và chart presentation hiện tại.
- `Card`, `Button`, `Badge`, `Field`, `Checkbox`, `EmptyState` cùng toàn bộ state
  mặc định/hover/focus/disabled đang có.
- Dữ liệu, công thức KPI, filter/range, sort/group/wrap, export CSV và luồng
  sync/refresh đang hoạt động.
- Nội dung và phân biệt rõ loading, empty, partial, error, unauthorized và
  permission denied. Empty data tiếp tục hiển thị empty state, không biến thành
  giá trị 0 hoặc lỗi JSON chung.
- Desktop và narrow viewport behavior hiện tại; không phát sinh page-level
  horizontal overflow mới.

### Ngoài phạm vi

- Redesign UI, thay design token, đổi component library hoặc đổi chart library.
- Nâng major React, ESLint, TypeScript hoặc auth library nếu audit không bắt buộc.
- Thay đổi schema/business rule KPI không phục vụ trực tiếp cho bảo mật.
- Deploy production. Deploy chỉ thực hiện sau khi toàn bộ gate dưới đây đạt và
  có quy trình release riêng.

## 4. Ma trận issue và hướng xử lý

| ID | Mức | Issue | Đặc tả xử lý | Gate chính |
| --- | --- | --- | --- | --- |
| DEP-01 | P0 | Next 16.3.0 nằm trong vulnerable range RCE | Nâng `next` và `eslint-config-next` cùng lên `16.3.5`, pin exact, đọc docs từ package mới trước mọi source adaptation | Audit production hết critical; build và UI regression đạt |
| DEP-02 | P0 | `sharp@0.35.3` có advisory libheif | Xác nhận Next mới resolve `sharp >=0.35.4`; không cài direct nếu không cần | `npm ls sharp` và audit không còn advisory |
| DEP-03 | P0 | `postcss` kéo `nanoid@3.3.17` | Làm mới lock để resolve `nanoid >=3.3.18` trong range tương thích; chỉ dùng `overrides` nếu root upgrade không giải quyết | CSS build đạt; screenshot không đổi |
| DEP-04 | P1 | `googleapis-common@8.0.3` kéo `qs@6.15.3` | Nâng `googleapis` riêng; đích đầu tiên `180.0.0`; xác nhận `qs >=6.16.0` | OAuth, Sheets, GSC list/query và refresh đạt |
| DEP-05 | P1 | ESLint chain kéo `js-yaml@4.3.1` | Giữ ESLint major 9; làm mới lock để resolve `js-yaml >=4.3.2`; override chỉ là fallback có ghi chú | Lint đạt và full audit hết high |
| SEC-01 | P0 | 29 admin route files phụ thuộc Proxy để authorization | Thêm authorization tại từng handler trước parse input/DB/external call | Direct API tests trả đúng 401/403/2xx |
| SEC-02 | P0 | OAuth access token có trong client session DTO | Tách public session DTO và server-only token retrieval | Session endpoint không chứa token |
| SEC-03 | P1 | Mutation routes chưa có shared same-origin guard | Kiểm tra Origin/Host cho POST/PUT/PATCH/DELETE và trusted deployment origins | Cross-site request bị 403; same-origin UI vẫn chạy |
| SEC-04 | P1 | Chưa có security headers/CSP | Thêm headers ít rủi ro trước; đưa CSP qua report-only rồi mới enforce | Header tests và zero unexpected CSP violations |
| SEC-05 | P1 | Expensive sync/refresh/report actions chưa có request rate limit dùng chung | Rate limit theo actor + action bằng shared store, giữ active-run DB guard | 429 chuẩn, không tạo duplicate job |
| SEC-06 | P1 | Validation/error/cache policy chưa đồng nhất | Shared validation limits, safe error contract, private/no-store cho dữ liệu nhạy cảm | Contract tests và không lộ chi tiết nội bộ |
| SEC-07 | P2 | DB TLS không verify certificate | Hỗ trợ CA/verified TLS trong production, có preflight trước cutover | Kết nối production-like đạt, không fallback insecure |
| SUP-01 | P1 | Audit chưa là release gate | Pin toolchain, npm ci, audit gates, SBOM và dependency review | CI chặn critical/high mới |

## 5. Đặc tả triển khai theo giai đoạn

### Giai đoạn 0 — baseline và cô lập thay đổi

1. Ghi lại `git status`, checksum `package.json`/`package-lock.json`, Node/npm
   version và kết quả hai audit: full và `--omit=dev`.
2. Vì working tree hiện có thay đổi của tính năng Member Reports, không sửa hoặc
   hoàn tác các file đó. Mọi chỗ giao nhau với auth/API phải được diff review riêng.
3. Chụp baseline cùng một account, quyền và dataset cho các surface:

   - Sign-in/root và Dashboard.
   - Dashboard URL detail.
   - Admin Overview, KPI, Content KPI, Members, Projects, URLs, Warnings,
     Reports và Settings.
   - Navigation ở admin/member; trạng thái loading, populated, empty và error có
     thể tái tạo an toàn.
   - Ít nhất một wide viewport và một narrow viewport đang được app hỗ trợ.

4. Baseline phải lưu cả screenshot và kết quả thao tác: navigation, range switch,
   table controls, form submit, CSV download, sync/refresh trigger, sign-out và
   focus bằng keyboard. Dùng cùng viewport, dữ liệu và trạng thái để so sánh sau.

**Exit gate:** baseline đủ để phát hiện thay đổi layout, copy, state, navigation,
table/chart và responsive behavior; chưa thay dependency.

### Giai đoạn 1 — remediation dependency P0

1. Dùng cache npm riêng của project/task để tránh lỗi `EPERM` ở user cache.
2. Nâng `next` và `eslint-config-next` cùng lên `16.3.5` dưới dạng exact version.
3. Cài lại từ lockfile sạch theo quy trình npm chuẩn; không chạy
   `npm audit fix --force` như một thao tác mù.
4. Xác minh dependency tree thực tế:

   - `next@16.3.5` và `eslint-config-next@16.3.5` chỉ có một resolved version.
   - `sharp >=0.35.4`.
   - `nanoid >=3.3.18` ở mọi nhánh production.
   - Không có peer-dependency override ngoài dự kiến.

5. Nếu `nanoid` vẫn thấp dù semver range cho phép, thử lock refresh/update đúng
   package. Chỉ thêm `overrides` exact sau khi `npm explain` chứng minh không thể
   giải quyết từ root; ghi owner và điều kiện gỡ override.
6. Đọc lại guide liên quan trong `node_modules/next/dist/docs/` của phiên bản vừa
   cài trước khi sửa compatibility code. Không dựa vào docs của 16.3.0 sau upgrade.

**Exit gate:** production audit hết critical; typecheck, lint, build và smoke test
đạt; UI comparison không có thay đổi có chủ ý.

### Giai đoạn 2 — remediation Google APIs và dev dependency

1. Nâng `googleapis` trong một thay đổi riêng; đích khảo sát đã xác minh là
   `180.0.0`, với `googleapis-common ^9.0.0`.
2. Xác minh compile/runtime API đang dùng: OAuth2 token client, Sheets read-only,
   Search Console `sites.list` và `searchanalytics.query`.
3. Chạy preflight mapping và refresh workflow trên dữ liệu kiểm thử/cục bộ. So
   sánh processed count, with-data/no-data/error và publish status trước/sau.
4. Làm mới ESLint dependency tree trong major 9 để lấy `js-yaml >=4.3.2`; không
   nâng ESLint 10 trong cùng đợt.
5. Xác minh `qs >=6.16.0`, `js-yaml >=4.3.2` và full audit không còn high/critical.

**Exit gate:** Google API workflows và downstream data/status không đổi ngoài
dependency version; full audit đạt ngưỡng mục tiêu.

### Giai đoạn 3 — authorization tại từng server entry point

Tạo shared server-only authorization module, ví dụ `lib/security/authorization.ts`.
Module phải cung cấp các behavior sau, tên hàm có thể thích ứng với codebase:

- `requireSignedIn()` trả identity tối thiểu hoặc ném lỗi chuẩn 401.
- `requireAdmin()` kiểm tra session và `isAdmin`, trả 401 khi chưa đăng nhập và
  403 khi đã đăng nhập nhưng không có quyền.
- `requireGoogleAccess()` lấy token bằng server-only path sau khi identity/quyền
  đã được xác minh.
- Error dùng contract `{ error, code, requestId }` và `x-request-id`; không trả
  stack, SQL, upstream payload hoặc token.

Áp dụng:

- Tất cả handler trong `app/api/admin/**`, bao gồm GET read endpoints và CSV export.
- `app/api/sync/**` và `app/api/refresh/**` phải yêu cầu admin trong handler.
- `app/api/me/**` phải lấy member identity từ session; không tin email/user id do
  query/body cung cấp.
- Với run/job endpoint, kiểm tra run tồn tại, actor có quyền và state transition
  hợp lệ trước khi process/finish.
- Proxy tiếp tục chặn sớm và giữ route matcher hiện có. Logic trong handler là
  authority cuối cùng.

Success response schema không đổi. 401/403 tiếp tục là JSON cho API; page redirect
tiếp tục về route hiện tại của app. Việc thêm check không được làm UI nhấp nháy,
mất session hoặc đổi navigation visibility.

**Exit gate:** không còn protected handler chỉ dựa vào Proxy. Anonymous,
authenticated non-admin và admin tests đạt cho GET lẫn mutation.

### Giai đoạn 4 — bảo vệ OAuth token và session

1. Public session chỉ chứa field UI cần: name/email/image nếu dùng, `isAdmin` và
   trạng thái lỗi đăng nhập an toàn. Không có access token, refresh token, expiry
   nội bộ hoặc provider response.
2. Lấy Google token bằng helper server-only từ JWT cookie đã được NextAuth bảo vệ,
   hoặc token vault phía server. Route gọi Google API không nhận token từ browser.
3. Giữ OAuth scopes tối thiểu hiện có: `openid`, `email`, `profile`, Sheets
   read-only và Search Console read-only. Bổ sung scope chỉ khi có use case được
   phê duyệt và kiểm thử.
4. Production phải có `NEXTAUTH_URL` HTTPS chính xác và secret entropy đủ mạnh.
   Xác minh cookie `HttpOnly`, `Secure` ở production và `SameSite` phù hợp với
   OAuth callback trước khi thay default.
5. Xây dựng quy trình rotate `NEXTAUTH_SECRET`/Google secret có maintenance window;
   chấp nhận việc session cũ bị invalid nếu rotate encryption/signing secret.

**Exit gate:** gọi `/api/auth/session` và kiểm tra browser storage/network chứng
minh không có OAuth token; sync/refresh vẫn hoạt động bằng server-side token.

### Giai đoạn 5 — CSRF, validation, rate limit và response privacy

1. Với POST/PUT/PATCH/DELETE dùng cookie session, xác minh `Origin` khớp canonical
   host hoặc trusted-origin allowlist. Thiếu/sai Origin trả 403 an toàn; OAuth
   callback của NextAuth giữ flow riêng của library.
2. Mỗi handler khai báo allowlist field, type, format, enum, length và range. Parse
   JSON lỗi trả 400; payload lớn trả 413; identifier không tồn tại trả 404; conflict
   trạng thái trả 409. Không echo toàn bộ payload vào response/log.
3. Giữ success schema để client hiện tại không cần đổi. Nếu chuẩn hóa error,
   vẫn giữ field `error` mà UI đang đọc, đồng thời thêm `code` và `requestId`.
4. Rate limit dùng shared store có thao tác atomic, theo `actor + action`; không
   dùng memory-only counter trong môi trường nhiều instance. Áp dụng trước cho:

   - Sync Sheet và Refresh start/process.
   - Monthly snapshot và member-report generation/export.
   - Recompute/evaluate và các mutation admin có chi phí cao.

5. Khi giới hạn, trả 429 với `Retry-After`, `{ error, code, requestId }`; không tạo
   job/DB write trước khi check. Active-run constraint hiện có tiếp tục là lớp
   chống duplicate nghiệp vụ.
6. Authenticated API và export chứa dữ liệu nội bộ dùng `Cache-Control:
   private, no-store`; thêm `Vary` phù hợp nếu response thay đổi theo cookie/quyền.
7. CSV formula neutralization, escaping và filename sanitization hiện có phải được
   giữ và test bằng input bắt đầu với `=`, `+`, `-`, `@`, quote và newline.

**Exit gate:** same-origin UI requests giữ nguyên; cross-site mutation, malformed
input, oversized payload và burst request nhận status/contract đúng.

### Giai đoạn 6 — security headers và CSP theo hai bước

Thêm trước các header không làm thay đổi rendering:

- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `Permissions-Policy` tắt camera, microphone và geolocation nếu app không dùng.
- `X-Frame-Options: DENY` trong giai đoạn tương thích; CSP `frame-ancestors` là
  policy chính sau khi enforce.
- `Strict-Transport-Security` chỉ trên production HTTPS. Chưa bật `preload` hoặc
  `includeSubDomains` nếu chưa kiểm kê toàn bộ subdomain.

CSP triển khai theo hai bước:

1. `Content-Security-Policy-Report-Only`: tạo nonce/request policy theo hướng dẫn
   của đúng Next version, ghi nhận violation trên toàn bộ UI/auth flow. Policy tối
   thiểu phải kiểm soát `default-src`, `script-src`, `style-src`, `img-src`,
   `font-src`, `connect-src`, `frame-ancestors`, `base-uri`, `form-action` và
   `object-src`. Allowlist dựa trên network evidence; không dùng wildcard chung.
2. Enforce CSP sau khi production-like test không còn violation ngoài dự kiến.
   Production không dùng `unsafe-eval`. Mọi `unsafe-inline` tạm thời phải có lý do
   và task loại bỏ. CSP có feature flag/chế độ report-only để rollback nhanh.

`next/font` hiện self-host font build output, nên không mặc định mở Google Fonts
domain. Nếu nonce khiến route chuyển sang dynamic rendering, đo TTFB/cache behavior
và xác nhận không làm giảm UX trước khi enforce.

**Exit gate:** assets, font, hydration, chart, navigation, OAuth, fetch, download
và form hoạt động; browser console không có CSP violation chưa xử lý.

### Giai đoạn 7 — database, secret và logging

1. Thay `rejectUnauthorized: false` bằng verified TLS trong production. Cấu hình
   CA qua secret/server environment khi provider yêu cầu; không commit certificate
   riêng tư. Có connectivity preflight trước deploy và không tự fallback insecure.
2. Tiếp tục dùng parameterized query cho mọi user-controlled value. Dynamic SQL
   identifier chỉ được lấy từ internal allowlist; không nối query từ request input.
3. Chỉ server-only modules được đọc `DATABASE_URL`, OAuth secret và auth secret.
   Thêm `server-only` boundary cho DAL/security modules có secret.
4. Log structured metadata: request ID, route, status, safe error code và duration.
   Redact token, cookie, authorization header, secret, full OAuth response, SQL
   parameters và dữ liệu cá nhân không cần thiết.
5. Error gửi về UI giữ thông điệp có thể hành động và request ID; diagnostic chi
   tiết chỉ ở server log.

**Exit gate:** verified TLS đạt trong production-like environment; secret scan và
response/log inspection không tìm thấy credential.

### Giai đoạn 8 — chuỗi cung ứng và release gate

1. Khai báo/pin Node và npm version được support; hiện môi trường là Node 24.16.0,
   npm 12.0.0 và Next yêu cầu Node `>=20.9.0`.
2. CI cài bằng `npm ci` từ lockfile version 3; fail khi lockfile không đồng bộ.
3. Gate bắt buộc:

   - `npm audit --omit=dev --audit-level=high`.
   - Full `npm audit --audit-level=high` sau khi DEP-05 hoàn tất.
   - Typecheck, lint, build và project verification scripts.
   - Tạo SBOM bằng công cụ npm phù hợp và lưu cùng release artifact.

4. Dependency bot chỉ tạo PR nhỏ, không tự merge major; Next và
   `eslint-config-next` luôn được nâng cùng nhau. Security patch được ưu tiên nhưng
   vẫn phải qua UI gate.
5. Không suppress advisory chỉ bằng ID. Mọi exception phải có evidence về reachability,
   compensating control, owner và expiry date.

## 6. Ma trận kiểm thử không ảnh hưởng UI

| Vai trò/trạng thái | Surface | Hành vi phải giữ |
| --- | --- | --- |
| Chưa đăng nhập | `/`, protected page, protected API | Sign-in hiển thị như cũ; page redirect đúng; API trả JSON 401 |
| Member | Dashboard, URL detail, `/api/me/**` | Thấy đúng dữ liệu của member; không thấy admin nav; range/table/state hoạt động |
| Member truy cập admin | Admin page/API | Page redirect như cũ; API 403; không render thoáng qua dữ liệu admin |
| Admin | Toàn bộ Admin pages | Navigation, cards, tables, charts, forms, reports, sync/refresh giữ nguyên |
| Session hết hạn | Fetch và mutation | UI nhận lỗi có thể retry/sign-in; không treo loading và không lộ token |
| Dữ liệu rỗng/partial/error | Dashboard/Admin | Đúng empty/partial/error state; không biến null thành 0 |
| Narrow viewport | Navigation, table, form, chart | Không có page overflow mới; control vẫn dùng được bằng touch/keyboard |

Visual comparison pass khi:

- Không có khác biệt có chủ ý về hierarchy, copy, font, màu, spacing, component
  size, alignment, wrapping, table column behavior hoặc chart geometry.
- Font tải thành công; không có flash kéo dài hoặc layout shift mới.
- Focus ring, tab order, accessible name, disabled/loading state và live feedback
  còn hoạt động. State không chỉ dựa vào màu.
- Khác biệt anti-aliasing do browser/OS chỉ được chấp nhận sau manual review và
  không được che layout shift hoặc missing asset.

## 7. Kiểm thử kỹ thuật và bằng chứng hoàn tất

### Dependency và static checks

```powershell
npm.cmd ls --all
npm.cmd audit --json
npm.cmd audit --omit=dev --json
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
git diff --check
```

### Workflow checks

- Chạy `verify:kpi`, `verify:refresh` và các script liên quan tới file bị ảnh hưởng.
- Chạy DB verification có rollback/isolated fixture trước khi dùng dữ liệu thật.
- Với Google APIs, ghi lại số URL processed, with-data/no-data/error, run status,
  publish status và so sánh baseline. Không dùng build pass để thay thế workflow proof.

### Security contract checks

- Gọi trực tiếp representative GET và mutation route với anonymous, member và admin.
- Kiểm tra 401/403/429/413 có JSON hợp lệ, safe message, code, request ID và header.
- Kiểm tra `/api/auth/session`, HTML, source map production, network payload và log
  không chứa access/refresh token hoặc secret.
- Kiểm tra response headers trên page, JSON, static asset và CSV.
- Chạy CSP ở report-only qua toàn bộ route matrix trước khi enforce.

### UI proof

- So sánh baseline/after screenshots với cùng viewport, account và dataset.
- Chạy lại navigation, filters/ranges, tables, charts, forms, export, sync/refresh,
  sign-out và keyboard flow.
- Production-like `next start` là bằng chứng local. Chỉ kiểm tra trực tiếp deployed
  target mới được ghi là production verification.

## 8. Rollout và rollback

Thứ tự release bắt buộc: DEP-01/02/03 → DEP-04/05 → SEC-01/02 → SEC-03/05/06 →
SEC-04 → SEC-07/SUP-01. Mỗi nhóm phải qua gate trước khi nhóm sau bắt đầu.

- Dependency remediation rollback bằng cặp `package.json` + `package-lock.json`
  của release trước; không rollback riêng lockfile.
- Authorization/session changes rollback theo cùng unit để tránh client/server
  session contract lệch nhau.
- CSP có thể chuyển về report-only bằng configuration; không gỡ các header độc lập
  đã được chứng minh an toàn.
- Rate limit có kill switch theo route trong trường hợp false positive; database
  active-run/idempotency guard vẫn giữ.
- DB TLS chỉ cutover sau preflight. Nếu fail, dừng release và sửa trust chain; không
  tự động hạ xuống `rejectUnauthorized: false` trong production.

## 9. Definition of Done cuối cùng

- [ ] Hai audit đạt ngưỡng và dependency tree/version được lưu làm evidence.
- [ ] Không còn critical/high advisory ở production hoặc dev tree.
- [ ] 100% protected Route Handler có authorization nội tại.
- [ ] OAuth token chỉ tồn tại ở server-side trusted boundary.
- [ ] CSRF/origin, rate limit, validation, cache policy và safe error contract đạt.
- [ ] Security headers đạt; CSP report-only sạch trước khi enforce.
- [ ] Database TLS verify certificate; secret/log scan đạt.
- [ ] Typecheck, lint, build và workflow verification đạt.
- [ ] Wide/narrow visual và interaction regression đạt cho member/admin.
- [ ] Diff không có thay đổi UI ngoài phạm vi; mọi khác biệt đều được giải thích và
  phê duyệt trước release.
- [ ] Báo cáo phân biệt rõ local, production-like và deployed verification.
