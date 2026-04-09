# Upgrade Research: biến `docs-wiki` thành tool "xịn"

Bổ sung cho `REFACTOR_PLAN.md`. Tập trung vào những năng lực mà các tool 2026 (Swimm, Mintlify, DocuWriter, CodeDocs AI, Codebase-Memory, Graph-RAG research) đang có mà `docs-wiki` còn thiếu — và con đường ngắn nhất để bắt kịp.

## Status update (2026-04-09)

Đã được đưa vào codebase:

- [x] Feature layer theo `REFACTOR_PLAN.md`
- [x] Lightweight local interaction/call graph trong `src/design.js`
- [x] Drift detection / CI gate qua `docs-wiki check` và `src/drift.js`

Trạng thái thực tế:

- `1.1 Call graph thật`: đã có local interaction graph + imported-symbol call inference, nhưng vẫn là heuristic cho dynamic languages; chưa phải whole-program graph hoàn chỉnh
- `1.2 Feature clustering`: đã hoàn thành ở mức production-ready cho output wiki hiện tại
- `1.3 Drift detection & CI gate`: đã hoàn thành bản đầu tiên, đủ để fail CI khi docs stale

Các mục còn lại bên dưới vẫn là roadmap hợp lý sau mốc hiện tại.

## 1. Vị trí hiện tại của `docs-wiki`

Điểm mạnh đã có:
- Tree-sitter multi-language (JS/TS/Py/Go/Rust) — đúng hướng mà research 2026 khuyên (AST-derived graph > LLM-extracted graph về cost & reliability).
- Có semantic layer (`design.js`: roles, domains, flows) — hiếm tool OSS nào có sẵn.
- Incremental cache + hash — nền cho real-time docs.
- Output VitePress + Mermaid — đã production-ready về rendering.
- Hỗ trợ cả Ollama (local) và OpenAI — privacy-friendly.

Điểm yếu so với "xịn":
- Chỉ dừng ở file/module, chưa có **feature layer** (đang refactor ở `REFACTOR_PLAN.md`).
- Không có **call graph thực sự** (chỉ có imports), nên multi-hop reasoning kém.
- Không có **RAG/search ngữ nghĩa** — chỉ có full-text VitePress search.
- Không **auto-sync với code changes** (Swimm-style): watch mode có, nhưng không flag docs lỗi thời.
- Không có **MCP server** để LLM/IDE agent query knowledge graph.
- Không có **drift detection / CI gate**.
- Không có **test & example generation** (DocuWriter có).
- Không có **versioning** theo git history (docs của branch/tag/commit nào).

## 2. Các năng lực cần bổ sung (xếp theo ROI)

### Tier 1 — Bắt buộc để được coi là tool "xịn"

#### 1.1 Call graph thật (không chỉ imports)
- **Vấn đề**: clustering feature hiện dựa imports + naming. Feature span FE↔BE cần biết "hàm X gọi endpoint Y, endpoint Y xử lý bởi handler Z".
- **Giải pháp**: mở rộng tree-sitter queries để extract call sites (function calls, method calls, HTTP client calls như `fetch`/`axios`/`ky`, RPC calls). Build directed graph `node = symbol, edge = calls/reads/writes`.
- **Insight từ research**: *"AST-derived graphs provide more reliable coverage and multi-hop grounding than LLM-extracted graphs at substantially lower indexing cost"* ([arxiv 2601.08773](https://arxiv.org/abs/2601.08773)).
- **Effort**: trung bình. Reuse tree-sitter đã load. Thêm `src/callGraph.js`.

#### 1.2 Feature clustering (đang có trong REFACTOR_PLAN)
- Gom nghiệp vụ xuyên workspace. Đã detail ở plan trước.

#### 1.3 Drift detection & CI gate
- **Vấn đề**: docs sinh ra 1 lần rồi lỗi thời. Swimm bán được chủ yếu nhờ cái này.
- **Giải pháp**: lưu `manifest.json` (đã có) → thêm command `docs-wiki check`:
  - So sánh hash hiện tại với snapshot trước đó.
  - Nếu symbol bị sửa nhưng AI summary không tái sinh → fail.
  - Nếu API contract thay đổi mà feature page chưa update → warn.
  - Exit code ≠ 0 để dùng trong GitHub Actions.
- **Effort**: thấp. Đã có hash cache.

#### 1.4 Semantic search / RAG endpoint
- **Vấn đề**: người dùng/LLM agent không tra cứu được theo ý nghĩa.
- **Giải pháp**:
  - Sinh embeddings (Ollama `nomic-embed-text` local → free) cho mỗi symbol/feature.
  - Lưu vào `search-index.json` bổ sung vector column + HNSW nhỏ, hoặc sqlite-vss/lancedb local file.
  - VitePress plugin custom cho "AI search" box.
  - CLI: `docs-wiki ask "làm sao reset password?"` → RAG trả markdown.
- **Insight**: [LanceDB blog](https://lancedb.com/blog/building-rag-on-codebases-part-1/) — chunking theo tree-sitter boundaries cho accuracy cao nhất.
- **Effort**: trung bình-cao (1 dependency mới).

### Tier 2 — Tạo khác biệt

#### 2.1 MCP server mode
- **Xu hướng 2026 dominant**: [Codebase-Memory](https://arxiv.org/abs/2603.27277) — knowledge graph exposed qua MCP, đạt 83% quality với **10× ít tokens** hơn file exploration.
- **Giải pháp**: thêm `docs-wiki mcp` → start MCP server expose tools:
  - `find_feature(query)` → feature page
  - `get_call_graph(symbol)` → neighbors
  - `explain_flow(endpoint)` → Mermaid + narrative
  - `list_related_files(feature_id)`
- Cho phép Claude Code / Cursor / Continue query trực tiếp thay vì grep.
- **Effort**: trung bình. Dùng `@modelcontextprotocol/sdk`.

#### 2.2 Git history awareness
- **Vấn đề**: tool không biết "tính năng này ai viết, khi nào, PR nào".
- **Giải pháp**: `git log --follow` cho mỗi file → ownership, last change date, churn score. Feature page gắn badge "Last updated 2026-03", "Owners: @alice @bob".
- Versioned docs: `docs-wiki generate --rev v1.2.0` để preview doc history.
- **Effort**: thấp (chỉ parse git).

#### 2.3 Test & example generation
- **Inspire từ DocuWriter**. Với mỗi user story đã sinh, yêu cầu AI:
  - Sinh example request/response JSON cho API contract.
  - Sinh test stub (Vitest/Jest/Pytest) cho acceptance criteria.
  - Output vào `docs-wiki/examples/` (không ghi đè source).
- **Effort**: trung bình.

#### 2.4 Architecture Decision Record (ADR) detection
- Scan commits + markdown files cho pattern `ADR-*.md` hoặc `decision:` keywords. Surface trên feature page.
- **Effort**: thấp.

### Tier 3 — Polish & DX

#### 3.1 Interactive diagrams
- Mermaid → click vào node → nhảy tới file page. VitePress có plugin sẵn.
- Zoomable call graph (Cytoscape.js) cho feature lớn.

#### 3.2 Multi-language AI prompts
- Hiện prompt hardcode tiếng Anh. Config `language: 'vi' | 'en' | 'ja'`. User story tiếng Việt cho team VN.

#### 3.3 Preset themes theo domain
- `--preset fintech` / `--preset saas` → thay đổi domain taxonomy + sidebar labels + color.

#### 3.4 Publish pipeline
- `docs-wiki publish` → push lên GitHub Pages / Vercel / Cloudflare Pages với front-matter SEO.

#### 3.5 Config UI
- Mini web UI (`docs-wiki config`) để tweak domains, manual feature mapping, AI settings — thay vì edit config file.

#### 3.6 Evaluation harness
- Script bench: đo recall của feature clustering trên fixture projects, accuracy của API contract inference. Regression guard khi refactor.

## 3. Nền tảng kỹ thuật cần thêm vào codebase

| Thành phần | Vai trò | Ghi chú triển khai |
|---|---|---|
| `src/callGraph.js` | Build call graph từ AST | Reuse tree-sitter parsers; output JSON graph |
| `src/featureClusterer.js` | Gom feature (đã plan) | Phụ thuộc callGraph cho cross-workspace |
| `src/embeddings.js` | Sinh & lưu vector index | Ollama embed API; sqlite-vss hoặc JSON-HNSW |
| `src/rag.js` | Retrieval + prompt wrapping | Dùng cho `ask` CLI và MCP |
| `src/mcp/server.js` | MCP tool definitions | `@modelcontextprotocol/sdk` |
| `src/git.js` | Ownership/churn/ADR scan | `simple-git` hoặc shell git |
| `src/drift.js` | Check stale docs | Compare manifest hashes |
| `src/eval/` | Fixture + metrics | CI-integrated |

## 4. Roadmap gợi ý (tích hợp với REFACTOR_PLAN.md)

1. **M1 — Feature pages (REFACTOR_PLAN phases 1-3)** — 2-3 tuần. Đã plan.
2. **M2 — Call graph + drift check** — thêm call graph (1.1), CI gate (1.3). 1-2 tuần.
3. **M3 — RAG & MCP** — embeddings (1.4) + MCP server (2.1). 2 tuần. Đây là bước biến tool thành agent-friendly.
4. **M4 — Git awareness + tests gen** — 2.2, 2.3. 1-2 tuần.
5. **M5 — Polish** — Tier 3. Rolling.

Sau M3, `docs-wiki` sẽ là một trong số rất ít OSS tool:
- Local-first (Ollama), privacy-friendly
- Feature-oriented docs xuyên monorepo
- AST-derived knowledge graph (chứ không phải LLM-extracted)
- MCP-ready cho IDE agent
- CI-gated drift detection

Đó là điểm khác biệt rõ với Mintlify (hosted, no graph), Swimm (proprietary, không gen toàn bộ), DocuWriter (file-level, không feature), CodeDocs AI (summary only).

## 5. Rủi ro & quyết định mở

1. **Embedding cost**: Ollama `nomic-embed-text` free nhưng slow trên CPU. Cần incremental — chỉ embed symbol thay đổi.
2. **MCP compatibility**: spec còn đổi; pin version.
3. **Call graph precision** cho dynamic languages (JS/Python) — sẽ miss dynamic dispatch, dynamic imports. Chấp nhận recall > precision, gắn confidence score.
4. **Scope creep**: tool đang là "static analyzer + AI writer". Tier 2 biến nó thành "knowledge platform". Cần quyết định positioning trước khi code M3.

## 6. Câu hỏi cho bạn

1. Positioning cuối: **"internal wiki generator"** (đơn giản, đẹp) hay **"codebase knowledge platform"** (có MCP, RAG, CI gate)? Ảnh hưởng tới có làm M3 hay không.
2. Target user: solo dev / team 5-20 / enterprise? Quyết định features như ownership, multi-lang, ADR.
3. Muốn giữ zero-config hay chấp nhận thêm deps (sqlite-vss, MCP SDK)?
4. Có plan open-source / publish npm không? Ảnh hưởng license & docs.
5. Ưu tiên M2 (drift check) hay M3 (RAG/MCP) trước?

## Sources

- [Codebase-Memory: Tree-Sitter-Based Knowledge Graphs for LLM Code Exploration via MCP (arxiv 2603.27277)](https://arxiv.org/abs/2603.27277)
- [Reliable Graph-RAG for Codebases: AST-Derived Graphs vs LLM-Extracted Knowledge Graphs (arxiv 2601.08773)](https://arxiv.org/abs/2601.08773)
- [How I Built CodeRAG with Dependency Graph Using Tree-Sitter (Medium)](https://medium.com/@shsax/how-i-built-coderag-with-dependency-graph-using-tree-sitter-0a71867059ae)
- [Building RAG on codebases (LanceDB)](https://lancedb.com/blog/building-rag-on-codebases-part-1/)
- [GraphRAG for Devs (Memgraph)](https://memgraph.com/blog/graphrag-for-devs-coding-assistant)
- [Best AI Documentation Generators 2026 (nxcode)](https://www.nxcode.io/resources/news/ai-documentation-generator-2026)
- [6 Best AI Tools for Coding Documentation 2026 (index.dev)](https://www.index.dev/blog/best-ai-tools-for-coding-documentation)
- [Best Code Documentation Generators 2026 (EganForge)](https://eganforge.com/blog/best-code-documentation-generators-2026)
- [Mintlify](https://www.mintlify.com)
- [4 Best Open Source Mintlify Alternatives 2026](https://openalternative.co/alternatives/mintlify)
