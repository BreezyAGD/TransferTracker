# TransferTracker

Students can often wait weeks before meeting with a counselor, which makes
enrolling in the right classes for transfer difficult. TransferTracker uses AI
to give students a personalized roadmap in seconds — something concrete to work
from before, and to bring into, that counselor appointment.

## The problem

Nearly every CCC student who wants to transfer has to reconcile three separate
systems: the Cal-GETC general education pattern, their major's preparation
requirements, and the articulation agreement between their specific college and
their specific target campus. The last one is the hardest to use and the one
that decides whether a course actually counts.

TransferTracker builds a term-by-term plan from all three.

## The data problem, and how this handles it

Articulation agreements live on [ASSIST.org](https://assist.org), the official
repository for California transfer. ASSIST has an API, but access is limited to
institutions; a request for third-party access was declined.

The alternative that most projects reach for is scraping. This one doesn't.
Excessive unauthorized scraping is what degraded ASSIST's performance and
delayed its own public API — for a tool meant to widen transfer access, that
would undercut the premise.

**So the app stores no articulation data at all.** The student retrieves their
own agreement from ASSIST — something they're entitled to do and can finish in
about thirty seconds — and pastes or uploads it. The app parses it and rebuilds
the plan from the real agreement rather than a statewide approximation.

This inverts the staleness problem instead of patching it. There is no cached
articulation to go out of date, because every plan is built from a document
pulled today, for that student's college, campus, major, and catalog year.

## What the import surfaces

The most valuable output is the requirement marked **"No Course Articulated."**

A plan built from generic C-ID descriptors can look complete while silently
omitting a requirement that cannot be satisfied at that student's college at
all. Only the real agreement shows this. The importer extracts it, and the
audit says so plainly: take it after transfer, or ask about a substitution.

The parser is also tuned for AND-vs-OR logic between sending courses, since
collapsing "BIOL 1 AND BIOL 2" into "either one" is the kind of error a student
doesn't discover until a counselor catches it.

## AP credit

AP credit is handled with per-system unit values rather than a single number
per exam, because Cal-GETC certification units, UC award units, and CSU award
units are three different things.

The engine enforces rules a flat table structurally cannot express:

- UC caps Calculus AB and BC combined at 5.3 semester units
- CSU applies only one calculus exam and one computer science exam toward the degree
- CSU caps physics at 6 units toward the degree, 4 toward GE
- Environmental Science and both Physics C exams are worth 3 semester units
  toward Cal-GETC, not 4 — so they don't meet the Area 5 minimum alone
- Exams eligible for two areas (US History → Area 3B *or* 4) are assigned to
  whichever the student still needs — one, never both

Sources: [ICAS Cal-GETC Standards §6.1](https://icas-ca.org/cal-getc-standards/),
CSU systemwide external exam policy, and
[UC AP credits](https://admission.universityofcalifornia.edu/admission-requirements/ap-exam-credits/ap-credits/).

Every record carries a `verified` flag. Where a value is the general Cal-GETC
default rather than a documented exception, the interface says so instead of
implying precision it doesn't have.

## What this is not

It is not an advising system and it does not replace a counselor. Campus
departments decide how AP credit applies to major preparation, agreements
change by year, and impaction shifts by cycle. The app generates the questions
worth bringing to a counselor rather than pretending to answer them.

Verify everything against [assist.org](https://assist.org) before you register.

## Structure

```
public/              static site (Cloudflare Pages)
  index.html         the app
  modules/
    tt-api.js        model transport — proxy, with artifact-sandbox fallback
    ap-credit.js     AP engine: per-system units, cross-exam caps
    assist-import.js agreement ingest: PDF extraction, parse, plan merge
worker/              Cloudflare Worker holding the API key
vercel-alternative/  same proxy for Vercel, if you'd rather host there
docs/DEPLOY.md       deployment guide
```

No build step, no framework, no bundler. The app is a static file.

## Deploying

See [docs/DEPLOY.md](docs/DEPLOY.md). Short version: deploy `worker/` first,
add `ANTHROPIC_API_KEY` as a secret, put the Worker URL into
`public/modules/tt-api.js`, then point Pages at `public/`.

The API key lives only in the Worker's secret store. It is never in this repo
and never reaches the browser.
