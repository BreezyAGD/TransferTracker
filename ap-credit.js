/* =========================================================
   TransferTracker — AP credit engine
   ---------------------------------------------------------
   Replaces the flat AP_EXAMS table, which had three structural
   problems:

     1. One unit value per exam. Cal-GETC certification units, UC
        award units, and CSU award units are three different numbers.
     2. One area per exam. Several exams are eligible for either of
        two Cal-GETC areas — but only one, never both.
     3. No cross-exam rules. Calculus AB+BC, multiple physics exams,
        and multiple calculus/CS exams all have caps that a per-exam
        table structurally cannot express.

   SOURCES (all public, all citable in the submission):
     ICAS  — Cal-GETC Standards §6.1, AP/IB chart
             https://icas-ca.org/cal-getc-standards/
     CSU   — Systemwide Credit for External Examinations
             https://calstate.policystat.com/
     UC    — AP credits
             https://admission.universityofcalifornia.edu/admission-requirements/ap-exam-credits/ap-credits/

   Every record carries `verified`. Where a value came directly from
   one of the three sources above it is true. Where it is the general
   Cal-GETC default (3 semester units, one area) applied because the
   exam has no documented exception, it is false — and the UI says so.
   ========================================================= */

const AP_SOURCE = {
  calGetc: { name: 'ICAS Cal-GETC Standards §6.1', url: 'https://icas-ca.org/cal-getc-standards/', asOf: '2025-08-01', validFor: '2025-26' },
  csu:     { name: 'CSU Systemwide Credit for External Examinations', url: 'https://calstate.policystat.com/', asOf: '2025-08-01', validFor: '2025-26' },
  uc:      { name: 'UC AP Credits', url: 'https://admission.universityofcalifornia.edu/admission-requirements/ap-exam-credits/ap-credits/', asOf: '2025-08-01', validFor: '2025-26' },
};

/* Minimum score for any credit. Below this the score is stored but ignored. */
const AP_MIN_SCORE = 3;

/* Cal-GETC default when an exam has no documented exception:
   an acceptable score equates to 3 semester units, applied to ONE area. */
const CALGETC_DEFAULT_UNITS = 3;

/*
  Record shape:
    t              display title
    areas          eligible Cal-GETC areas, in preference order.
                   MORE THAN ONE MEANS "either, not both."
    calGetc        semester units toward Cal-GETC certification
    lab            satisfies the Area 5 lab requirement
    group          cross-exam constraint group (see AP_CAPS)
    clears         C-ID ids this exam commonly clears as a prerequisite
    verified       true only where a source states the value explicitly
    note           what the student must confirm with a counselor
*/
const AP_EXAMS = {

  /* ---- Area 2: Math & Quantitative Reasoning ---- */
  calcab: {
    t: 'Calculus AB', areas: ['2'], calGetc: 3, group: 'calc',
    clears: ['MATH210'], verified: true,
    note: 'Commonly places you into Calculus II. Whether it clears the Calculus I major-prep requirement is decided by the department, not the GE pattern.',
  },
  calcbc: {
    t: 'Calculus BC', areas: ['2'], calGetc: 3, group: 'calc',
    clears: ['MATH210', 'MATH220'], verified: true,
    note: 'A BC subscore of 3+ on the AB portion earns AB credit even if the BC score is below 3. UC caps AB and BC combined at 5.3 semester units. Engineering departments often still want the courses on a transcript.',
  },
  stats: {
    t: 'Statistics', areas: ['2'], calGetc: 3,
    clears: ['MATH110'], verified: true,
    note: 'Usually satisfies a statistics GE requirement. Majors that require a specific statistics course may not accept it.',
  },

  /* ---- Area 1: English Communication ---- */
  englang: {
    t: 'English Language & Composition', areas: ['1A'], calGetc: 3, group: 'english',
    clears: ['ENGL100'], verified: true,
    note: 'For UC transfer admission, only one of the two required English courses may be satisfied by an AP exam.',
  },
  englit: {
    t: 'English Literature & Composition', areas: ['1A', '3B'], calGetc: 3, group: 'english',
    clears: ['ENGL100'], verified: true,
    note: 'Eligible for Area 1A or 3B — one or the other, never both. For UC transfer admission, only one of the two required English courses may be satisfied by an AP exam.',
  },

  /* ---- Area 5: Physical & Biological Sciences ----
     The 4-vs-3 unit split here is the fix that matters most: an exam
     worth 3 units cannot on its own meet Area 5's unit minimum. */
  bio: {
    t: 'Biology', areas: ['5B'], calGetc: 4, lab: true, verified: true,
    clears: [],
    note: 'Satisfies a biological science area with lab. Biology majors are almost always required to take the majors sequence anyway.',
  },
  chem: {
    t: 'Chemistry', areas: ['5A'], calGetc: 4, lab: true, verified: true,
    clears: [],
    note: 'Satisfies a physical science area with lab. Chemistry, biology, and engineering majors normally still take General Chemistry.',
  },
  phys1: {
    t: 'Physics 1: Algebra-Based', areas: ['5A'], calGetc: 4, lab: true, group: 'physics', verified: true,
    clears: [],
    note: 'Engineering and physical science majors need calculus-based physics; this rarely substitutes for it.',
  },
  phys2: {
    t: 'Physics 2: Algebra-Based', areas: ['5A'], calGetc: 4, lab: true, group: 'physics', verified: true,
    clears: [],
    note: 'Engineering and physical science majors need calculus-based physics; this rarely substitutes for it.',
  },
  physcmech: {
    t: 'Physics C: Mechanics', areas: ['5A'], calGetc: 3, lab: false, group: 'physics', verified: true,
    clears: [],
    note: 'Worth only 3 semester units toward Cal-GETC, so it does not by itself meet the Area 5 unit minimum — you will still need additional science units.',
  },
  physcem: {
    t: 'Physics C: Electricity & Magnetism', areas: ['5A'], calGetc: 3, lab: false, group: 'physics', verified: true,
    clears: [],
    note: 'Worth only 3 semester units toward Cal-GETC, so it does not by itself meet the Area 5 unit minimum — you will still need additional science units.',
  },
  envsci: {
    t: 'Environmental Science', areas: ['5A'], calGetc: 3, lab: false, verified: true,
    clears: [],
    note: 'Worth only 3 semester units toward Cal-GETC, so it does not by itself meet the Area 5 unit minimum. CSU awards 4 units toward the degree.',
  },

  /* ---- Area 4: Social & Behavioral Sciences ---- */
  psych:     { t: 'Psychology',                areas: ['4'],       calGetc: 3, disc: 'PSYC', clears: ['PSY110'], verified: false,
               note: 'Clears a GE area, but psychology majors are normally still required to take General Psychology for the major.' },
  ushist:    { t: 'United States History',     areas: ['3B', '4'], calGetc: 3, disc: 'HIST', clears: [], verified: true,
               note: 'Eligible for Area 3B or Area 4 — one or the other, never both.' },
  worldhist: { t: 'World History: Modern',     areas: ['3B', '4'], calGetc: 3, disc: 'HIST', clears: [], verified: true,
               note: 'Eligible for Area 3B or Area 4 — one or the other, never both.' },
  eurohist:  { t: 'European History',          areas: ['3B', '4'], calGetc: 3, disc: 'HIST', clears: [], verified: true,
               note: 'Eligible for Area 3B or Area 4 — one or the other, never both.' },
  usgov:     { t: 'US Government & Politics',  areas: ['4'],       calGetc: 3, disc: 'POLS', clears: [], verified: true,
               note: 'Does not satisfy the California state and local government requirement at UC.' },
  compgov:   { t: 'Comparative Government',    areas: ['4'],       calGetc: 3, disc: 'POLS', clears: [], verified: false, note: '' },
  macro:     { t: 'Macroeconomics',            areas: ['4'],       calGetc: 3, disc: 'ECON', clears: ['ECON202'], verified: false,
               note: 'Macro and micro are the same discipline, so two economics exams cannot satisfy Area 4 on their own — that area needs two different disciplines.' },
  micro:     { t: 'Microeconomics',            areas: ['4'],       calGetc: 3, disc: 'ECON', clears: ['ECON201'], verified: false,
               note: 'Macro and micro are the same discipline, so two economics exams cannot satisfy Area 4 on their own — that area needs two different disciplines.' },
  humgeo:    { t: 'Human Geography',           areas: ['4'],       calGetc: 3, disc: 'GEOG', clears: [], verified: false, note: '' },

  /* ---- Area 3: Arts & Humanities ---- */
  arthist:   { t: 'Art History',               areas: ['3A', '3B'], calGetc: 3, clears: [], verified: false,
               note: 'Eligible for Area 3A or 3B — one or the other, never both.' },
  art2d:     { t: 'Art & Design: 2-D',         areas: ['3A'], calGetc: 3, group: 'art', clears: [], verified: true,
               note: 'UC caps all three Art & Design exams combined at 5.3 semester units.' },
  art3d:     { t: 'Art & Design: 3-D',         areas: ['3A'], calGetc: 3, group: 'art', clears: [], verified: true,
               note: 'UC caps all three Art & Design exams combined at 5.3 semester units.' },
  artdraw:   { t: 'Art & Design: Drawing',     areas: ['3A'], calGetc: 3, group: 'art', clears: [], verified: true,
               note: 'UC caps all three Art & Design exams combined at 5.3 semester units.' },
  musictheory: { t: 'Music Theory',            areas: ['3A'], calGetc: 3, clears: [], verified: true,
               note: 'UC grants credit only for the full exam. A subscore alone earns nothing.' },

  /* ---- Languages other than English → Area 3B ---- */
  spanlang:  { t: 'Spanish Language & Culture',   areas: ['3B'], calGetc: 3, clears: [], verified: false, note: '' },
  spanlit:   { t: 'Spanish Literature & Culture', areas: ['3B'], calGetc: 3, clears: [], verified: false, note: '' },
  frenchlang:{ t: 'French Language & Culture',    areas: ['3B'], calGetc: 3, clears: [], verified: false, note: '' },
  germanlang:{ t: 'German Language & Culture',    areas: ['3B'], calGetc: 3, clears: [], verified: false, note: '' },
  italianlang:{t: 'Italian Language & Culture',   areas: ['3B'], calGetc: 3, clears: [], verified: false, note: '' },
  chineselang:{t: 'Chinese Language & Culture',   areas: ['3B'], calGetc: 3, clears: [], verified: false, note: '' },
  japaneselang:{t:'Japanese Language & Culture',  areas: ['3B'], calGetc: 3, clears: [], verified: false, note: '' },
  latin:     { t: 'Latin',                        areas: ['3B'], calGetc: 3, clears: [], verified: false, note: '' },

  /* ---- No standard GE area: elective units only ---- */
  csa:       { t: 'Computer Science A',         areas: [], calGetc: 0, group: 'cs', clears: ['COMP122'], verified: true,
               note: 'Earns elective units, not GE credit. CS departments frequently require their own intro sequence regardless of the exam.' },
  csp:       { t: 'Computer Science Principles',areas: [], calGetc: 0, group: 'cs', clears: [], verified: true,
               note: 'Earns elective units, not GE credit.' },
};

/*
  Cross-exam caps — the rules a per-exam table cannot express.
  Each returns a correction applied AFTER per-exam credit is summed.
*/
const AP_CAPS = [
  {
    id: 'uc-calc',
    group: 'calc',
    system: 'UC',
    maxSemesterUnits: 5.3,
    message: 'UC caps Calculus AB and BC combined at 5.3 semester units.',
    source: AP_SOURCE.uc,
  },
  {
    id: 'csu-calc-cs',
    groups: ['calc', 'cs'],
    system: 'CSU',
    maxExamsPerGroup: 1,
    message: 'CSU applies only one calculus exam and one computer science exam toward the baccalaureate.',
    source: AP_SOURCE.csu,
  },
  {
    id: 'csu-physics',
    group: 'physics',
    system: 'CSU',
    maxSemesterUnits: 6,
    maxGeUnits: 4,
    message: 'CSU applies at most 6 units of physics toward the degree and 4 toward general education.',
    source: AP_SOURCE.csu,
  },
  {
    id: 'uc-art',
    group: 'art',
    system: 'UC',
    maxSemesterUnits: 5.3,
    message: 'UC caps all three Art & Design exams combined at 5.3 semester units.',
    source: AP_SOURCE.uc,
  },
  {
    id: 'uc-english',
    group: 'english',
    system: 'UC',
    maxSemesterUnits: 5.3,
    maxAdmissionSubject: 1,
    message: 'UC caps both English exams combined at 5.3 semester units, and only one of the two required English courses for transfer admission may be satisfied by an exam.',
    source: AP_SOURCE.uc,
  },
];

/* ---------------------------------------------------------
   Area assignment
   Exams eligible for two areas get assigned to whichever the
   student still needs. Greedy is correct here: the eligible
   sets are small and never conflict in practice.
   --------------------------------------------------------- */
function assignAreas(scores, unmetAreas) {
  const need = new Set(unmetAreas || []);
  const assignment = {};
  const ids = Object.keys(scores).filter(id => AP_EXAMS[id] && scores[id] >= AP_MIN_SCORE);

  // Single-area exams first — they have no choice to make.
  ids.filter(id => AP_EXAMS[id].areas.length === 1).forEach(id => {
    const a = AP_EXAMS[id].areas[0];
    assignment[id] = a;
    need.delete(a);
  });

  // Multi-area exams take an area the student still needs, else the first.
  ids.filter(id => AP_EXAMS[id].areas.length > 1).forEach(id => {
    const pick = AP_EXAMS[id].areas.find(a => need.has(a)) || AP_EXAMS[id].areas[0];
    assignment[id] = pick;
    need.delete(pick);
  });

  return assignment;
}

/* ---------------------------------------------------------
   Main entry point.
   @param scores      { calcab: 5, englang: 4, ... }
   @param opts        { unmetAreas: ['3A','4'], systems: ['UC','CSU'] }
   @returns credit summary + the caps that actually bit
   --------------------------------------------------------- */
function apCredit(scores, opts = {}) {
  const systems = opts.systems || ['UC', 'CSU'];
  const assignment = assignAreas(scores, opts.unmetAreas);

  const awarded = [];
  const ignored = [];
  const applied = [];      // caps that changed the result
  const unverified = [];

  Object.keys(scores).forEach(id => {
    const ex = AP_EXAMS[id];
    if (!ex) return;
    const score = scores[id];
    if (score < AP_MIN_SCORE) {
      ignored.push({ id, t: ex.t, score, reason: `A score of ${score} does not earn credit. ${AP_MIN_SCORE} is the minimum.` });
      return;
    }
    awarded.push({
      id, t: ex.t, score,
      area: assignment[id] || null,
      units: ex.calGetc,
      lab: !!ex.lab,
      disc: ex.disc || null,
      clears: ex.clears || [],
      verified: ex.verified,
      note: ex.note || '',
    });
    if (!ex.verified) unverified.push(ex.t);
  });

  // ---- apply cross-exam caps ----
  const byGroup = {};
  awarded.forEach(a => {
    const g = AP_EXAMS[a.id].group;
    if (!g) return;
    (byGroup[g] = byGroup[g] || []).push(a);
  });

  AP_CAPS.forEach(cap => {
    if (!systems.includes(cap.system)) return;
    const groups = cap.groups || [cap.group];

    groups.forEach(g => {
      const members = byGroup[g] || [];
      if (members.length < 2) return;

      if (cap.maxExamsPerGroup) {
        // Keep the highest-scoring exam; the rest stop counting for units.
        const sorted = [...members].sort((a, b) => b.score - a.score || b.units - a.units);
        sorted.slice(cap.maxExamsPerGroup).forEach(m => { m.cappedBy = cap.id; m.units = 0; });
        applied.push({ ...cap, affected: sorted.slice(cap.maxExamsPerGroup).map(m => m.t) });
        return;
      }

      if (cap.maxSemesterUnits) {
        const total = members.reduce((s, m) => s + m.units, 0);
        if (total > cap.maxSemesterUnits) {
          // Trim from the lowest-scoring exam upward.
          let excess = total - cap.maxSemesterUnits;
          const sorted = [...members].sort((a, b) => a.score - b.score || a.units - b.units);
          sorted.forEach(m => {
            if (excess <= 0) return;
            const cut = Math.min(m.units, excess);
            m.units = +(m.units - cut).toFixed(2);
            excess -= cut;
            m.cappedBy = cap.id;
          });
          applied.push({ ...cap, affected: members.filter(m => m.cappedBy === cap.id).map(m => m.t) });
        }
      }
    });
  });

  const totalUnits = +awarded.reduce((s, a) => s + a.units, 0).toFixed(1);
  const areasCleared = [...new Set(awarded.filter(a => a.area && a.units > 0).map(a => a.area))];
  const labSatisfied = awarded.some(a => a.lab && a.units > 0);
  const clears = [...new Set(awarded.flatMap(a => a.clears))];

  return {
    awarded, ignored, applied, unverified,
    totalUnits, areasCleared, labSatisfied, clears,
    source: AP_SOURCE,
    gpaImpact: false,   // AP credit never affects GPA
  };
}

/* Warnings for the audit panel. Returns the app's { t, m } shape. */
function apWarnings(credit, plannedCourseIds = []) {
  const w = [];

  credit.applied.forEach(cap => {
    w.push({ t: 'warn', m: `${cap.message} This reduced the credit counted for ${cap.affected.join(' and ')}.` });
  });

  credit.ignored.forEach(x => {
    w.push({ t: 'tip', m: `${x.t} (score ${x.score}) is on file but earns no credit. ${x.reason}` });
  });

  // Exam clears a course still sitting in the plan.
  credit.awarded.forEach(a => {
    const overlap = a.clears.filter(c => plannedCourseIds.includes(c));
    if (overlap.length) {
      w.push({ t: 'tip', m: `${a.t} (score ${a.score}) may already cover a course still in your plan. Clearing a GE area and clearing major prep are different decisions — confirm with your counselor before dropping it.` });
    }
  });

  // The Area 5 unit trap.
  const thin = credit.awarded.filter(a => ['5A', '5B'].includes(a.area) && a.units > 0 && a.units < 4);
  if (thin.length) {
    w.push({ t: 'warn', m: `${thin.map(a => a.t).join(' and ')} ${thin.length === 1 ? 'is' : 'are'} worth 3 semester units toward Cal-GETC, below the Area 5 minimum. You will still need additional science units.` });
  }

  if (credit.unverified.length) {
    w.push({ t: 'tip', m: `Unit values for ${credit.unverified.slice(0, 3).join(', ')}${credit.unverified.length > 3 ? ` and ${credit.unverified.length - 3} more` : ''} use the general Cal-GETC default rather than a documented exception. Confirm on your college's AP chart.` });
  }

  return w;
}

if (typeof module !== 'undefined') module.exports = { AP_EXAMS, AP_CAPS, AP_SOURCE, AP_MIN_SCORE, apCredit, apWarnings, assignAreas };
