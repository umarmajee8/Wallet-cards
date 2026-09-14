# Card Wallet — marketing site

Static files only: no build step, no dependencies, no third-party request at paint. GitHub Pages publishes
the folder as it is.

```
site/
  index.html            the landing page
  privacy.html          privacy
  terms.html            terms
  assets/site.css       every colour in the site comes from the token blocks at the top of this file
  assets/site.js        the theme switch (and one courtesy for the disclosure rows)
  assets/favicon.svg
  assets/og.png         1200x630, generated - see tools/make_og.py
  assets/screens/       drop real screenshots here (see its README)
  tools/check_site.py    structural gate: parse, links, h1, no off-site loads, no rogue colours
  tools/contrast.py      colour gate: every text surface, measured through the glass
  robots.txt  sitemap.xml  .nojekyll
```

## Preview / publish

    python3 -m http.server 8080 --directory site      # then http://127.0.0.1:8080/

Publish: Settings -> Pages -> Source "Deploy from a branch", branch `main`, folder `/site`. The site then
serves from `https://umarmajee8.github.io/Wallet-cards/`. `.nojekyll` stops Jekyll touching the files. With a
custom domain later, update `<link rel="canonical">`, the `og:url` / `og:image` / `twitter` lines in each head,
and `sitemap.xml` — those are absolute on purpose.

## The two scripts are gates, not notes

    $ python3 tools/check_site.py && python3 tools/contrast.py
    all structural checks passed (run tools/contrast.py too - that is the colour gate)
    worst ratio in the table: 6.60:1 (WCAG 2.2 AA wants 4.5:1 for body text, 3:1 for large text)

`contrast.py` composites each text surface's alpha over **every stop of the page gradient** and reports the
worst ratio, because text over a translucent layer is only as readable as its worst pixel. Latest run:

| | body text on a card | secondary text | nav on the blurred bar | button label | worst in the table |
|---|---|---|---|---|---|
| light | 18.37:1 | 8.45:1 | 8.23:1 | 18.86:1 | 6.60:1 |
| dark | 14.42:1 | 6.97:1 | 7.17:1 | 18.86:1 | 6.97:1 |

`make_og.py` writes the social card from the same tokens, so the two cannot drift apart.

## Editing

- **Copy** lives in the HTML. **Colour**: change `--ink`, `--solid`, `--danger`, `--card` in the `:root` /
  `html.dark` blocks and nothing else needs touching; components never hard-code a colour. Want a brand
  accent instead of near-black? Set `--solid` and `--on-solid`, then re-run both tools.
- **Screenshots**: see `assets/screens/README.md`. They are the only images that belong here — the placeholder
  frames are deliberate, not leftovers.

## Deliberate choices

- **No blur behind copy.** Blur appears on the sticky bar and the download panel only; every paragraph sits on
  a near-opaque tinted card. That is the app's own rule (`repo_export/patches/liquid_glass_audit.py` enforces
  the equivalent there), and it is why the contrast numbers above hold.
- **Light is the default**, the system setting is respected until the visitor clicks, then remembered in
  `localStorage` under `cw-site-theme`. With JavaScript off the page is fully readable in light; only the
  switch does nothing.
- **No fonts, no icon set, no framework.** A system stack and shapes drawn in CSS. That is what keeps the
  first paint honest on a mid-range Android phone.
- **Honesty over polish.** The limits — the code locks the app rather than encrypting the stored cards, a lost
  backup password is unrecoverable, a forgotten code means Reset — are stated on the page instead of buried,
  because that is the actual product policy and, for an ID wallet, it is also the pitch.

## Not verified in this repo — do these before a store launch

1. **Lighthouse / PageSpeed** on the deployed URL: no browser exists in the sandbox this was written in, so
   the performance score is unmeasured, not assumed.
2. **axe and a screen-reader pass**: semantics and focus order were written to spec but not audited by a tool here.
3. **Real screenshots** and a designed `og.png` (keep 1200x630, re-check the `og:image` URL).
4. Fill the open facts: `minSdkVersion` for the "Which Android versions" answer, the Play Store URL when the
   listing exists, and a contact address if the issue tracker is not enough.
5. **These are engineering drafts, not legal advice.** Have the owner review Privacy and Terms, and confirm
   what the repository's licence actually permits before the site implies anything about it.
6. After deploy, paste the URL into a chat app once to see the real link preview: that is the only way to
   confirm `og:image` by an actual fetch instead of by reading markup.
