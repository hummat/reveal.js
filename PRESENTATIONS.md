# Presentation Authoring Gotchas

This file documents non-obvious bugs and fixes encountered while building
slide decks on top of this reveal.js fork. It is **not** upstream reveal.js
documentation — it captures lessons from building real presentations that use
responsive third-party widgets (Plotly, D3, KaTeX, Mermaid, …) and export to
PDF via `?print-pdf`.

Keep adding to this file whenever a new gotcha bites you. Check it before
debugging any print-pdf rendering issue — the bug you're about to chase may
already have a fix here.

## 1. Plotly charts render at stale width in `?print-pdf`

**Symptom.** Plotly charts (or any responsive chart library) appear visibly
narrower in the exported PDF than they do in normal browser viewing. The
container div is correctly sized, but the inner `.main-svg` has a smaller
`width=` attribute than the container — e.g. 900px drawn inside a 940px div,
leaving 40px of whitespace.

**Root cause.** Plotly's `responsive: true` only installs a `window.resize`
listener. Reveal.js's `?print-pdf` mode does not fire `window.resize` when it
switches to print layout — it clones each slide into a `.pdf-page` wrapper,
recomputes positions, and fires its own `pdf-ready` event instead. Plotly
never re-measures, so whatever container width existed at its initial
autosize moment gets baked into the SVG `width=` attribute permanently.

**The fix** (in the deck's `index.html`, after loading Plotly and Reveal but
before `Reveal.initialize()`):

```html
<script>
  const schedulePlotlyResize = () => {
    if (!window.Plotly) return;
    const resize = () => {
      document.querySelectorAll(".js-plotly-plot").forEach((plot) => {
        const rect = plot.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        Plotly.Plots.resize(plot);
      });
    };
    // Double rAF: first for layout, second for style recalc.
    requestAnimationFrame(() => requestAnimationFrame(resize));
  };

  Reveal.on("ready", schedulePlotlyResize);
  Reveal.on("resize", schedulePlotlyResize);
  Reveal.on("slidechanged", schedulePlotlyResize);
  Reveal.on("pdf-ready", schedulePlotlyResize);
</script>
```

If charts are loaded asynchronously via jQuery `$.load()` or similar, also
call `schedulePlotlyResize` once all includes have finished loading:

```js
$(function () {
  const includes = $("[data-include]");
  let pending = includes.length;
  const markLoaded = () => {
    pending -= 1;
    if (pending === 0) schedulePlotlyResize();
  };
  includes.each(function () {
    $(this).load("assets/figures/" + $(this).data("include") + ".html", markLoaded);
  });
});
```

**Why the double `requestAnimationFrame`.** The first rAF waits for the
current layout pass to complete; the second runs after the style recalc, so
`getBoundingClientRect()` returns post-transform dimensions. This is the
canonical "wait for layout to settle" idiom.

**Generalises to.** Any responsive widget with an explicit resize API:
Chart.js (`chart.resize()`), D3 (re-render with new width), Mermaid
(`mermaid.init`), ECharts (`chart.resize()`). The pattern is always the same:
hook `Reveal.on('pdf-ready', …)` and force the widget to re-measure. Plotly's
`responsive: true` is just incomplete — it doesn't use a `ResizeObserver`.

## 2. Thin CSS backgrounds disappear in Chromium `?print-pdf`

**Symptom.** Arrows, dividers, or any `<div>` with `background-color` and
height ≤ 5 px render correctly in the browser but vanish (or render as faint
ghosts) in the exported PDF. The arrowhead — typically a CSS triangle using
`border-left` — survives; only the stem disappears.

**Root cause.** Chromium's print-to-pdf rasterizer drops
`background-color` on block elements with very small (≤ 5 px) height inside
reveal.js's print-pdf DOM stacking context. Standalone HTML pages render the
same CSS correctly; the bug is specific to the interaction between
`?print-pdf`'s containment hierarchy and Chromium's rasterization pipeline.
Borders are unaffected because they paint through the vector path rather than
background rasterization.

**The fix.** Use `border-top` (or `border-bottom`) on a zero-height div
instead of `background-color` on a thin div. Let colours cascade via
`currentColor` from a parent, so both the stem and the arrowhead share a
single source of truth:

```css
.arrow {
  display: flex;
  align-items: center;
  width: 120px;
  color: var(--text-3); /* default colour */
}

.arrow .line {
  width: 88px;
  height: 0;
  border-top: 5px solid currentColor;
}

.arrow .point {
  width: 0;
  height: 0;
  border-top: 12px solid transparent;
  border-bottom: 12px solid transparent;
  border-left: 20px solid currentColor;
}
```

```html
<!-- Override colour per-arrow on the parent, not the children: -->
<div class="arrow" style="color: #3a86ff">
  <div class="line"></div>
  <div class="point"></div>
</div>
```

**Generalises to.** Any thin decorative element you'd normally build with
`background-color` — separators, progress indicators, timeline markers. If
it's ≤ 5 px in its thin dimension and needs to survive print-pdf, use a
border instead.

## 3. Plotly SVG content clipped at the plot edge in print

**Symptom.** Plotly annotation text (e.g. `add_hline(annotation_text=...)`)
or data-point labels positioned with `textposition="middle right"` get cut
off in the exported PDF, even when they render fine in the browser.

**Root cause.** Plotly emits SVG with `overflow: hidden` on `.main-svg` and
its inner groups, so anything positioned just past the plot rect gets
clipped. In interactive browser mode this is usually fine because the
clipping area is generous; in print-pdf the bounds seem tighter and labels
that sit "close to the edge" get sheared.

**The fix.** Two layers — apply both, they're cheap:

1. **CSS** (in the deck's custom stylesheet):

    ```css
    .js-plotly-plot,
    .js-plotly-plot .main-svg,
    .js-plotly-plot .main-svg > g {
      overflow: visible !important;
    }
    ```

2. **Data layer**: if a label is near a data edge (e.g. the last point in a
   line trace), switch its `textposition` away from `"middle right"` to
   `"top center"` so it stays inside the plot canvas regardless of SVG
   clipping. In Plotly you can pass a *list* of positions, one per point,
   and mix them — use `"middle right"` only for points with room to spare.

## 4. `?print-pdf` is ~5 % larger than normal viewing — this is expected

**Observation.** When comparing the browser view (at `#/15/0/3`) to the
exported PDF side-by-side, everything in the PDF looks ~5 % larger than the
browser version. Plots, headings, bullets — all uniformly larger.

**Not a bug.** Reveal.js's `margin: 0.05` config applies a `transform:
scale(0.95)` to `.slides` in normal viewing, giving the slide visual
breathing room inside the viewport. In `?print-pdf` mode that transform is
`none`: instead, reveal.js makes the `.pdf-page` wrapper 1.05× the slide
size, reserving the same 5 % as physical page margins. Slide *content*
inside the PDF page is therefore at native 1:1 scale, not 0.95.

The proportions within the slide are identical in both modes. The only
difference is absolute scale at an equal display size. If you want the two to
look visually identical at the same physical size, set `margin: 0` in
`Reveal.initialize()` — but you'll lose the browser breathing room.

**If you think plots are "wider" in PDF, verify before fixing.** Rasterize
a PDF page at matched width to a browser screenshot and do a
`numpy.any(a != b, axis=2)` pixel diff. Colour-based bar measurements can lie
because label text sits at a similar offset even when the underlying chart
geometry moves.

## Render checklist

Before declaring a print-pdf export "correct", verify these in a freshly
rendered PDF:

- [ ] All Plotly charts have `main-svg` `width=` matching their container
      width (inspect via DevTools in `?print-pdf` mode)
- [ ] All arrows / thin dividers have visible stems (not just arrowheads)
- [ ] Chart annotations and external-position labels are not clipped
- [ ] Slide content layout matches normal viewing mode proportionally
      (whole-image pixel diff, not colour-filter measurement)
- [ ] Fragments are either flattened (`pdfSeparateFragments: false`) or each
      fragment state produces its own page, depending on intent

## Render recipes

Render the deck to PDF via Puppeteer (more reproducible than Chrome's UI
print dialog):

```bash
npm run export-pdf -- \
  --root ../3dv-2026-presentation \
  --input index.html \
  --output /tmp/3dv-2026-presentation.pdf
```

For decks with async charts, figures, includes, or custom widgets, expose a
readiness promise before `Reveal.initialize()`:

```js
window.deckReadyForPdf = new Promise((resolve, reject) => {
  // Resolve only after async includes have loaded and responsive widgets have
  // non-zero layout in print-pdf mode. Reject on timeout or load failure.
});
```

The exporter waits for `Reveal.isReady()` and then waits for
`window.deckReadyForPdf` when it exists. If the promise is absent, it exports
after reveal.js reports ready. Use `--wait <ms>` only as a last-resort buffer;
fixed sleeps are brittle and should not be the primary synchronization
mechanism.

The `?print-pdf` query string is what triggers reveal.js's print-mode DOM
restructuring. Without it you get the interactive layout rendered once.
