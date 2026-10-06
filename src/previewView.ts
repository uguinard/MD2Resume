import { Editor, ItemView, MarkdownView, TFile, WorkspaceLeaf, sanitizeHTMLToDom } from 'obsidian';
import { parseResume } from './parser';
import { renderResume } from './renderer';
import type MD2ResumePlugin from './main';

export const VIEW_TYPE_RESUME = 'md2resume-preview';

const PAGE_SIZES: Record<string, { w: number; h: number }> = {
	letter: { w: 8.5,   h: 11 },
	a4:     { w: 8.267, h: 11.693 },
};
const DPI = 96;

export class ResumePreviewView extends ItemView {
	plugin: MD2ResumePlugin;
	private lastFile: TFile | null = null;
	private renderTimer: number | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: MD2ResumePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return VIEW_TYPE_RESUME; }
	getDisplayText(): string { return 'Resume preview'; }
	getIcon(): string { return 'file-text'; }

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('md2resume-view');

		const toolbar = contentEl.createDiv('md2resume-toolbar');
		const printBtn = toolbar.createEl('button', { text: 'Export as PDF', cls: 'md2resume-print-btn' });
		printBtn.addEventListener('click', () => { void this.openPrintWindow(); });

		contentEl.createDiv('md2resume-frame');

		this.registerEvent(
			this.app.workspace.on('editor-change', (editor: Editor) => {
				this.scheduleRender(editor.getValue());
			})
		);

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => { void this.render(); })
		);

		await this.render();
	}

	private scheduleRender(md: string): void {
		if (this.renderTimer) window.clearTimeout(this.renderTimer);
		this.renderTimer = window.setTimeout(() => { void this.renderFromString(md); }, 150);
	}

	async renderFromString(md: string): Promise<void> {
		const frame = this.contentEl.querySelector<HTMLElement>('.md2resume-frame');
		if (!frame) return;

		const data = parseResume(md);
		const html = renderResume(data, this.plugin.settings);
		await this.buildPagedPreview(frame, html);
	}

	async render(): Promise<void> {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView) {
			this.lastFile = activeView.file;
			await this.renderFromString(activeView.editor.getValue());
			return;
		}
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension !== 'md') return;
		this.lastFile = file;
		const md = await this.app.vault.read(file);
		await this.renderFromString(md);
	}

	// ── Pagination ──────────────────────────────────────────

	private parseMarginToPx(margin: string): number {
		const val = parseFloat(margin);
		if (isNaN(val)) return Math.round(0.6 * DPI);
		if (margin.endsWith('in')) return Math.round(val * DPI);
		if (margin.endsWith('mm')) return Math.round(val * DPI / 25.4);
		if (margin.endsWith('cm')) return Math.round(val * DPI / 2.54);
		if (margin.endsWith('pt')) return Math.round(val * DPI / 72);
		return Math.round(val);
	}

	private async buildPagedPreview(frame: HTMLElement, html: string): Promise<void> {
		const { paperSize, pageMargin, fontSize, fontFamily } = this.plugin.settings;
		const size = PAGE_SIZES[paperSize] ?? PAGE_SIZES['letter']!;
		const pageW = Math.round(size.w * DPI);
		const pageH = Math.round(size.h * DPI);
		const marginPx = this.parseMarginToPx(pageMargin);
		const contentW = pageW - 2 * marginPx;
		const contentH = pageH - 2 * marginPx;

		// Render into an off-screen staging element so we can measure heights
		const staging = document.body.createDiv();
		staging.style.cssText = [
			'position:absolute',
			'top:-99999px',
			'left:0',
			`width:${contentW}px`,
			'visibility:hidden',
			`font-family:${fontFamily}`,
			`font-size:${fontSize}`,
			'line-height:1',
		].join(';');
		staging.appendChild(sanitizeHTMLToDom(html));

		// Wait one microtask so the browser applies CSS and computes layout
		await new Promise<void>(resolve => window.setTimeout(resolve, 0));

		const resumeRoot = staging.querySelector<HTMLElement>('.resume-root');
		if (!resumeRoot) {
			staging.remove();
			return;
		}

		// Measurement accumulator with overflow:hidden creates a BFC so every
		// child's margin-bottom is fully contained — the height delta after
		// adding each element is its true rendered height including margins.
		// This prevents the paginaton from undercounting and spilling content
		// into the bottom padding area.
		const measureAcc = staging.createDiv();
		measureAcc.style.cssText = `width:${contentW}px;font-family:${fontFamily};font-size:${fontSize};line-height:1;overflow:hidden;`;

		interface BlockInfo {
			height: number;
			render: (pageEl: HTMLElement) => void;
		}
		const allBlocks: BlockInfo[] = [];

		for (const topChild of Array.from(resumeRoot.children) as HTMLElement[]) {
			if (!topChild.classList.contains('cv-section')) {
				const h0 = measureAcc.offsetHeight;
				measureAcc.appendChild(topChild.cloneNode(true));
				allBlocks.push({
					height: measureAcc.offsetHeight - h0,
					render: (pageEl) => pageEl.appendChild(topChild.cloneNode(true)),
				});
				continue;
			}

			const sectionEl = topChild;
			const sectionId = sectionEl.getAttribute('data-id') ?? '';
			const h2El = sectionEl.querySelector('h2') as HTMLElement | null;
			const entryEls = Array.from(
				sectionEl.querySelectorAll<HTMLElement>(':scope > .cv-entry, :scope > .cv-tag-list')
			);

			if (entryEls.length === 0) {
				const h0 = measureAcc.offsetHeight;
				measureAcc.appendChild(sectionEl.cloneNode(true));
				allBlocks.push({
					height: measureAcc.offsetHeight - h0,
					render: (pageEl) => pageEl.appendChild(sectionEl.cloneNode(true)),
				});
				continue;
			}

			const firstEntry = entryEls[0];
			if (!firstEntry) continue;

			// Build the section in measureAcc and add entries one by one so we
			// can measure each entry's true contribution (including its margin).
			const accSec = createEl('section');
			accSec.className = 'cv-section';
			if (h2El) accSec.appendChild(h2El.cloneNode(true));
			accSec.appendChild(firstEntry.cloneNode(true));

			const h0 = measureAcc.offsetHeight;
			measureAcc.appendChild(accSec);
			allBlocks.push({
				height: measureAcc.offsetHeight - h0,
				render: (pageEl) => {
					const sec = pageEl.createEl('section', { cls: 'cv-section' });
					sec.setAttribute('data-id', sectionId);
					if (h2El) sec.appendChild(h2El.cloneNode(true));
					sec.appendChild(firstEntry.cloneNode(true));
				},
			});

			for (let i = 1; i < entryEls.length; i++) {
				const entry = entryEls[i];
				if (!entry) continue;
				const h1 = measureAcc.offsetHeight;
				accSec.appendChild(entry.cloneNode(true));
				allBlocks.push({
					height: measureAcc.offsetHeight - h1,
					render: (pageEl) => {
						const existing = Array.from(pageEl.querySelectorAll<HTMLElement>('section.cv-section'))
							.find(s => s.getAttribute('data-id') === sectionId);
						if (existing) {
							existing.appendChild(entry.cloneNode(true));
						} else {
							const sec = pageEl.createEl('section', { cls: 'cv-section' });
							sec.setAttribute('data-id', sectionId);
							sec.appendChild(entry.cloneNode(true));
						}
					},
				});
			}
		}

		staging.remove();

		// Greedily fill pages with blocks
		const pages: BlockInfo[][] = [];
		let currentPage: BlockInfo[] = [];
		let usedH = 0;

		for (const block of allBlocks) {
			if (usedH + block.height > contentH && currentPage.length > 0) {
				pages.push(currentPage);
				currentPage = [block];
				usedH = block.height;
			} else {
				currentPage.push(block);
				usedH += block.height;
			}
		}
		if (currentPage.length > 0) pages.push(currentPage);

		// Build the page cards in the frame
		frame.empty();

		for (const pageBlockList of pages) {
			const pageEl = frame.createDiv({ cls: 'resume-page resume-root' });
			pageEl.style.cssText = [
				`width:${pageW}px`,
				`height:${pageH}px`,
				`padding:${marginPx}px`,
				`font-size:${fontSize}`,
				`font-family:${fontFamily}`,
				'line-height:1',
				`--resume-font-size:${fontSize}`,
				`--resume-font-family:${fontFamily}`,
				`--resume-margin:${pageMargin}`,
				`--resume-paper-size:${paperSize}`,
			].join(';');

			// Content wrapper ensures the bottom padding is preserved by
			// clipping any tiny margin residuals at exactly contentH.
			const contentEl = pageEl.createDiv();
			contentEl.style.cssText = `height:${contentH}px;overflow:hidden;`;
			for (const block of pageBlockList) {
				block.render(contentEl);
			}
		}
	}

	// ── Export ──────────────────────────────────────────────

	private async openPrintWindow(): Promise<void> {
		let md = '';
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView) {
			md = activeView.editor.getValue();
		} else {
			const file = this.app.workspace.getActiveFile();
			if (!file) return;
			md = await this.app.vault.read(file);
		}

		const data = parseResume(md);
		const resumeHtml = renderResume(data, this.plugin.settings);
		const { paperSize } = this.plugin.settings;

		// Reuse the preview frame's already-paginated page divs whenever the
		// preview is in sync with the active file. Re-paginating via
		// buildPagedPreview here used to silently produce blank pages when the
		// staging area was modified between the preview render and this call.
		const previewFrame = this.contentEl.querySelector<HTMLElement>('.md2resume-frame');
		const previewPages = previewFrame
			? Array.from(previewFrame.querySelectorAll<HTMLElement>('.resume-page'))
			: [];

		let pagesHtml: string;
		if (previewPages.length > 0) {
			pagesHtml = previewPages.map(p => p.outerHTML).join('\n');
		} else {
			// Fallback: preview was never rendered for this file (e.g. the view
			// was opened on a non-markdown file). Paginate into a detached frame.
			console.warn('MD2Resume export: preview not yet populated — paginating now');
			const stagingFrame = createDiv();
			await this.buildPagedPreview(stagingFrame, resumeHtml);
			pagesHtml = Array.from(stagingFrame.children)
				.map(p => p.outerHTML)
				.join('\n');
		}

		if (!pagesHtml.trim()) {
			console.error('MD2Resume export: pagination produced no pages — aborting');
			return;
		}

		console.log(`MD2Resume export: ${(previewPages.length || 0)} page(s) → PDF (${pagesHtml.length} chars)`);

		const css = this.collectResumeCss();
		const pdfPageSize = paperSize === 'a4' ? 'A4' : 'Letter';

		// Each .resume-page div is exactly pageW×pageH px. The @page rule and
		// break-after:page together ensure each div maps to exactly one PDF page.
		// marginType:'none' means Electron adds no extra margins; the div's own
		// padding already provides the visual margin.
		const doc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Resume</title>
<style>
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: white; }
h1, h2, h3, h4, h5, h6, p, ul, ol, li { margin: 0; padding: 0; }
${css}
.resume-page { box-shadow: none; break-after: page; page-break-after: always; }
.resume-page:last-child { break-after: auto; page-break-after: auto; }
@page { size: ${pdfPageSize}; margin: 0; }
</style>
</head>
<body>
${pagesHtml}
</body>
</html>`;

		// Auto-save path: open the export doc in a hidden BrowserWindow, render
		// to PDF via printToPDF, save to disk through the system save dialog.
		try {
			const fs   = require('fs')   as { writeFileSync: (p: string, d: string | Uint8Array) => void; unlinkSync: (p: string) => void };
			const path = require('path') as { join: (...a: string[]) => string };
			const os   = require('os')   as { tmpdir: () => string };
			const { remote } = require('electron') as {
				remote: {
					BrowserWindow: new (opts: object) => {
						loadURL: (url: string) => Promise<void>;
						close: () => void;
						webContents: {
							on: (event: string, cb: () => void) => void;
							printToPDF: (opts: object) => Promise<Uint8Array>;
						};
					};
					dialog: {
						showSaveDialog: (opts: object) => Promise<{ canceled: boolean; filePath?: string }>;
					};
				};
			};

			// Write the export HTML as a data: URL so Electron doesn't have to
			// resolve a filesystem path. data: URLs work in every Chromium build
			// and bypass any symlink / file:// path-resolution issues.
			const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(doc);

			const printWin = new remote.BrowserWindow({
				show: false,
				webPreferences: { nodeIntegration: false, contextIsolation: true },
			});

			try {
				const pdfData = await new Promise<Uint8Array>((resolve, reject) => {
					printWin.webContents.on('did-finish-load', () => {
						window.setTimeout(() => {
							void printWin.webContents.printToPDF({
								printBackground: true,
								pageSize: pdfPageSize,
								margins: { marginType: 'none' },
							}).then(resolve, reject);
						}, 800);
					});
					void printWin.loadURL(dataUrl);
				});

				const result = await remote.dialog.showSaveDialog({
					title: 'Save Resume as PDF',
					defaultPath: 'resume.pdf',
					filters: [{ name: 'PDF', extensions: ['pdf'] }],
				});

				if (!result.canceled && result.filePath) {
					fs.writeFileSync(result.filePath, pdfData);
				}
			} finally {
				try { printWin.close(); } catch { /* ignore */ }
			}
		} catch (err) {
			console.error('MD2Resume: failed to export PDF', err);
		}
	}

	private collectResumeCss(): string {
		const chunks: string[] = [];
		for (const sheet of Array.from(document.styleSheets)) {
			try {
				for (const rule of Array.from(sheet.cssRules)) {
					const text = rule.cssText;
					// Always keep CSS custom-property declarations so `var(--spine)` etc.
					// resolve correctly in the PDF (Electron BrowserWindow has no :root from
					// Obsidian's theme).
					if (text.startsWith(':root') || text.startsWith('@media print')) {
						chunks.push(text);
						continue;
					}
					if (/resume-|\.cv-entry|\.cv-section|\.cv-tag-list|\.cv-profile|\.cv-languages|\.cv-references-note|contact-link/.test(text)) {
						chunks.push(text);
					}
				}
			} catch {
				// Cross-origin stylesheet — skip
			}
		}
		return chunks.join('\n');
	}

	async onClose(): Promise<void> {
		if (this.renderTimer) window.clearTimeout(this.renderTimer);
		this.contentEl.empty();
	}
}
