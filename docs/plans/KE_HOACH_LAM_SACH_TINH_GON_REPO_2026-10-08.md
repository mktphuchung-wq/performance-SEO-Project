# Kế hoạch thực thi: làm sạch, sắp xếp và tinh gọn repo an toàn

Ngày khảo sát: **2026-10-08**. Repo: **Performance SEO Project**.

## 1. Mục tiêu và phạm vi

Làm repo dễ tìm, dễ bảo trì và dễ kiểm tra hơn, đồng thời giữ nguyên hành vi app, URL, phân quyền, số KPI, hợp đồng API và dữ liệu đang có. Ví dụ: chuyển đặc tả KPI vào `docs/specs/` giúp tìm tài liệu nhanh hơn; việc chuyển này không được làm mất đường dẫn tham chiếu từ README hoặc script.

**Trạng thái tại thời điểm lập kế hoạch (2026-10-08): PLAN ONLY.** Khi đó lượt làm việc chỉ khảo sát; chưa xóa/di chuyển file cũ, sửa mã nguồn, đổi dependency, chạy migration hay triển khai.

**Cập nhật sau thực thi (2026-10-08): PARTIAL.** Đã chuyển phần lớn tài liệu, thêm chỉ mục và quy tắc ignore/exclude cho artifact local, sửa metadata hai worktree cũ và bảo toàn thêm một worktree `.kilo/` phát hiện khi chạy lint. Hai tài liệu vốn ở `docs/` vẫn được giữ nguyên tại chỗ vì ACL hiện tại từ chối quyền đổi tên; chi tiết trong [biên bản thực thi](../operations/repo-cleanup-2026-10-08.md). Typecheck và verifier offline đạt; lint còn lỗi trong mã app hiện hữu. Build, kiểm tra DB, auth/trình duyệt và clone sạch chưa được xác minh vì đích `.env.local`/môi trường hosting chưa được xác nhận.

Phạm vi kế hoạch:

- P0: chốt baseline, kiểm kê, bảo vệ dữ liệu và worktree.
- P1: gom tài liệu, xử lý artifact, làm rõ Git ignore và quy trình kiểm tra.
- P2: xác minh rồi loại bỏ tài nguyên/dependency không dùng; sắp xếp component theo nhóm khi có lợi ích cụ thể.
- P3: tách file lớn hoặc hợp nhất logic chỉ khi có bằng chứng và kiểm thử đủ mạnh.

Không gộp vào đợt này: đổi công thức KPI, sửa nghiệp vụ, nâng Next/React, thay thư viện, đổi mô hình DB, squash/đổi tên migration, đổi route hoặc tái thiết kế UI. Nếu baseline phát hiện lỗi cũ, xử lý bằng thay đổi riêng trước khi tiếp tục phần cleanup phụ thuộc vào lỗi đó.

## 2. Căn cứ hiện tại và giới hạn bằng chứng

Khảo sát từ checkout đang mở, không coi thông tin checkout cũ là trạng thái hiện tại.

| Quan sát đã xác minh | Ý nghĩa với kế hoạch |
|---|---|
| HEAD lúc khảo sát ban đầu: `3fb002e9ee6a81618bc6d821db9dd92adc25e534`, branch `master`; status tại thời điểm khảo sát trống | Có mốc đối chiếu; khi bắt đầu thực thi, status thực tế có đúng một file untracked là kế hoạch này; xem biên bản thực thi |
| `package.json` và Next đã cài đều là `16.3.0`; React `19.2.8` | Dùng tài liệu Next đi kèm phiên bản; không refactor bằng giả định phiên bản cũ |
| Node máy khảo sát `v24.16.0`, npm `12.0.0` | Chỉ là runtime local; chưa xác minh runtime CI/hosting |
| Có `app/`, `components/`, `lib/`, `types/`, `scripts/`, `migrations/`, `public/` | Cấu trúc cơ bản đã rõ; không cần chuyển toàn repo sang `src/` để làm gọn |
| `tsconfig.json`: alias `@/* -> ./*`; include TS/TSX rộng; có types trong `.next` | Move mã nguồn phải kiểm tra alias và phạm vi typecheck, không chỉ import của app |
| `scripts/alias-hooks.mjs` resolve `@/` từ gốc repo và resolve import tương đối | Đổi alias hoặc vị trí loader có thể làm hỏng verifier dù app vẫn build |
| `scripts/migrate.mjs` tìm `../migrations`, load env từ gốc và lưu tên SQL vào `schema_migrations` | Giữ nguyên vị trí, tên, thứ tự và nội dung migration cũ |
| Migration hiện có từ `001_init.sql` đến `019_member_report_url_error_message.sql` | Không coi migration đã chạy là file thừa |
| Nhiều script đọc nguồn bằng đường dẫn hoặc import trực tiếp TS | Tìm kiếm import tĩnh đơn thuần không đủ chứng minh file không dùng |
| `verify-composite-score.mjs`, `verify-sync-v2.mjs`, `verify-content-review.mjs`, `verify-member-report.mjs` có trong repo nhưng không có script npm cùng tên | Cần bảng lệnh kiểm tra rõ ràng; không xóa vì thiếu mục trong `package.json` |
| `verify:review-autosync`, `verify:warning-evaluation` không có hậu tố `-db` nhưng có dùng DB | Phân loại kiểm tra bằng nội dung, không dựa vào tên |
| `verify-warning-evaluation.mjs` cảnh báo ghi append-only; `verify-member-report.mjs` có nhánh fixture DB và lệnh xóa fixture | Không chạy tổng hợp mọi verifier trên DB thật |
| `report-kpi-shift.mjs` import `computeAndStoreScores` | Báo cáo này cần kiểm tra tác dụng ghi; không mặc định read-only |
| CSV `seo-member-report-huong-duong-2026-08.csv` được Git theo dõi | Xác minh có phải fixture hay báo cáo thật; xử lý riêng khỏi tài liệu nghiệp vụ |
| `public/` có `file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`; tìm trong app/components/lib/scripts/README chưa thấy tham chiếu tên này | Chỉ là ứng viên loại bỏ; chưa kết luận không có người dùng hoặc URL ngoài repo tham chiếu |
| `.claude/launch.json` được Git theo dõi và chứa lệnh chạy dev | Giữ cấu hình dùng chung; không ignore toàn bộ `.claude/` |
| Có hai thư mục dưới `.claude/worktrees/`; `git worktree list --porcelain` vẫn trỏ đường dẫn trước khi repo đổi vị trí và đánh dấu `prunable` | Metadata và thư mục vật lý lệch nhau; `prunable` không chứng minh công việc bên trong đã bỏ được |
| `.claude/worktrees/` đang ignore bằng `.git/info/exclude`; `.next/`, `*.tsbuildinfo`, env đã có trong `.gitignore` | Ignore local không đi cùng clone; cần đưa rule cần chia sẻ vào đúng cấu hình |
| `output/` có thư mục `playwright/`; có `.playwright-cli/` | Cần kiểm kê nội dung và mục đích trước khi xử lý; chưa đo kích thước đầy đủ |

File lớn theo dung lượng nguồn là ứng viên xem xét, không phải lỗi thiết kế đã xác nhận: `app/admin/content-review/page.tsx` khoảng 33 KB, `lib/performance/refresh.ts` khoảng 26 KB, `lib/repositories/content-review.ts` khoảng 25 KB, `app/admin/settings/page.tsx` khoảng 25 KB, `lib/reports/member-report.ts` khoảng 24 KB. Không dùng riêng kích thước làm lý do tách file.

## 3. Quyết định tổ chức repo

### Recommended — khuyên dùng

Giữ `app/`, `lib/`, `scripts/`, `migrations/`, `types/` và config ở vị trí hiện tại. Dọn tài liệu và artifact trước; sau đó mới nhóm component nếu đã có bản đồ người dùng của từng component. Mỗi đợt chỉ đổi một loại: tài liệu, ignore, asset, dependency, move code hoặc refactor logic.

Được: giảm diện tích thay đổi và dễ tìm nguyên nhân khi có hồi quy. Đánh đổi: chưa tạo được một cấu trúc thư mục đồng nhất hoàn toàn trong một lần.

### Alternative — thay thế

Chuyển mã nguồn sang `src/` trong dự án riêng nếu sau P1/P2 vẫn có vấn đề thực tế về ranh giới code/config hoặc onboarding. Next hỗ trợ `src/`, nhưng cần đổi đồng bộ alias, loader, verifier, proxy và các đường dẫn tương đối; đọc guide local về `src`/`proxy` trước khi làm. Được: phân tách rõ hơn. Đánh đổi: diff lớn, rủi ro tooling và thêm một vòng hồi quy đầy đủ.

### Avoid — cần tránh

- Xóa theo tuổi file, tên “old”, không có import, hoặc kết quả một công cụ phát hiện unused.
- Chạy `git clean -fdx`, xóa `.claude/` hàng loạt hoặc prune worktree trước khi xác minh công việc bên trong.
- Gom tất cả verifier vào một lệnh tự động có thể dùng `.env.local` production.
- Xóa lockfile, chạy `npm audit fix --force`, upgrade dependency cùng commit dọn thư mục.
- Xóa/đổi tên SQL cũ, chạy lệnh dọn cache DB trong README như một bước cleanup repo.
- Tắt `strict`, bỏ qua lỗi build, nới quyền auth hoặc đổi `null` thành `0` để kiểm tra xanh.
- Thêm ignore rộng để che lỗi hoặc giấu tài liệu/fixture cần quản lý.

## 4. Cấu trúc đích đề xuất

```text
repo/
  app/                     # Giữ cây URL và file quy ước Next
  components/              # Nhóm lại từng đợt nếu đã chứng minh cần thiết
  lib/                     # Giữ phân lớp nghiệp vụ/repositories hiện tại
  types/
  scripts/                 # Giữ vị trí hiện tại, bổ sung tài liệu phân loại lệnh
  migrations/              # Bảo toàn 001–019 và migration mới theo quy trình riêng
  public/                  # Chỉ loại asset đã xác minh không dùng
  docs/
    README.md              # Mục lục, trạng thái và nguồn chuẩn của từng tài liệu
    specs/                 # Quy tắc nghiệp vụ và đặc tả còn hiệu lực
    plans/                 # Kế hoạch chưa thực thi/đang thực thi
    operations/            # Cách kiểm tra, vận hành và hoàn tác
    reviews/               # Báo cáo đánh giá, tài liệu Word
    archive/               # Lịch sử; ghi rõ tài liệu nào thay thế
  .claude/launch.json       # Giữ cấu hình dùng chung
  README.md                # Lối vào setup + liên kết tới docs
  AGENTS.md, CLAUDE.md      # Giữ ở gốc để công cụ tìm được
  proxy.ts                 # Giữ ranh giới auth đang có
  package.json, package-lock.json, tsconfig.json, next.config.ts, ...
```

`output/`, `.playwright-cli/` và `.claude/worktrees/` là khu vực local dự kiến ignore sau kiểm kê. Fixture có ích phải có chỗ được track riêng, dữ liệu đã ẩn danh và tài liệu mô tả. Không chuyển báo cáo thật vào `public/` vì đó là bề mặt phục vụ web.

## 5. Giai đoạn 0 — baseline và kiểm kê (P0)

**Đầu vào:** checkout mới nhất; người thực thi biết môi trường nào dùng dữ liệu thật; tài khoản Admin và Member test; DB dev/staging riêng nếu cần kiểm tra ghi.

**Các bước:**

1. Đọc lại `AGENTS.md` và guide trong `node_modules/next/dist/docs/` tương ứng với thay đổi dự kiến. Đã khảo sát guide `01-app/01-getting-started/02-project-structure.md`; không thay thế việc đọc guide chi tiết lúc thực thi.
2. Ghi branch, HEAD, trạng thái tracked/untracked, Node/npm, lockfile và runtime hosting. Không đưa token hoặc nội dung `.env.local` vào log.
3. Tạo branch `chore/repo-cleanup` từ trạng thái đã chốt. Nếu có thay đổi của người khác, ghi nhận và giữ nguyên; không tự reset/stash chúng.
4. Lập manifest route từ các file `app/**/page.tsx` và `app/**/route.ts`, gồm method API, quyền yêu cầu và shape trả về của endpoint quan trọng.
5. Lập manifest cleanup: đường dẫn, Git tracked/ignored/untracked, vai trò, người dùng, tham chiếu, hành động, rủi ro, kiểm tra, cách phục hồi. Mặc định `KEEP` nếu thiếu bằng chứng.
6. Với artifact, đo riêng các thư mục đã chọn; không quét đệ quy cả `.claude/`/`node_modules/` để liệt kê mọi file. Ghi số lượng và dung lượng tổng, không in dữ liệu cá nhân.
7. Kiểm tra worktree: branch/commit, trạng thái file mới/sửa, stash/commit chưa nhập và metadata `.git` của từng thư mục. Chỉ sửa metadata sau khi xác minh đường dẫn hiện tại và bản sao công việc; có thể dùng `git worktree repair` với đường dẫn đã kiểm tra theo tài liệu Git.
8. Chạy baseline tĩnh và verifier không DB; đọc nội dung script trước khi đưa vào nhóm này. Ghi PASS/FAIL/SKIPPED và log riêng cho từng lệnh.
9. Trên dev/staging, chụp baseline hành vi bằng cùng snapshot dữ liệu, ngày tham chiếu, ranges và setting KPI. Cửa sổ rolling phụ thuộc thời gian; không so hai lần chạy khác ngày mà không cố định ngữ cảnh.

Lệnh quan sát khởi đầu, PowerShell tại gốc repo:

```powershell
git status --short
git rev-parse HEAD
git worktree list --porcelain
git ls-files
git check-ignore -v .claude/worktrees .next tsconfig.tsbuildinfo
node --version
npm --version
```

Lệnh kiểm tra tĩnh chạy **tuần tự** từ cùng checkout, kiểm tra exit code từng lệnh:

```powershell
npm run lint
npm run typecheck
npm run verify:refresh
npm run verify:work-events
npm run verify:anomaly-baseline
npm run verify:kpi
npm run verify:table-view
node scripts/verify-composite-score.mjs
node scripts/verify-sync-v2.mjs
npm run build
```

Không chạy dev/build cùng lúc trên cùng `.next`. Build có thể cần env hoặc truy cập dịch vụ tùy code: kiểm tra trước và dùng cấu hình dev/staging. Thiếu credentials ghi `BLOCKED`, thiếu DB mà script trả exit 0 ghi `SKIPPED`; cả hai đều không phải PASS.

**Gate G0:** có baseline và manifest; lỗi cũ đã được phân biệt với lỗi mới. Nếu baseline quan trọng đang FAIL, dừng move/refactor liên quan. Có thể tiếp tục nhóm tài liệu độc lập và ghi giới hạn xác minh.

## 6. Giai đoạn 1 — gom tài liệu (P1, rủi ro thấp)

Giữ tên file ở lần chuyển đầu để giảm thay đổi tham chiếu. Đích trong bảng là đề xuất, không khẳng định tài liệu cũ đã hết hiệu lực.

| Đường dẫn hiện tại | Đích đề xuất | Điều kiện |
|---|---|---|
| `PERFORMANCE_SCORE_SPEC_v2.md` | `docs/specs/PERFORMANCE_SCORE_SPEC_v2.md` | Giữ đầy đủ công thức và phiên bản |
| `DAC_TA_KPI_THANH_VIEN_CHI_SO_TRAI_DAU.md` | `docs/specs/DAC_TA_KPI_THANH_VIEN_CHI_SO_TRAI_DAU.md` | Cập nhật tham chiếu trong verifier/comments |
| `BOI_CANH_WARNING_AUDIT_ACCOUNTABLE_KPI.md` | `docs/specs/BOI_CANH_WARNING_AUDIT_ACCOUNTABLE_KPI.md` | Bảo toàn bối cảnh và ranh giới quyền |
| `Monthly member performance report UI and CSV export.md` | `docs/specs/Monthly member performance report UI and CSV export.md` | Kiểm tra mức phù hợp với tính năng report hiện tại |
| `DAC_TA_FIX_API_EMPTY_RESPONSE_2026-09-09.md` | `docs/specs/DAC_TA_FIX_API_EMPTY_RESPONSE_2026-09-09.md` | Giữ hợp đồng lỗi/API; chỉ archive khi có nguồn thay thế rõ |
| `KE_HOACH_FIX_ISSUE_VA_TOI_UU_BAO_MAT_2026-09-12.md` | `docs/plans/KE_HOACH_FIX_ISSUE_VA_TOI_UU_BAO_MAT_2026-09-12.md` | Ghi trạng thái thực thi theo bằng chứng |
| `NPM_AUDIT_REMEDIATION_2026-09-12.md` | `docs/plans/NPM_AUDIT_REMEDIATION_2026-09-12.md` | Không coi audit cũ là kết quả hiện tại |
| `docs/REFRESH_GSC_DIAGNOSIS_AND_FIX_SPEC_2026-09-09.md` | `docs/specs/REFRESH_GSC_DIAGNOSIS_AND_FIX_SPEC_2026-09-09.md` | Giữ chứng cứ và hợp đồng publication |
| `docs/REVIEW_LOGIC_TINH_KPI_PERFORMANCE_SEO_2026-09-03.docx` | `docs/reviews/REVIEW_LOGIC_TINH_KPI_PERFORMANCE_SEO_2026-09-03.docx` | Giữ nhị phân, không viết lại nội dung |
| Kế hoạch Markdown này | `docs/plans/KE_HOACH_LAM_SACH_TINH_GON_REPO_2026-10-08.md` | Chuyển trong đợt tổ chức tài liệu, sửa link bàn giao |

**Các bước:** tạo thư mục; dùng `git mv` từng file với đường dẫn được quote; tạo `docs/README.md`; cập nhật README gốc, link tương đối giữa các tài liệu và tham chiếu trong code/script/agent instruction. Không gộp/xóa nội dung đặc tả chỉ vì có đoạn giống nhau. Nếu hai tài liệu mâu thuẫn, ghi conflict và nguồn có thẩm quyền; chưa tự chọn một bên.

Kiểm tra: tìm toàn repo theo từng tên file; phân biệt tên file còn hợp lệ và đường dẫn cũ đã sai; kiểm tra link tới đích mới và anchor. Với file move thuần túy, hash nội dung trước/sau phải giống nhau. Chạy `git diff --check`, xem `git diff --stat` và `git diff --summary`; diff chỉ gồm move/index/link/comment được giải thích.

**Gate G1:** tài liệu dễ tìm, không mất nội dung, không có link local hỏng, không có thay đổi hành vi. Commit gợi ý: `docs: organize project specifications and plans`.

## 7. Giai đoạn 2 — artifact, ignore và worktree (P1)

| Nhóm | Hành động đề xuất | Bằng chứng phải có |
|---|---|---|
| `.next/`, `node_modules/`, `tsconfig.tsbuildinfo` | Giữ ignore hiện có; không xóa chỉ để repo trông sạch | Là dữ liệu có thể sinh lại; nếu cần reclaim disk thì dừng process trước |
| `output/playwright/`, `.playwright-cli/` | Lưu evidence cần giữ ra nơi riêng; thêm rule đúng phạm vi nếu chỉ là output local | Không có fixture/config dùng chung bên trong |
| `.claude/worktrees/` | Chia sẻ rule ignore; sửa metadata trước; worktree đã hoàn tất mới được remove | Có inventory, bản sao file chưa commit và xác nhận branch/commit đã giữ |
| `.claude/launch.json` | Giữ tracked | Đây là config dev đã xác minh |
| CSV báo cáo ở gốc | Nếu fixture: ẩn danh và đặt vào `tests/fixtures/reports/` theo quyết định riêng; nếu báo cáo thật: đưa bản sao ra kho lưu riêng rồi ngừng track | Xác minh người sở hữu, mục đích và consumer trước |
| `.env.local` | Giữ local, giữ ignore, không chuyển vào docs/fixture | Không có secret trong diff hoặc evidence |

Đề xuất bổ sung `.gitignore` sau khi xác minh:

```gitignore
/.claude/worktrees/
/.playwright-cli/
/output/
```

Không thêm `*.csv` toàn repo vì sẽ che fixture hữu ích. `.gitignore` không bỏ tracking file đã commit; với CSV thật, sau khi kiểm tra bản sao và consumer mới dùng `git rm --cached -- "seo-member-report-huong-duong-2026-08.csv"`, kèm rule cụ thể. Việc này không xóa dữ liệu khỏi lịch sử Git; nếu phát hiện lộ dữ liệu cần xử lý bằng quy trình riêng.

Phạm vi ESLint/TypeScript: kiểm tra xem worktree/output local có nằm trong input lint/typecheck không. Nếu có, thêm ignore/exclude cụ thể cho dữ liệu không thuộc app; không che `app/`, `components/`, `lib/`, `types/` hoặc kiểm tra nghiệp vụ. Không khẳng định nguyên nhân lỗi khi chưa quan sát baseline.

Khi phải remove worktree: ưu tiên lệnh quản lý Git, không `--force`, không xóa thư mục thủ công hàng loạt. Trước mọi thao tác xóa/move đệ quy trên Windows, resolve đường dẫn tuyệt đối và xác nhận nó thuộc đúng workspace/đích được chỉ định; dùng một shell PowerShell xuyên suốt với `-LiteralPath`. Không xóa `.git`.

**Gate G2:** clone mới có ignore đúng; cấu hình dùng chung vẫn tracked; không mất worktree/file chưa commit. Báo cáo reclaim disk và giảm file tracked tách riêng, vì ignore không tự giảm dung lượng disk. Commit gợi ý: `chore: define generated artifact boundaries`.

## 8. Giai đoạn 3 — tài nguyên và dependency không dùng (P2)

### 8.1 Asset

Ứng viên ban đầu là năm SVG đã nêu. Với từng asset: tìm import, đường dẫn string, CSS `url(...)`, metadata/icon, link tài liệu, URL được tạo động và consumer bên ngoài. Kiểm tra các trang thực tế trước/sau. Không thấy tham chiếu trong mã chỉ cho trạng thái `CANDIDATE`, chưa đủ `DELETE`.

Chỉ xóa nhóm được chứng minh bỏ được trong commit riêng. Gate: build, màn hình liên quan, favicon/metadata và tải asset còn dùng hoạt động; không có 404 mới. Bảo toàn `app/favicon.ico` trừ khi có nhiệm vụ thay branding riêng.

### 8.2 Dependency

Lập bảng từng dependency: consumer runtime/script, kiểu import, peer dependency và mục đích. Đã thấy `xlsx-populate` được dùng trong xuất XLSX và verifier report; phải giữ. Google APIs, `pg`, auth, chart, React/Next phải đánh giá cả runtime và tooling. `@next/env` đang được import bởi migration: đây là vấn đề xác minh dependency trực tiếp, không phải bằng chứng thư viện có thể xóa.

Dùng tìm kiếm mã và `npm ls --depth=0`/`npm explain <package>` để đối chiếu. Công cụ unused nếu dùng chỉ tạo danh sách ứng viên; không cài/thêm dependency vào app chỉ để chạy cleanup. Không xóa dựa vào tên hoặc thiếu consumer trong `app/`.

Nếu chứng minh package không dùng: bỏ từng package, cập nhật `package.json` và lockfile đồng bộ, kiểm tra diff lock tránh nâng ngoài scope; chạy lại gate đầy đủ và chức năng gắn với package. Xác minh clone sạch bằng `npm ci` trong checkout riêng, theo cùng chính sách lifecycle scripts của môi trường. Nếu bị chặn scripts, ghi rõ `--ignore-scripts` và kiểm tra tác động, không mặc định mọi package vẫn hoạt động.

**Gate G3:** cài từ lockfile tái lập được, không mất chức năng, không đổi version ngoài phạm vi. Không kỳ vọng giảm bundle chỉ từ số dependency; nếu có mục tiêu bundle thì đo build trước/sau bằng cùng cấu hình.

## 9. Giai đoạn 4 — sắp xếp component và script (P2)

Giữ script ở `scripts/` trong đợt đầu. Tạo `docs/operations/verification.md` với bảng: lệnh chính xác, runtime, có load env không, có DB/network không, có ghi/rollback không, điều kiện SKIP, phạm vi kiểm tra. Bổ sung alias npm cho verifier cần dùng nếu hợp lý, nhưng giữ lệnh cũ để không làm hỏng consumer/automation.

Nhóm component đề xuất để lập mapping, chưa phải phân loại cuối cùng:

| Đích | Ứng viên cần kiểm tra |
|---|---|
| `components/auth/` | `AuthProvider`, `SignInButton` |
| `components/layout/` | `NavHeader` |
| `components/tables/` | `TableView`, `PerformanceTable`, `RollupTable`, các bảng comparison |
| `components/kpi/` | `KpiScoreTable`, `MemberKpiSummary`, `TrendBadge`, `ScoreAdjustmentBadge` |
| `components/audit/` | `AuditDetailPanel`, `AuditEvidenceForm`, `AuditRolesPanel`, `BaselineHistoryPanel` |
| `components/content-review/` | `ContentKpiCard`, `ContentReviewSummary`, `ContentKpiSummaryTable` |
| `components/sync/` | `SyncRefreshPanel`, `RunHistoryPanel`, `DataQualityPanel` |

Giữ shared UI thật sự dùng chung ở nơi rõ ràng; không đổi `components/ui.tsx` thành một “design system” lớn trong đợt cleanup.

**Quy trình mỗi nhóm:**

1. Liệt kê tất cả consumer, import tĩnh/động và comment/path tham chiếu; lưu mapping cũ → mới.
2. Move nhỏ, cập nhật toàn bộ import; bảo toàn casing, export và directive `"use client"`/`"use server"`.
3. Không đổi tên props hoặc nội dung component trong commit move; không tạo barrel `index.ts` hàng loạt vì có thể làm mờ ranh giới client/server.
4. Chạy lint/typecheck/build và kiểm tra màn hình sử dụng nhóm vừa move. Kiểm tra trên môi trường Linux/CI nếu hosting dùng filesystem phân biệt hoa thường.
5. So route manifest, JSON API quan trọng và số KPI với baseline; đọc diff để xác nhận không kèm đổi nghiệp vụ.

**Gate G4:** không thiếu module, không mất ranh giới server/client, không import DB/secret vào client; chức năng liên quan giữ nguyên. Nếu lợi ích tổ chức không rõ, giữ nguyên component hiện tại. Commit riêng cho từng nhóm.

## 10. Giai đoạn 5 — tinh gọn code có chọn lọc (P3, tùy bằng chứng)

Chỉ mở giai đoạn này khi G0–G4 của phần đã chọn hoàn tất và có vấn đề cụ thể: nhiều trách nhiệm trộn trong một file, logic trùng thực sự hoặc module không còn consumer.

- `app/admin/content-review/page.tsx`: cân nhắc tách phần hiển thị/hook khi đã ghi lại paste-preview, chấm điểm, chọn tháng/member và trạng thái tải/lỗi. Giữ state lifecycle và request semantics.
- `app/admin/settings/page.tsx`: cân nhắc tách panel theo miền setting; giữ validation, lưu mapping, backfill và quyền Admin.
- `lib/performance/refresh.ts`: rủi ro cao; giữ nguyên nếu chưa có kiểm tra checkpoint, lease, retry, publication và lỗi partial. Tách orchestration không được đổi thứ tự transaction/GSC.
- `lib/repositories/content-review.ts`, `lib/reports/member-report.ts`: chỉ tách theo trách nhiệm khi đã có test DB/export và bản đồ transaction; không hợp nhất query có điều kiện khác nhau chỉ vì giống hình thức.

Một helper chỉ nên gom khi có nhiều consumer với **cùng ý nghĩa nghiệp vụ**; `null`, missing baseline, attribution và quyền không phải chi tiết có thể chuẩn hóa tùy ý. Mã bị cho là dead cần kiểm tra cả convention Next, script, dynamic lookup, handler đăng ký và đường dẫn bên ngoài.

Gate: test trước/sau chứng minh behavior parity, diff có thể review, không thay schema/công thức. Không đặt mục tiêu giảm số dòng bắt buộc. Nếu không đủ coverage, ghi `DEFERRED` và hoàn thành cleanup an toàn ở mức P1/P2.

## 11. Ma trận kiểm tra bảo vệ app

| Nhóm | Kiểm tra bắt buộc khi bị tác động | Điều kiện đạt |
|---|---|---|
| Tài liệu/ignore | Link, diff, tracked/untracked, clone mới và phạm vi tooling | Không mất tài liệu/config; input lint/typecheck đúng |
| Mã nguồn/config/dependency | Lint, typecheck, verifier liên quan, production build + start | Không lỗi mới; không dùng ignore để che regression |
| Auth/phân quyền | Signed-out, Member, Admin; `/api/auth/session`, `/dashboard`, `/admin`, `/api/me/*`, `/api/admin/*` | Session JSON đúng; API 401/403 đúng tình huống; Member không đọc dữ liệu người khác |
| Hợp đồng API | Success/error/empty/malformed/network; `lib/api/route-response.ts`, `lib/http/fetch-json.ts` | Body và status đúng; request ID/header đúng nơi hợp đồng hiện tại yêu cầu; không trả HTML cho API lỗi |
| Range và KPI | 1M/3M/6M/all_time/custom, thiếu baseline, thiếu range, opposite-sign, trọng số cá nhân, trend | `null` vẫn là thiếu dữ liệu; URL/Project không nhận rule chỉ dành Member; trend không đổi điểm |
| Sheets/sync | Fixture ngày/URL/type, work events, progress/status | Mapping, attribution và trạng thái không đổi; không gọi Sheet trực tiếp từ page |
| GSC refresh | Preflight, retry, resume/checkpoint, lease, stage/publish, partial/error | Không publish dở; lineage gồm `published_refresh_run_id`; không tăng GSC calls do cleanup |
| Warning/audit | Quyền theo vai trò, evidence, approve/reject/reopen, history | Trạng thái và lịch sử đúng; không xóa evidence hoặc đổi điều kiện nghiệp vụ |
| Content review | Paste preview, ungraded, min_post=0, checklist retired, tháng/member | Công thức và missing-value đúng; Member chỉ xem phần của mình |
| Reports | `/admin/reports/members`, API/export, snapshot, CSV/XLSX Unicode/quotes/date/null | File mở được; cột, giá trị, quyền và tên file đúng baseline |
| UI | Desktop/mobile của màn hình bị tác động; sort/filter/group/wrap và empty/error | Không layout vỡ, mất thao tác hoặc lỗi console mới |
| Migration | Hash/tên/thứ tự SQL cũ và inventory `schema_migrations` nếu cần | Cleanup không tạo migration pending hoặc làm SQL cũ chạy lại |

Kiểm tra DB/network chỉ trên dev/staging đúng đích. Đọc từng script để xác nhận rollback và client transaction thực sự, không tin tên/comment. `verify:warning-evaluation` có ghi append-only; `report:kpi-shift` có khả năng recompute; `verify-member-report.mjs` có fixture và cleanup DB; tách khỏi nhóm offline. `verify:refresh-preflight-db` còn phụ thuộc trạng thái mapping, nên phải ghi rõ fixture và tình huống kiểm tra.

Giữ verifier hiện có thay vì thay toàn bộ test stack. Chỉ bổ sung kiểm tra cho rủi ro chưa được phủ; không viết test chỉ đếm file hoặc lặp lại cấu trúc implementation.

## 12. Commit, rollback và điểm dừng

Thứ tự commit dự kiến: baseline/manifest → docs → artifact rules → asset đã xác minh → dependency từng package → component từng nhóm → refactor từng module nếu đủ điều kiện → biên bản đóng đợt. Không gộp upgrade bảo mật vào chuỗi cleanup.

Với mỗi commit ghi: vấn đề, file đổi, lợi ích, kiểm tra đã chạy, kiểm tra thiếu, rủi ro và cách hoàn tác. Nếu sửa tiếp sau lần kiểm tra, chạy lại gate bị ảnh hưởng; kết quả trước đó không đại diện cho HEAD mới.

Hoàn tác:

- Thay đổi đã commit: `git revert <commit>` theo thứ tự đảo phụ thuộc, rồi chạy lại kiểm tra liên quan.
- Thay đổi chưa commit: kiểm tra diff; phục hồi đúng file do đợt cleanup sửa từ mốc đã chốt. Không reset toàn repo hoặc làm mất thay đổi của người khác.
- File tracked bị bỏ: phục hồi từ commit gốc; artifact/worktree chưa commit phải phục hồi từ bản sao riêng. Git revert không cứu file local chưa từng được track.
- Build lỗi sau đổi cấu trúc: revert commit move/config, kiểm tra loader/alias/casing; chỉ xóa cache build đúng đường dẫn nếu có bằng chứng cache sai và process đã dừng.
- Cleanup không sửa DB nên không cần rollback schema/data. Nếu một test đã ghi vào DB thật ngoài dự kiến: dừng chuỗi, giữ evidence và xử lý sự cố theo backup/restore riêng; không chạy SQL xóa đoán mò.

**Dừng giai đoạn khi:** phát hiện consumer chưa rõ, mất file chưa commit, thay route/quyền/API, KPI lệch trên cùng fixture, migration cũ đổi, fixture dùng dữ liệu thật, hoặc gate không đủ bằng chứng. Không đánh dấu toàn đợt PASS khi một luồng bị tác động còn `NOT CHECKED`.

## 13. Bàn giao và tiêu chí hoàn thành

Ước lượng lập lịch, không phải cam kết: P0 khoảng nửa đến một ngày; P1 khoảng một ngày; P2 một đến hai ngày tùy số consumer; P3 lập estimate riêng sau đánh giá coverage. Người thực thi chịu trách nhiệm manifest/diff; người review có thể là cùng người ở lượt kiểm tra riêng; người vận hành cung cấp môi trường và tài khoản test khi cần.

Checklist đóng đợt:

- [x] Manifest ghi KEEP/MOVE/DELETE/DEFERRED cho từng ứng viên, kèm chứng cứ.
- [x] Root bớt tài liệu rời, README và `docs/README.md` dẫn tới nguồn chuẩn.
- [ ] Artifact local không lẫn code/fixture, ignore dùng chung hoạt động trên clone mới.
- [x] Worktree còn dùng được bảo toàn; metadata cũ xử lý theo inventory.
- [x] Không đổi route/API/auth/KPI/schema ngoài scope.
- [x] Dependency/asset chỉ bỏ khi đã chứng minh và kiểm tra; đợt này không bỏ ứng viên nào.
- [ ] Cài từ lockfile, static checks, build/start và luồng bị tác động có kết quả tại HEAD cuối.
- [x] Báo cáo có PASS/FAIL/SKIPPED/BLOCKED/NOT CHECKED/DEFERRED, không gộp thiếu kiểm tra thành PASS.
- [x] Có commit và phương án rollback; không để secret/dữ liệu báo cáo thật trong evidence mới.
- [x] Ghi số file tracked/root-docs trước/sau; dung lượng artifact trước/sau nếu đã dọn. Không báo “app nhanh hơn” khi chưa đo.

Mẫu nhật ký cho từng hạng mục:

```markdown
| ID | Path cũ → mới | Quyết định và bằng chứng | Rủi ro | Commit | Gate/kết quả | Rollback |
|---|---|---|---|---|---|---|
| C01 | ... | MOVE: ... | Low | ... | G1 PASS, runtime N/A | revert ... |
```

Mức hoàn thành hợp lệ có thể là **P1 hoàn tất, P2/P3 hoãn có lý do**. Chỉ tuyên bố không phát hiện hồi quy trong phạm vi đã kiểm tra, kèm môi trường và HEAD; không suy ra production PASS từ build local.

## 14. Đối chiếu tài liệu chuẩn

- Guide Next đi kèm bản cài: `node_modules/next/dist/docs/01-app/01-getting-started/02-project-structure.md` — cây route có quy ước, cách tổ chức hỗ trợ nhiều lựa chọn; `src/` là tùy chọn.
- [Next.js: src folder](https://nextjs.org/docs/app/api-reference/file-conventions/src-folder) — căn cứ để xem `src/` là phương án thay thế, không là yêu cầu cleanup.
- [npm ci](https://docs.npmjs.com/cli/commands/npm-ci/) — cài dựa trên lockfile, kiểm tra package/lock đồng bộ; dùng cho checkout sạch với chính sách scripts phù hợp.
- [Git: gitignore](https://git-scm.com/docs/gitignore) — ignore dành cho file chưa track; file đã track cần quyết định riêng.
- [Git: worktree](https://git-scm.com/docs/git-worktree) — tham chiếu khi repair/remove metadata và worktree sau di chuyển repo; người thực thi cần đọc mục tương ứng trước thao tác.

Các quyết định giữ cấu trúc hiện tại, chia commit và ưu tiên baseline là đề xuất kỹ thuật cho repo này dựa trên dependency/path đã khảo sát; không phải yêu cầu bắt buộc của Next.js.
