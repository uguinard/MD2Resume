# 2026-10-06 15:05 — Refresh template and documentation

## Context
The plugin gained new features (phone/location/languages frontmatter keys, references_note, Professional Profile section) but the existing `MD2Resume-Template.md` was still based on the original feature set — it only used `name`, `contact_email`, `contact_website`, `contact_linkedin`, `contact_github`, and `header`. The user asked for a new template that demonstrates the full schema and is easy to duplicate-and-edit.

## Files affected
- `MD2Resume-Template.md` (rewritten)
- `README.md` (Properties section + Body notes)
- `main.js` (regenerated)

## Before vs After

### First attempt (failed)
I initially placed the schema documentation as an HTML comment **above** the YAML frontmatter. The plugin's `parseFrontmatter` regex (`/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/`) anchors at line 1, so the comment ate the frontmatter entirely — the rendered preview showed an empty contact row and the frontmatter keys never reached the renderer.

**Verification output (before fix):**
```
contact keys: [ 'name', 'contact' ]
phone: undefined
location: undefined
languages: undefined
references_note: undefined
```

### Fix
The frontmatter now occupies the first 14 lines. The documentation comment lives in the body, immediately after the closing `---`, as an `<!-- ... -->` block. The parser's body splitter is `/split(/(?=^## )/m)`, which never matches a comment line, and the section iterator filters with `if (block.match(/^## /))`, so the comment is silently discarded.

**Verification output (after fix):**
```
contact keys: [ 'name', 'contact', 'phone', 'location', 'languages',
                 'contact_email', 'contact_website', 'contact_linkedin',
                 'contact_github', 'header', 'references_note' ]
phone: (+1) 555-000-0000
location: City, Country
languages: Language A (C2), Language B (C1), Language C (B2)
references_note: Additional references available upon request.

Rendered sanity:
  OK : profile section
  OK : languages line
  OK : phone tel link
  OK : location text
  OK : references note
  OK : work experience heading
  OK : projects heading
  OK : certs heading
  OK : education heading
  OK : job entry head
  OK : job meta date
  OK : project colon split
  OK : tag list
```

### Schema of the new template
The template now contains:
- **Frontmatter block (14 lines, line 1–14)**: every supported key with a placeholder value.
- **HTML comment (lines 17–47)**: schema reference for the user. Hidden in the rendered preview.
- **`## Professional Profile`**: two prose paragraphs demonstrating the section.
- **`## Work Experience`**: three job entries with the `### Title | Date` + `*Company, City*` pattern and bullet points.
- **`## Projects`**: two project entries using the `### Title: Subtitle` colon pattern.
- **`## Certifications and Tools`**: tag-list section with plain text lines.
- **`## Community Experience`**: one community entry.
- **`## Education`**: two degree entries.

### README update
The "Properties" list gained `phone`, `location`, `languages`, and `references_note`. The "Body" section notes that `## Professional Profile` is rendered as a prose block (no section heading).

## Reasoning
- **Frontmatter first, comment second** keeps the parser contract: YAML must start at line 1. Putting the documentation in the body, where it's just markdown text the parser filters out, keeps the help text close to the frontmatter without breaking parsing.
- **Placeholders, not real values** (`Your Name`, `City, Country`, `Language A (C2), …`) make it obvious what the user is supposed to replace. Real-looking sample data (like John Doe's previous template) is fine for screenshots but easy to forget to change before exporting a real CV.

## Side effects / things to know
- The HTML comment is preserved verbatim in the file the user duplicates — it survives in every resume they create from the template. If they want to remove it they can simply delete the `<!-- … -->` block. The comment has no rendering cost.
- The README still says "Press the 'Preview Resume' button on the left panel" but with the central-tab change it's actually the ribbon icon (or the command palette) — left as-is because the screenshot in the README still points at the ribbon icon. If the user wants a docs pass, that's a follow-up.