/* =========================================================
   TransferTracker — ASSIST agreement import
   ---------------------------------------------------------
   The premise: we are not allowed to pull articulation data from
   ASSIST, and we should not scrape it — unauthorized scraping is
   what delayed ASSIST's own public API. But the student is entitled
   to their agreement and can retrieve it in about thirty seconds.

   So the app never stores articulation data. The student brings
   their own, we parse it, and the plan is rebuilt from the real
   agreement instead of a C-ID approximation.

   That inverts the staleness problem rather than solving it: there
   is no cached articulation to go stale, because every plan is built
   from a document the student pulled today.

   Input: pasted text, or a PDF exported from assist.org.
   Output: structured requirements merged into the existing planner.
   ========================================================= */

const ASSIST_IMPORT = (() => {

  const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const MAX_CHARS = 60000;

  let pdfjsReady = null;

  /* ---------------- PDF text extraction ---------------- */

  function loadPdfJs() {
    if (pdfjsReady) return pdfjsReady;
    pdfjsReady = new Promise((resolve, reject) => {
      if (window.pdfjsLib) { resolve(window.pdfjsLib); return; }
      const s = document.createElement('script');
      s.src = PDFJS_URL;
      s.onload = () => {
        if (!window.pdfjsLib) { reject(new Error('pdfjs-missing')); return; }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        resolve(window.pdfjsLib);
      };
      s.onerror = () => reject(new Error('pdfjs-blocked'));
      document.head.appendChild(s);
    });
    return pdfjsReady;
  }

  /**
   * Pull text out of an ASSIST PDF.
   * ASSIST agreements are two-column: receiving requirement on the left,
   * the community college equivalent on the right. Naive extraction
   * interleaves them and destroys the pairing, so we bucket text items
   * by x-position and emit each row as "LEFT  ||  RIGHT". That single
   * hint does more for parse accuracy than any amount of prompting.
   */
  async function pdfToText(file, onProgress) {
    const pdfjsLib = await loadPdfJs();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const pages = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      if (onProgress) onProgress(p, pdf.numPages);
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const width = page.getViewport({ scale: 1 }).width;
      const midpoint = width / 2;

      // Group items into rows by rounded y, then split each row at the midpoint.
      const rows = new Map();
      content.items.forEach(item => {
        if (!item.str || !item.str.trim()) return;
        const x = item.transform[4];
        const y = Math.round(item.transform[5] / 4) * 4;   // tolerate baseline jitter
        if (!rows.has(y)) rows.set(y, { left: [], right: [] });
        rows.get(y)[x < midpoint ? 'left' : 'right'].push({ x, s: item.str });
      });

      const ordered = [...rows.entries()].sort((a, b) => b[0] - a[0]);   // top to bottom
      const lines = ordered.map(([, r]) => {
        const L = r.left.sort((a, b) => a.x - b.x).map(i => i.s).join(' ').replace(/\s+/g, ' ').trim();
        const R = r.right.sort((a, b) => a.x - b.x).map(i => i.s).join(' ').replace(/\s+/g, ' ').trim();
        if (!L && !R) return '';
        return R ? `${L}  ||  ${R}` : L;
      }).filter(Boolean);

      pages.push(`--- page ${p} ---\n${lines.join('\n')}`);
    }

    const text = pages.join('\n\n');
    if (!text.trim()) throw new Error('pdf-empty');
    return text.slice(0, MAX_CHARS);
  }

  /* ---------------- extraction prompt ---------------- */

  const SYSTEM = `You extract structured data from California ASSIST.org articulation agreements.

An ASSIST agreement pairs requirements at a receiving university (UC, CSU, or independent) with the courses at one sending community college that satisfy them. In the text you receive, "||" separates the receiving requirement (left) from the sending community college equivalent (right).

Read carefully for these, because students are harmed most when they are missed:
- "No Course Articulated" / "Not Articulated" — the requirement CANNOT be satisfied at this college. This is critical information, not an absence of information. Record it.
- AND vs OR between sending courses. "BIOL 1 AND BIOL 2" means both are required. "MATH 1 OR MATH 2" means either suffices. Never collapse AND into OR.
- Course sequences and grouped requirements ("Select 2 courses from the following").
- Notes attached to a requirement, such as a minimum grade or a deadline.

Reply with JSON only. No prose, no markdown fences.`;

  function userPrompt(text, hint) {
    return `Extract this articulation agreement.

${hint ? `The student says this is for: ${hint}\n` : ''}
Return this exact JSON shape:

{
  "meta": {
    "sendingCollege": "community college name, or null",
    "receivingCampus": "university name, or null",
    "major": "major/program name, or null",
    "academicYear": "e.g. 2025-2026, or null",
    "confidence": "high | medium | low"
  },
  "requirements": [
    {
      "receiving": "the university course or requirement, e.g. MATH 21A Calculus",
      "sendingCourses": [
        { "code": "MATH 400", "title": "Calculus I", "units": 5 }
      ],
      "logic": "AND | OR | SINGLE | NONE",
      "articulated": true,
      "notes": "minimum grade or other condition, or null"
    }
  ],
  "unarticulated": ["requirements marked No Course Articulated"],
  "warnings": ["anything ambiguous or unreadable that the student should verify by eye"]
}

Rules:
- "logic" is NONE when articulated is false.
- Set articulated:false and put the requirement text in "unarticulated" when the agreement says no course is articulated.
- If units are not stated, use null. Do not guess.
- Set confidence to "low" if the text looks truncated, scrambled, or is not an articulation agreement at all.
- Include every requirement you find, even ones with no sending equivalent.

AGREEMENT TEXT:
${text}`;
  }

  /* ---------------- parse ---------------- */

  /**
   * @param {string} text  agreement text (pasted or PDF-extracted)
   * @param {object} opts  { hint: 'CRC → UC Davis, Psychology' }
   * @returns {Promise<{ok, agreement?, error?}>}
   */
  async function parse(text, opts = {}) {
    if (!text || text.trim().length < 60) {
      return { ok: false, error: 'That does not look like an agreement. Paste the full requirements section from assist.org, or upload the PDF.' };
    }

    const res = await TT_API.send(
      [{ role: 'user', content: userPrompt(text.slice(0, MAX_CHARS), opts.hint) }],
      { system: SYSTEM, maxTokens: 4000, timeoutMs: 60000 }
    );
    if (!res.ok) return { ok: false, error: res.error };

    const parsed = TT_API.jsonOf(res.data);
    if (!parsed || !Array.isArray(parsed.requirements)) {
      return { ok: false, error: 'Could not read that agreement. Try pasting the requirements section as text instead of the whole page.' };
    }

    parsed.meta = parsed.meta || {};
    parsed.unarticulated = parsed.unarticulated || [];
    parsed.warnings = parsed.warnings || [];
    parsed.importedAt = new Date().toISOString();
    parsed.provenance = {
      source: 'Student-supplied ASSIST agreement',
      note: 'Parsed from a document the student retrieved from assist.org. Not fetched, cached, or scraped by this app.',
      asOf: parsed.importedAt,
      validFor: parsed.meta.academicYear || 'unknown',
    };

    return { ok: true, agreement: parsed };
  }

  /* ---------------- merge into the planner ----------------
     Matches each parsed sending course against the app's catalog so
     the planner can schedule it. Three outcomes per requirement:

       matched     — mapped to a catalog id, planner handles it
       unmatched   — real course, no catalog entry; surfaced as a
                     manual add rather than silently dropped
       unarticulated — cannot be satisfied at this college; this is
                     the highest-value output of the whole feature
  */
  function mergeIntoPlan(agreement, catalog, localOf) {
    const matched = [], unmatched = [], blocked = [];

    const norm = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const index = new Map();
    Object.entries(catalog).forEach(([id, c]) => {
      if (c.ap) return;
      index.set(norm(c.t), id);
      if (c.cid) index.set(norm(c.cid), id);
      const local = localOf ? localOf(id) : null;
      if (local) index.set(norm(local), id);
    });

    agreement.requirements.forEach(req => {
      if (!req.articulated) {
        blocked.push({ receiving: req.receiving, notes: req.notes || null });
        return;
      }
      (req.sendingCourses || []).forEach(sc => {
        const id = index.get(norm(sc.code)) || index.get(norm(sc.title));
        if (id) {
          matched.push({ id, receiving: req.receiving, code: sc.code, title: sc.title, logic: req.logic, notes: req.notes || null });
        } else {
          unmatched.push({ receiving: req.receiving, code: sc.code, title: sc.title, units: sc.units ?? null, logic: req.logic });
        }
      });
    });

    return {
      matched, unmatched, blocked,
      requiredIds: [...new Set(matched.filter(m => m.logic !== 'OR').map(m => m.id))],
      summary: {
        total: agreement.requirements.length,
        articulated: agreement.requirements.filter(r => r.articulated).length,
        blocked: blocked.length,
        matchedToCatalog: matched.length,
        needsManualAdd: unmatched.length,
      },
    };
  }

  /* Warnings in the app's { t, m } shape. */
  function importWarnings(agreement, merge) {
    const w = [];

    if (merge.blocked.length) {
      w.push({ t: 'bad', m: `${merge.blocked.length} requirement${merge.blocked.length === 1 ? '' : 's'} at ${agreement.meta.receivingCampus || 'this campus'} ${merge.blocked.length === 1 ? 'has' : 'have'} no articulated course at your college: ${merge.blocked.map(b => b.receiving).slice(0, 3).join('; ')}${merge.blocked.length > 3 ? '…' : ''}. You will take ${merge.blocked.length === 1 ? 'it' : 'them'} after transfer, or ask your counselor about a substitution.` });
    }
    if (merge.unmatched.length) {
      w.push({ t: 'warn', m: `${merge.unmatched.length} required course${merge.unmatched.length === 1 ? '' : 's'} from your agreement ${merge.unmatched.length === 1 ? 'is' : 'are'} not in this planner's catalog: ${merge.unmatched.map(u => u.code).slice(0, 4).join(', ')}. Add ${merge.unmatched.length === 1 ? 'it' : 'them'} manually so your unit count is right.` });
    }
    if (agreement.meta.confidence === 'low') {
      w.push({ t: 'bad', m: 'This agreement was hard to read, so treat everything imported from it as unconfirmed. Compare against the assist.org page before you register.' });
    }
    (agreement.warnings || []).forEach(x => w.push({ t: 'warn', m: x }));

    if (agreement.meta.academicYear) {
      w.push({ t: 'tip', m: `This agreement is for ${agreement.meta.academicYear}. Agreements are year-specific — use the one matching the year you began continuous enrollment.` });
    } else {
      w.push({ t: 'warn', m: 'No academic year was found in this agreement. Confirm you pulled the year matching your continuous enrollment.' });
    }

    return w;
  }

  return { pdfToText, parse, mergeIntoPlan, importWarnings, loadPdfJs };
})();

if (typeof module !== 'undefined') module.exports = ASSIST_IMPORT;
