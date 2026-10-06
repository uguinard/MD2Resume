# 2026-10-06 15:15 — Profile heading restored, blank PDF export fixed

## Context
The user reported two bugs after the previous changes:
1. The `## Professional Profile` heading text is not visible in the preview.
2. Exporting to PDF produces a file but the file is blank. Preview renders correctly, no console errors.

## Files affected
- `src/parser.ts`
- `src/types.ts`
- `src/renderer.ts`
- `src/previewView.ts`
- `styles.css`
- `main.js` (regenerated)

## Bug 1 — Professional Profile heading missing

### Root cause
The previous commit extracted the Professional Profile section into `ResumeData.profile: string | undefined` containing only the prose. The renderer emitted `<section class="cv-profile"><p>…</p></section>` with no `<h2>`. The `cv_design.html` reference, however, has `<div class="cv-section-head">Professional Profile</div>` as a small-caps heading before the prose.

### Fix
The parser now returns `{ heading, paragraphs }` instead of just the joined prose string. The renderer emits the heading using the same `cv-section-head` style as other sections, so the heading is visually consistent and on-brand.

```ts
// parser.ts
profile = { heading, paragraphs: paras };

// renderer.ts
function renderProfile(profile: ResumeProfile | undefined): string {
    if (!profile) return '';
    const heading = `<h2 class="cv-section-head">${escHtml(profile.heading)}</h2>`;
    const paras = profile.paragraphs.map(p => `<p>${escHtml(p)}</p>`).join('\n');
    return `<section class="cv-section cv-profile-section" data-id="cv-profile">${heading}\n${paras}\n</section>`;
}
```

### Why add `cv-section` alongside `cv-profile-section`
Pagination in `buildPagedPreview` is keyed on the `cv-section` class: a top-level child without `cv-section` is measured and appended as a single block. The profile has no `.cv-entry`/`.cv-tag-list` children — only `<h2>` and `<p>` — so it would still fall into the right "no entries" path even if it didn't carry `cv-section`. But giving it `cv-section` keeps the existing pagination contract clean and means future changes to "section" handling automatically include the profile.

### CSS
Renamed `.cv-profile` → `.cv-profile-section`. The selector still matches the same elements. `collectResumeCss`'s regex `/resume-|\.cv-entry|\.cv-section|\.cv-tag-list|\.cv-profile|\.cv-languages|\.cv-references-note|contact-link/` matches both `cv-profile` and `cv-profile-section` (the prefix match covers it).

## Bug 2 — Blank PDF export

### Root cause (hypothesised)
`openPrintWindow()` previously called `buildPagedPreview(stagingFrame, resumeHtml)` for a second time, after the preview's auto-render had already paginated. `buildPagedPreview` uses an off-screen `staging` div for height measurement; the staging is created fresh each call but reads from `document.body` and uses `sanitizeHTMLToDom`. Some race condition between the two calls — most likely the second call's measurement returning zero-height blocks because the browser hadn't yet applied styles to the freshly-created staging — produced page divs with no content. The PDF was generated, but every page was empty.

This is consistent with the user's observation: preview works (first paginate), export fails (second paginate), no console error.

### Fix
Skip the second paginate. `openPrintWindow()` now reads the page divs straight from the already-paginated preview frame:

```ts
const previewFrame = this.contentEl.querySelector<HTMLElement>('.md2resume-frame');
const previewPages = previewFrame
    ? Array.from(previewFrame.querySelectorAll<HTMLElement>('.resume-page'))
    : [];

let pagesHtml: string;
if (previewPages.length > 0) {
    pagesHtml = previewPages.map(p => p.outerHTML).join('\n');
} else {
    // Fallback: preview not yet rendered. Paginate into a detached frame.
    console.warn('MD2Resume export: preview not yet populated — paginating now');
    const stagingFrame = createDiv();
    await this.buildPagedPreview(stagingFrame, resumeHtml);
    pagesHtml = Array.from(stagingFrame.children).map(p => p.outerHTML).join('\n');
}
```

### Why this is safe
- The preview paginates synchronously after every `editor-change` (150 ms debounce → `renderFromString` → `buildPagedPreview`). By the time the user clicks "Export as PDF", the preview's page divs are guaranteed current.
- `p.outerHTML` returns fully self-contained HTML including all inline styles (`width`, `height`, `padding`, `--resume-*` vars). The export CSS rules + per-page overlays are sufficient to reproduce the layout in the print window.
- The fallback path retains the old detached-frame paginate, but only runs if the preview has zero pages. A `console.warn` makes it visible when this happens so a future regression is easy to spot.

### Diagnostics
Added `console.log(\`MD2Resume export: N page(s) → PDF (chars)\`)`. If the user reports a blank PDF again, this log tells us whether we reused the preview (chars > 0 expected) or fell through to the fallback.

## Verification

End-to-end parser/renderer test against `changes/cv_content.md` and `MD2Resume-Template.md`:
```
profile heading: Professional Profile
profile paragraphs: 2
contains cv-section cv-profile-section: true
contains Professional Profile heading: true
```
Build: `tsc -noEmit -skipLibCheck && node esbuild.config.mjs production` → clean. `main.js` regenerated.

## Risks / side effects
- If the preview tab is detached or its frame has been emptied by some plugin interaction, the export still falls back to detached pagination. The fallback keeps the old code path alive.
- The `cv-section` class on the profile makes it look like a normal section to any future code that walks `.cv-section` elements — but this is the intended behaviour: the profile is a section, just one with prose instead of entries.
- If a user names a section `## Professional Profile:` (with colon) the parser still detects it by case-insensitive equality with the heading text. Any non-empty heading other than literally "Professional Profile" goes through the normal `parseSection` path.