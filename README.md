# Fares Dkhili — engineering portfolio

An evidence-led static portfolio built from JSON with vanilla HTML, CSS, ES modules, SVG and Canvas 2D. The visual system uses connected field paths across work, skills and professional history. No framework or runtime package dependency is required.

## Run locally

Requires Node.js 22 or newer.

```sh
npm run build
npm run preview
```

Open `http://127.0.0.1:4173/`. `npm run dev` builds and starts the same server; run the build again after editing source or data, then refresh. The server binds only to the local computer. Stop with Ctrl+C.

If Node is installed through NVM for Windows, activate the required Node 22 version before running commands:

```powershell
nvm use 22
npm.cmd run build
npm.cmd run preview
```

No `npm install` is necessary. Fonts and their licenses are local. Generated output belongs in `dist/`; do not edit it. The root `index.html` only forwards a basic static-file preview to the generated site.

## Content and source

| Location | Purpose |
| --- | --- |
| `data/profile.json` | Public identity, biography, links and languages |
| `data/projects.json` | Archive records, case studies, diagrams, source links and publication state |
| `data/skills.json` | Skills, evidence type, related projects and internships |
| `data/experience.json` | Public internship descriptions |
| `data/education.json` | Exact degree and preparatory cycle |
| `data/certifications.json` | CV-backed credentials and training |
| `data/achievements.json` | Verified achievement records |
| `data/articles.json` | Future technical articles; currently empty |
| `data/categories.json` | Shared discipline definitions |
| `src/pages/` | Homepage, archive and case-study renderers |
| `src/components/` | Shared shell, typographic helpers and SVG diagrams |
| `src/styles/` | Tokens and responsive visual system |
| `src/scripts/` | Progressive enhancement, filtering, skill map and field engine |
| `public/` | Favicon, fonts and reviewed media |
Only reviewed records marked `visibility: "published"` enter the generated site. Unverified completion is represented explicitly rather than inferred from repository names, README claims, code presence or push dates. Draft records and internal review material are excluded from the public build.

The downloadable PDF and printable CV are generated from approved public data. Publish only material explicitly cleared for the site; do not copy private source documents into `public/`.

## Add or update content

1. Add an entry to the appropriate JSON file with a stable, lowercase hyphenated ID.
2. Attach evidence. Skills reference existing project IDs or experience IDs. Distinguish project use, internship, academic practice, training, CV listing, documented exposure and developing skills. No current-learning claims are invented.
3. Prepare projects/articles with `visibility: "draft"`. A draft never appears in output or search.
4. For a project study, add objectives, components, a `diagram.nodes` array and text sections. Optional `diagram.edges` pairs connect nodes by index. These diagrams describe concepts, not certified operation.
5. Add genuine, reviewed images under `public/images/`. Each `media` entry needs `src`, `alt`, `caption`, `width`, `height` and its `source` URL. A caption should establish provenance. Never publish secrets, personal logs or unreviewed credentials in screenshots.
6. Set `visibility: "published"` when the public description is ready. Completion requires `completionEvidence`; the specifically protected projects additionally require `ownerConfirmedComplete`.
7. Run validation, tests and build, then inspect the generated page.

`articles.json` accepts entries with `id`, `title`, `summary`, `visibility` and `sections: [{ title, paragraphs: [...] }]`. A new project or article requires data changes, not renderer edits. This behavior is exercised by a build test using temporary fixtures; fixtures never enter `dist/`.

## Verification

```sh
npm run validate
npm test
npm run build
```

Tests cover publication rules, missing evidence, invalid references/statuses/URLs/images, internal links and anchors, content-only extension, archive query logic, animation lifecycle, touch/reduced-motion/Canvas fallback, text contrast, resource-size budgets and actual HTTP serving at a repository subpath.

For browser inspection, start:

```sh
node scripts/serve.mjs --qa
```

Visit `http://127.0.0.1:4173/__qa__/`. This local-only harness loads actual pages at 360, 390, 768, 1024 and 1440px, checks overflow, font loading, missing images and script errors, and saves results to `.qa/browser-results.json`. It also provides an interactive 360px preview. The harness is not included in the deployed artifact. Manually check keyboard navigation, menu Escape behavior, archive search/reset, category selection, reduced-motion settings and the CV. Automated source checks do not establish visual quality or Core Web Vitals.

## GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and tests on pull requests. Pushes to `main` and manual runs upload only `dist/` and deploy through GitHub Pages. Set the repository's Pages source to **GitHub Actions**.

Before running the workflow, configure the GitHub Actions repository variables `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. They are public client configuration, not service credentials; never put a Supabase service-role key in the workflow or public build. The workflow stops if either variable is missing so it cannot deploy a site with a silently disabled contact form or dashboard. `CONTACT_API_URL` may override the default message-function URL, and `TURNSTILE_SITE_KEY` is optional when server-side rate limiting is configured.

The workflow detects user/organization sites versus project sites and sets `BASE_PATH`. Links and local assets are relative, so the same site works at `/` or `/<repository>/`. To generate canonical URLs, sitemap and robots metadata locally:

```powershell
$env:SITE_URL = 'https://DkhiliFares.github.io'
$env:BASE_PATH = '/engineering-portfolio/'
npm.cmd run build
```

For the `DkhiliFares.github.io` repository itself, use `/` as the base path. Do not use an example hostname as a production canonical URL. The local subpath tests are not a substitute for a successful GitHub Actions deployment.

Research downloads and development fixtures are excluded from deployment.
