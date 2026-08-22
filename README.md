# Radial Lollipop

A Qlik Sense visualization extension that fans your items around a large arc.

Items are laid out as contiguous angular blocks — one block per group — sitting on a thin
donut ring band coloured by group. Every item is a lollipop: a thin radial stick pointing
outward from the ring with a small dot at its tip. The few highest ranked items are drawn
**inward** instead, as long sticks reaching toward the centre with large bubbles and value
labels, so the headline numbers read at a glance. A small group legend sits bottom-right.

Inspired by the "Cumulative Carbon Clock" radial ranking design.

## Data requirements

| Slot | Role | Required |
| --- | --- | --- |
| Dimension 1 | Item — one lollipop per value, click to select | Yes |
| Dimension 2 | Group / category — drives the ring segments and colors | No |
| Measure 1 | Outward stick length | Yes |
| Measure 2 | Inward stick + bubble (dual mode) / bubble size (top-N mode) | No |
| Measure 3 | Bubble size (dual mode only) | No |

With a single dimension, all items form one group named after Measure 1.

## Modes

**Top-N Highlight** — every item is a lollipop pointing outward from the ring, with a dot
at its tip sized by Measure 2. The few highest ranked items are drawn *inward* instead,
as long sticks reaching toward the centre with large bubbles and value labels.
Without Measure 2 the dots are a fixed size and the ranking falls back to Measure 1.

**Dual Measure (Carbon Clock)** — reproduces the reference design's three-way encoding:

- a bare outward spike per item, length = Measure 1;
- an inward stick toward the centre ending in a bubble, length = Measure 2;
- bubble size = Measure 3 (or Measure 2 when there is no third measure).

Only the largest few items (see `Label Top N`) get a value label, in a neutral text color;
labels that would collide with an already-placed one are dropped.

`Mode` is `Auto` by default: dual as soon as a second measure is present, top-N otherwise.
Requesting dual with only one measure falls back to top-N.

Rows whose Measure 1 is null / NaN / `-` are skipped; negative values clamp to zero.
The hypercube fetches up to 10 x 1000 cells.

## Properties

**Appearance**

- `Mode` — `Auto` (default), `Top-N Highlight`, or `Dual Measure (Carbon Clock)`.
- `Arc Sweep` — `Full circle` (360°, minus a small seam gap so the first and last items do
  not overlap), `Half circle` (`-90`..`90`), or `Custom` (default).
- `Start Angle` / `End Angle` — arc span in degrees, `-180..180`, where 0 is 12 o'clock and
  angles increase clockwise. Defaults `-135` / `135`. Shown and used only when
  `Arc Sweep` is `Custom`.
- `Rotation (deg)` — spins the whole layout, `-180`..`180`, and applies to the presets
  too. This is angle math, not an SVG transform, so labels, the stamp and the legend
  stay upright. It also lets you express a sweep whose gap crosses the ±180 seam, which
  `Start`/`End` alone cannot: e.g. `Custom` `-150`/`150` with rotation `90` gives a
  vertical crescent with the gap facing left.
- `Ring Radius` — donut ring position as a fraction of the available radius (`0.3`–`0.8`, default `0.55`).
- `Show Ring Band` — default on. Turn it off for a bare radial spike chart: the colored
  ring segments and the background arc are not drawn, while `r0` and the stick scales are
  unchanged, so the spikes keep exactly the same geometry. Ticks keep their own toggle.
- `Ring Thickness (px, max when weighted)` — ring band thickness, `0`–`60`. When the
  setting has never been touched it auto-scales with the chart: `clamp(8, R * 0.045, 24)`.
- `Ring Thickness By` — `Uniform` (default) or `Group Value`. In `Group Value` each
  group's segment thickness encodes its total (measure 2 in dual mode, measure 1 in
  top-N mode), varying symmetrically around the band centreline so all segments share
  one spine. Sticks, ticks and inward bubbles anchor on each group's own ring edge.
- `Stick Scale` — `Linear` (default), `Square Root`, or `Logarithmic`. Log maps
  `t -> log(1 + 499t) / log(500)`, which lifts a long low tail off the ring on heavily
  skewed data where linear and sqrt leave it flat (a value at 1/57th of the max lands
  at ~0.37 of full length instead of sqrt's 0.13).
- `Inward Stick Scale` — dual mode only. `Same as Stick Scale` (default) or its own
  `Linear` / `Square Root` / `Logarithmic`. Log lifts a long tail but flattens the top,
  so the two directions often want different curves — e.g. outward linear with inward
  square root keeps the leaders distinguishable.

- `Show Tip Dots` — top-N mode only, default on. Off draws bare spikes with no dot at
  the tip. Inward highlight bubbles are unaffected, and the sticks stay clickable.
- `Stick Width` — outward stick width in px, `0.5`–`4` (default `1.5`; top-N mode uses `1`
  unless you set this).
- `Highlight Top N Inward` — number of items drawn inward with big bubbles (default `3`,
  `0` disables). Top-N mode only.
- `Show Top N Value Labels` — toggles the value labels next to those bubbles (default on).
  Top-N mode only.
- `Label Top N` — how many dual-mode items get a value label (default `4`, `0` disables,
  max `15`). Dual mode only.
- `Min` / `Max Dot Radius` — dot size range in px when Measure 2 is present (defaults `2` / `8`).
- `Label Size (px, 0 = auto)` — value-label size, `0`–`32`. `0` auto-scales with the
  chart: `clamp(11, R * 0.035, 22)`. The collision pass measures boxes at the real
  font size, so labels stay truthful at any scale.
- `Show Reading Guide` — dual mode only, default on. A key naming what each mark
  encodes, drawn as a single composite lollipop figure with the field names beside it:
  the outward spike, the ring band, the inward stick and the bubble, read top to bottom,
  with a short leader dash from each name to the part it describes. Rows are ordered to
  match that anatomy — measure 1, group dimension, measure 2, measure 3 — and the figure
  always draws whole even when a field is absent. Titles are your actual measure and
  dimension labels, truncated if a row would run off the canvas.
**Overlay style** — `Guide Font Size` and `Legend Font Size` (px, `0` = auto) drive the
reading guide and the group legend; because they feed the same variables the auto sizes
do, row heights, stacking and text-fit all follow from one number each.
`Guide/Legend Font Family` (free text, blank = `sans-serif`), `Guide/Legend Font Weight`
(Normal / Medium / Bold), `Guide/Legend Text Color` and `Guide Icon Color` restyle both
overlays. Icon color falls back to text color, which falls back to the automatic
contrast color; group swatches always keep their data colors.

Setting an explicit `Guide Font Size` also scales the composite figure with it — glyph
column, band, symbolic gaps, stroke weights and bubble all grow proportionally (capped)
so a large key stays in proportion. On auto sizing the figure keeps its standard dimensions. If the
overlays together would not fit the object's height, both fonts shrink by one common
factor rather than overflowing.

- `Auto Center` — default on. A partial sweep leaves dead canvas on its open side;
  this centres the drawing's real envelope in the object and grows the radius into the
  freed space (capped at 1.6x). The envelope includes an allowance for inward value
  labels, which reach past the centre into the gap, so growing the chart never pushes
  them off the canvas. The radius is scaled before any geometry is derived,
  not via an SVG transform, so strokes and fonts stay crisp. A full circle is symmetric
  and is left as-is. Turn it off to keep the drawing pinned to the object centre.
- `Show Legend` — group legend overlay, shown when there are at least 2 groups (default on).
  It scales with the chart (`clamp(13, R * 0.028, 17)`) to match the reading guide.
- `Legend Position` / `Reading Guide Position` — anchor either overlay to any of
  `Top Left`, `Top Right`, `Middle Left`, `Middle Right`, `Bottom Left`, `Bottom Right`
  (defaults `Bottom Right` and `Top Right`). Text aligns toward the nearest side and the
  swatch/glyph column hugs the outer edge, so left and right variants mirror each other.
  Put both on the same slot and they stack — guide on top, legend beneath, 14px apart —
  and a bottom-right stack lifts clear of the stamp block.
- `Show Ring Ticks` — small radial ticks in the group color on the ring's inner edge,
  one per item, giving the clock-face texture (default on).
- `Show Background Arc` — a neutral band behind the colored ring spanning the whole sweep,
  tinted from the background's luminance (default on).
- `Stamp Position` — `Bottom Right` (default) or `Center`. Centered places the wrapped
  block, centre-aligned, in the hollow of the chart, where it tracks auto-centering and
  edge alignment; the auto wrap width is then also capped to fit inside the inner radius.
  A centered stamp leaves the bottom-right corner free, so the legend stack ignores it.
- `Stamp Max Width (px, 0 = auto)` — wrap width for the stamp block. `0` auto-sizes to
  `clamp(240, width * 0.35, 640)`. Both texts word-wrap to this width into a compact
  right-aligned block; if the wrapped block still will not fit, every size is scaled
  down once and the text rewrapped.
- `Intro Animation (on load)` — default on. On the first paint only, the ring washes in,
  the sticks grow out of it with a slight stagger, the bubbles pop, and the labels and
  overlays fade in — about 900ms end to end. Selections, resizes and property edits
  repaint instantly. Turn it off for a completely static chart.
- `Stamp Text` / `Stamp Subtext` — explicit newlines in an expression (e.g.
  `=2024 & chr(10) & 'Who Holds CO2 Crown?'`) are hard line breaks; each segment then
  word-wraps independently, and a double newline leaves a blank line.
- `Stamp Text` / `Stamp Subtext` — large bold text in the bottom-right corner
  (e.g. `2019` over `Who Holds CO2 Crown?`). Empty means nothing is drawn. Both are
  expression-enabled (`fx`), so `=Max(Year)` works. The block auto-scales with the
  chart and is anchored off the bottom edge by its font metrics, so it never clips.

**Sorting** — the native Qlik sorting section also carries `Sort Items By`, which sets
the item order within each group: value descending (default), value ascending,
alphabetical, or load order (which follows the Qlik sort above it).

**Colors** — `Extend Background To Object Edge` (default off) paints Qlik's own object
chrome to match the chart background, removing the white frame around a dark chart. It
walks at most five ancestors, touches only `qv-object-content`,
`qv-object-content-container` and `qv-inner-object` (whose padding band it flattens),
stops at the object boundary, and records every change so turning it off, recolouring, or
removing the chart restores the DOM exactly. If the DOM does not match, it does nothing.

**Colors** — color by automatic palette, master item colors (from a master dimension on
Dimension 2), or a single color, plus the chart background.

**Tooltip** — shows the item name, its group, and both measures with their labels.

**Debug** — console logging under the `[RadialLollipop]` prefix (`window.LOLLIPOP_DEBUG`).

## Selections

Click any lollipop to select its Dimension 1 value. While a selection is active,
unselected items dim to 25% opacity.

## Install

No build step. Zip the folder and upload it as a Qlik Sense extension, or copy it into
your extensions directory. The only bundled dependency is `lib/d3.v7.min.js`.
