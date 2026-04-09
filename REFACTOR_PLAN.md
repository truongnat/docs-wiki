# Refactor Plan: Feature-Oriented Docs Wiki

## Status (2026-04-09)

- [x] Phase 1 complete: deterministic feature clustering shipped in `src/featureClusterer.js`
- [x] Phase 2 complete: feature pages are the primary output and module/file pages moved under `reference/`
- [x] Phase 3 complete: feature-level AI prompt and cache reuse shipped in `src/ai.js`
- [x] Phase 4 complete: feature-first landing page, search integration, config, and cross-links are in place
- [x] Legacy `modules/` and `files/` URLs are preserved through redirect stubs

Current implementation detail:
- feature pages live under `docs-wiki/features/*.md`
- reference pages live under `docs-wiki/reference/modules/**/*.md` and `docs-wiki/reference/files/**/*.md`
- old `docs-wiki/modules/**/*.md` and `docs-wiki/files/**/*.md` remain as compatibility redirects

## 1. Vấn đề hiện tại

Output hiện tại vẫn là **code-oriented**: 484 files → liệt kê module-by-module, file-by-file. Khi người đọc muốn hiểu "auth hoạt động thế nào", họ phải tự ghép 50 files rải rác giữa `@emplus/api`, `@emplus/mobile`, `@emplus/web`.

`src/design.js` đã có khái niệm `domain` (auth, payment, order…) và `flows`, nhưng:
- Domain chỉ gắn nhãn ở cấp file, không gom lại thành trang "Feature".
- Trang output vẫn là `modules/{module}/*.md` và `files/{file}.md`.
- AI prompt (`module`) sinh doc theo ranh giới thư mục, không theo ranh giới nghiệp vụ xuyên workspace.
- Không có user story, actor journey, acceptance criteria.

## 2. Mục tiêu sau refactor

Output chính là **Feature Pages** — mỗi feature là một nghiệp vụ end-to-end (Authentication, Checkout, Notifications…), gom files từ mọi workspace (backend + mobile + web). File/module pages trở thành phụ trợ (reference index).

Cấu trúc mỗi Feature Page:

1. **Overview** — 1-2 câu mô tả nghiệp vụ
2. **Actors & User Stories** — "As a <role>, I want <goal>, so that <benefit>" + acceptance criteria
3. **Business Flows** — Mermaid sequence/flowchart (login, register, reset pw…)
4. **Basic Design** — context diagram, boundary, external integrations
5. **Detail Design** — components (FE screen → API → service → repo → DB), data model, state
6. **API Contracts** — endpoints thuộc feature này
7. **Edge cases & Error handling** — inferred từ try/catch, error codes
8. **Related Files** (cuối trang) — bảng files + role + 1 dòng giải thích, link tới file page cũ

## 3. Kiến trúc mới

```
scan → parse (giữ nguyên)
  → design.js (semantic roles + domain tagging, mở rộng)
  → featureClusterer.js  [MỚI]   # gom files thành feature clusters
  → ai.js (thêm feature prompts)
  → generator.js (thêm feature page renderer)
```

### 3.1 Feature Clustering (module mới: `src/featureClusterer.js`)

Input: toàn bộ files đã có `domain`, `role`, `actions`, imports graph, API contracts, schemas.

Thuật toán (deterministic, không cần LLM):

1. **Seed từ domain**: mỗi domain (auth, payment…) = 1 candidate feature.
2. **Mở rộng qua import graph** (transitive, depth ≤ 3, weight giảm dần) — kéo file service/repo/model liên quan.
3. **Mở rộng qua API contract matching**: FE file gọi `POST /auth/login` → gom cùng feature với BE handler của route đó.
4. **Mở rộng qua schema reuse**: files cùng reference `UserSchema` + action keyword → gom.
5. **Cross-workspace linking**: 1 feature được phép span `@emplus/api` + `@emplus/mobile` + `@emplus/web`.
6. **Split khi quá lớn**: feature > N files → split theo sub-action (login / register / reset / refresh).
7. **Output**: `features[]` với shape:
   ```ts
   {
     id, title, domain, summary,
     actors: string[],
     files: Array<{ path, role, workspace, reason }>,
     apiContracts: ApiContract[],
     schemas: SchemaRef[],
     flows: Flow[],           // từ design.js, lọc theo feature
     entryPoints: { fe: [], be: [] },
   }
   ```

### 3.2 AI Layer (mở rộng `src/ai.js`)

Thêm prompt thứ 4: **Feature Prompt**.

Input: feature cluster (files + roles + contracts + flows + file-level AI summaries đã cache).
Output schema `FeatureSummarySchema`:

```ts
{
  overview: string,
  userStories: Array<{ role, goal, benefit, acceptance: string[] }>,
  basicDesign: {
    context: string,
    boundaries: string[],
    externalSystems: string[],
  },
  detailDesign: {
    components: Array<{ name, layer, responsibility }>,
    dataModel: string,
    stateManagement: string,
  },
  flowNarratives: Array<{ name, steps: string[] }>,  // text bổ sung cho mermaid
  errorCases: Array<{ case, handling }>,
  openQuestions: string[],
}
```

**Reuse file summaries**: feature prompt KHÔNG gửi lại full source — chỉ gửi path + role + file-summary đã cache ở `manifest.json`. Điều này giữ token thấp kể cả feature 50 files.

**Fallback khi không có AI**: generator vẫn render feature page từ cluster metadata (user stories rỗng, flows từ design.js, related files từ cluster).

### 3.3 Generator (mở rộng `src/generator.js`)

Routes output mới:

```
docs-wiki/
  index.md                       # landing: list features + architecture
  features/
    index.md                     # catalog với filter theo domain/workspace
    authentication.md
    checkout.md
    notifications.md
    ...
  design/                        # giữ (basic/detail/api/flows tổng)
  reference/                     # ĐỔI TÊN từ modules+files
    modules/{module}.md
    files/{file}.md
```

Feature page template đi theo 8 mục ở §2. Related Files render dưới dạng bảng grouped by workspace.

Sidebar VitePress ưu tiên `Features` lên đầu, `Reference` xuống cuối.

### 3.4 Mermaid diagrams

- **Context diagram** (Basic Design): actor → feature boundary → external systems, render từ `externalSystems` + `actors`.
- **Sequence diagram** (per user story / flow): đã có trong `design.js`, chỉ cần lọc theo feature.
- **Component diagram** (Detail Design): FE component → API endpoint → service → repo → DB, render từ imports graph trong feature cluster.

Tất cả vẫn là Mermaid (VitePress đã support).

## 4. Các bước thực hiện (phased)

### Phase 1 — Clustering (không đụng AI/UI)
- [x] Tạo `src/featureClusterer.js` với thuật toán §3.1.
- [x] Unit test với fixture nhỏ: 5 files auth span 2 workspaces → 1 feature.
- [x] Expose `features[]` vào pipeline state, ghi ra `manifest.json` để debug.
- [x] CLI flag `--debug-features` in cluster ra stdout.

**Deliverable**: chạy được `docs-wiki generate`, không đổi UI, nhưng manifest có `features[]` đúng.

### Phase 2 — Feature Page (no AI)
- [x] Thêm `renderFeaturePage()` trong `generator.js` render từ cluster metadata thuần.
- [x] Thêm `features/index.md` catalog.
- [x] Update VitePress sidebar: Features section lên đầu.
- [x] Di chuyển `modules/` và `files/` sang `reference/`.

**Deliverable**: preview docs wiki đã thấy trang Features, dù chưa có user story AI.

### Phase 3 — AI Feature Prompt
- [x] Thêm `FeatureSummarySchema` + prompt default trong `src/ai.js`.
- [x] Gọi feature prompt trong pipeline, cache theo hash(cluster).
- [x] Merge AI output vào feature page (user stories, basic/detail design, error cases).
- [x] Prompt tuning cho Ollama (smaller models hay trả JSON xấu — reuse normalization layer sẵn có).

**Deliverable**: feature page đầy đủ narrative, Mermaid, user stories.

### Phase 4 — Polish
- [x] Cross-link: file page → feature(s) nó thuộc về.
- [x] Landing page (`index.md`) overhaul: feature grid + architecture snapshot.
- [x] Search index ưu tiên feature pages.
- [x] Config mới trong `docs-wiki.config`:
  ```js
  features: {
    enabled: true,
    maxFilesPerFeature: 40,
    splitByAction: true,
    customDomains: { billing: ['invoice','subscription'] },
  }
  ```

## 5. Rủi ro & quyết định mở

1. **Cluster sai** — auth/user dễ lẫn. Mitigation: cho user override qua config `features.manual: [{id, include: [glob]}]`.
2. **Token cost Ollama**: feature 50 files × full source sẽ nổ context. Quyết định: CHỈ gửi file summaries đã cache (Phase 3 phụ thuộc Phase 1 AI file-level đã chạy xong ít nhất 1 lần).
3. **Thư mục monorepo không theo domain** (như `mobile/src/components`): domain tagging hiện dựa tên file/path. Có thể cần bổ sung heuristic dựa trên API call targets của component.
4. **Legacy `modules/` URLs** sẽ vỡ sau rename → cần redirect stub hoặc giữ song song 1 version.

## 6. Đổi gì / giữ gì

| File | Action |
|---|---|
| `src/scanner.js` | Giữ nguyên |
| `src/languages.js` | Giữ nguyên |
| `src/design.js` | Mở rộng: expose flows lọc-theo-feature, component graph helper |
| `src/ai.js` | Thêm feature prompt + schema |
| `src/generator.js` | Thêm feature renderer, restructure sidebar, move modules→reference |
| `src/featureClusterer.js` | **MỚI** |
| `src/cli.js` | Thêm flag `--debug-features` |
| `src/config.js` | Thêm `features.*` config |

## 7. Câu hỏi cho bạn trước khi code

1. OK với việc **đổi URL**: `modules/X` → `reference/modules/X`? Hay giữ nguyên để khỏi vỡ bookmark?
2. Feature granularity mong muốn: 1 feature = 1 domain lớn (Auth), hay split nhỏ (Login / Register / Reset)?
3. User story có cần tiếng Việt không, hay để tiếng Anh như các prompt hiện tại?
4. Có muốn export feature ra dạng machine-readable (JSON) để tool khác consume không?
5. Ollama model đang dùng là gì? (ảnh hưởng prompt design cho Phase 3)
