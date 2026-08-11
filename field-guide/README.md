# The Hacktivity Field Guide — static site

A HackTricks-style, field-guide web security wiki built from **5,762 disclosed HackerOne reports**.
Each vulnerability class is explained independently (methodology → contexts → payloads → bypasses),
then every disclosed report is catalogued as a **specimen** (real-world example) with its method and
a matching **PortSwigger Web Security Academy** lab.

Pure static HTML/CSS/JS — no build step, no server-side code. Deploys as-is to GitHub Pages.

## Structure

```
index.html                     home + taxonomy census
vulnerabilities/<class>.html   36 vuln-class pages (body + all specimens)
attack-surface/<class>.html    11 attack-surface pages (graphql, oauth, jwt, saml, cors,
                               subdomain-takeover, account-takeover, file-upload, cloud-aws,
                               webhooks, mobile)
methodology/*.html             recon · choosing-targets · triage-and-impact · reporting
chains.html                    multi-bug escalation patterns
payloads.html                  payload-library index
assets/style.css               design system (light/dark, themed)
assets/app.js                  theme persistence, search, mobile nav, copy, sort, pagination
assets/search-index.json       global search index (5,762 specimens + 44 class pages)
.nojekyll                       tell GitHub Pages to serve files as-is
```

## Deploy to GitHub Pages

1. Create a repo and copy the **contents of this folder** into it (or into a `/docs` folder).
2. Commit and push.
3. Repo **Settings → Pages** → Source: *Deploy from a branch* → pick your branch and either
   **/ (root)** or **/docs**, matching where you put the files.
4. Your site publishes at `https://<user>.github.io/<repo>/`.

The site uses **relative paths** throughout and ships a `.nojekyll` file, so it works under a
project sub-path (`/<repo>/`) without configuration. Search fetches `assets/search-index.json` at
runtime, which works over HTTP (GitHub Pages) — for a **local preview** run a static server from this
folder (`python3 -m http.server`) rather than opening files via `file://` (browsers block `fetch`
from `file://`).

## Features

- **Light / dark** theme (field-guide paper vs. cover-charcoal), toggle persists across pages.
- **Client-side search** over all specimens, techniques, programs, and report IDs (`/` to focus).
- **Specimen cards** — every report with severity field-mark, method, real payload, HackerOne source,
  and a per-technique PortSwigger lab link; deep-linkable (`#report-<id>`), sortable, paginated.
- **Copy** buttons on every code block; mobile navigation; themed scrollbars.

## Provenance & ethics

Built from disclosed, public bug-bounty data for **defensive and educational** security research.
Every specimen cites `hackerone.com/reports/<id>`. Payloads use placeholders (`TARGET`, `COLLAB`,
`VICTIM`) — test only systems you are authorized to test.

_Companion long-form playbook (markdown) and Claude Code skills live alongside this site under
`../Playbook/` and `~/.claude/skills/hacktivity/`._
