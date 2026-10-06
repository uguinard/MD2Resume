# 2026-10-06 14:55 — New frontmatter fields, Professional Profile section, PDF visual fix, central tab

## Context
After the cv_design-inspired redesign the user wanted four things:
1. Add `phone`, `location`, `languages` to the frontmatter and wire them into the rendered contact line.
2. Add a `## Professional Profile` section that renders as a justified prose block (no section heading, no entry list).
3. Fix the PDF export so the design's red spine underline under the name, the em-dash markers in bullet items, and the `var(--ink-light)` colour all show up — the preview tab was correct, the exported PDF was missing those visual elements.
4. The "Preview resume" command/ribbon opened in the right sidebar; the user wants it to open as a central tab instead.

## Files affected
- `src/parser.ts`
- `src/types.ts`
- `src/renderer.ts`
- `src/previewView.ts`
- `src/main.ts`
- `styles.css`
- `changes/cv_content.md`
- `main.js` (regenerated)

## Before vs After

### 1. New frontmatter keys (`src/renderer.ts`)
**Before** — contact line used `contact_phone` only:
```ts
if (contact['contact_phone']) { /* …tel: link… */ }
```
**After** — `phone`, `location`, `languages` recognised and `contact_phone` kept for back-compat:
```ts
if (contact['phone'])        { /* tel: link */ }
if (contact['contact_phone']) { /* tel: link */ }
if (contact['location'])     { /* plain span */ }
if (contact['contact_email']) { /* mailto */ }
if (contact['contact_website']) { /* https link */ }
if (contact['contact_linkedin']) { /* linkedin.com/in/<id> */ }
if (contact['contact_github'])   { /* github.com/<id> */ }

function buildLanguagesLine(contact) {
    const raw = contact['languages'];
    if (!raw) return '';
    const items = raw.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    return `<div class="cv-languages">${items.map(...).join('')}</div>`;
}
```

### 2. Professional Profile (`src/parser.ts`, `src/types.ts`, `src/renderer.ts`)
**Before** — `parseResume` returned `{ contact, sections }`; a `## Professional Profile` section was treated as a normal section and collected free-text lines into `section.tags`, which the renderer would emit under a `cv-section-head` heading.

**After**:
```ts
// parser.ts
if (heading.toLowerCase() === 'professional profile') {
    // build paragraphs: blank line = break, bullet = own paragraph, otherwise fold
    const paras = [];
    let buf = [];
    const flush = () => { const j = buf.join(' ').trim(); if (j) paras.push(j); buf = []; };
    for (const raw of lines) {
        const line = raw.trim();
        if (line === '') { flush(); continue; }
        if (line.startsWith('- ') || line.startsWith('* ')) { flush(); paras.push(line.slice(2).trim()); continue; }
        buf.push(line);
    }
    flush();
    profile = paras.join('\n\n');
    continue; // do not push into sections
}
return { contact, sections, profile };
```
```ts
// renderer.ts
function renderProfile(profile: string | undefined): string {
    if (!profile) return '';
    const paras = profile
        .split(/\n{2,}/)
        .map(p => p.trim()).filter(Boolean)
        .map(p => `<p>${escHtml(p)}</p>`).join('\n');
    return `<section class="cv-profile" data-id="cv-profile">${paras}</section>`;
}
```
`types.ts`: added `profile?: string` to `ResumeData`.

CSS (`styles.css`):
```css
.cv-profile { margin: 2.5mm 0 4mm; }
.cv-profile p {
    font-size: 8.6pt; line-height: 1.48; color: var(--ink);
    text-align: justify; hyphens: auto; margin: 0 0 1.5mm;
}
```

### 3. PDF export losing visuals — `src/previewView.ts`
**Before** — `collectResumeCss()` only kept rules whose cssText matched the regex. The `:root` rule had cssText `--- root { --spine: #8B2020; --ink: #1C1A17; --ink-light: #5C5750 }` which matched none of the keywords, so it was dropped. In the exported PDF, every `var(--spine)` / `var(--ink-light)` resolved to invalid → the underline and small-caps contact line lost their accent colour.

**After**:
```ts
if (text.startsWith(':root') || text.startsWith('@media print')) {
    chunks.push(text);
    continue;
}
if (/resume-|\.cv-entry|\.cv-section|\.cv-tag-list|\.cv-profile|\.cv-languages|\.cv-references-note|contact-link/.test(text)) {
    chunks.push(text);
}
```

### 4. Central tab — `src/main.ts`
**Before**:
```ts
let leaf = workspace.getRightLeaf(false);
if (!leaf) leaf = workspace.getLeaf(true);
```
**After**:
```ts
const leaf = workspace.getLeaf('tab');
```
A 'tab' leaf opens in the main editor area as a normal tab next to the markdown file.

## Reasoning
- **`phone` vs `contact_phone`** — kept both so the existing MD2Resume-Template.md still produces valid output. The user's frontmatter uses the short form; the old `contact_*` namespace still works.
- **`languages`** is split by punctuation because YAML lists in markdown frontmatter are read line-by-line; a comma-separated string is the lowest-friction authoring format. If the user wants YAML list syntax (`languages:\n  - Spanish\n  - English`) the renderer would need a parser upgrade — currently it would render the literal YAML list as a single string. Document if the user prefers it.
- **Profile prose folding** treats blank lines as paragraph breaks (Markdown convention). A line starting with `-` or `*` is detached into its own paragraph. This is conservative — bold/italic markdown inside the profile will appear as raw asterisks. Document if the user wants inline markdown.
- **PDF fix** — the filter regex was the single root cause. `:root` is now always preserved so all CSS custom properties survive the export. The `@media print` rule is also preserved so print-only overrides apply during export (Electron's printToPDF honours media queries when `printBackground: true`).
- **Central tab** — `getLeaf('tab')` is the documented Obsidian API for opening a new tab in the main editor area. `getRightLeaf(false)` would create a sidebar leaf.

## Risks / side effects
- **Languages field**: the comma-separated parser assumes the user doesn't write a literal comma inside a CEFR note (e.g. `Spanish, Native`). If they do, the field will be split at the comma. The cv_content.md uses `Spanish (Native/C2)` which is safe.
- **Professional Profile**: paragraphs that wrap mid-sentence in the markdown source will be joined with a single space, which is the intended behaviour but might surprise authors used to hard-wrapped markdown.
- **PDF fix**: the `:root` rule may now collide with Obsidian's own `:root` rule during export. Both will be appended; the last one wins. Obsidian's theme variables (`--background-primary` etc.) are not used by the resume so this is harmless. The exported HTML body sets `background: white` and the resume content area sets `background: #F7F4EE` per-page, so the visual result is unchanged.
- **`getLeaf('tab')`**: in some Obsidian configurations (mobile, no main editor area), this may fall back to creating a new window. The MD2Resume plugin already calls `revealLeaf(leaf)` so the leaf is always made active.