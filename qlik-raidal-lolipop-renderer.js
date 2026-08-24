/**
 * qlik-raidal-lolipop-renderer.js
 * Radial Lollipop rendering using D3.js
 *
 * Items are fanned around an arc and grouped into contiguous angular blocks.
 * Each group owns a slice of a thin donut ring band; every item is a lollipop
 * (a radial stick outward from the ring, with a dot at the tip). The top ranked
 * items are instead drawn INWARD toward the centre with large bubbles + labels.
 */
define([
    './qlik-raidal-lolipop-constants',
    './qlik-raidal-lolipop-colors'
], function(CONSTANTS, ColorUtils) {
    'use strict';

    var GEO = CONSTANTS.GEOMETRY;
    var POP = CONSTANTS.LOLLIPOP;

    /**
     * Escape HTML to prevent XSS attacks
     */
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Coerce a value to a finite number, falling back when it is not usable
     */
    function num(value, fallback) {
        var n = parseFloat(value);
        return (typeof n === 'number' && isFinite(n)) ? n : fallback;
    }

    // Curvature of the logarithmic stick scale. Larger k lifts the low tail higher.
    var STICK_LOG_K = 499;

    /**
     * Shape a normalized value t in [0,1] according to the stick scale mode.
     * Every mode maps 0 -> 0 and 1 -> 1; only the curvature between differs.
     * 'log' lifts a long low tail off the ring, which linear and sqrt leave flat
     * on heavily skewed data.
     */
    function shapeT(t, mode) {
        if (mode === 'sqrt') return Math.sqrt(t);
        if (mode === 'log') return Math.log(1 + STICK_LOG_K * t) / Math.log(1 + STICK_LOG_K);
        return t;
    }

    /**
     * Rows for the dual-mode key: which mark encodes which field.
     * Measure titles ride on data.measureLabels and the group title on
     * data.dimensionLabels - the same plumbing the tooltip already uses.
     *
     * @returns {Array} [ { title, glyph } ]
     */
    function buildEncodingRows(data) {
        var measures = (data && data.measureLabels) || [];
        var dimensions = (data && data.dimensionLabels) || [];

        // Ordered to match the composite glyph read top-to-bottom:
        // spike (outward stick) -> band (ring) -> stick (inward) -> bubble (size)
        var rows = [{ title: measures[0] || 'Measure 1', part: 'spike' }];
        if (data && data.hasGroupDim) {
            rows.push({ title: dimensions[1] || 'Group', part: 'band' });
        }
        rows.push({ title: measures[1] || 'Measure 2', part: 'stick' });
        if (data && data.hasMeasure3) {
            rows.push({ title: measures[2] || 'Measure 3', part: 'bubble' });
        }
        return rows;
    }

    /**
     * Whether the key should be drawn. Dual mode only, and opt-out-able.
     */
    function encodingGuideVisible(settings, vizMode) {
        return vizMode === CONSTANTS.VIZ_MODES.DUAL && (settings || {}).showEncodingLegend !== false;
    }

    /**
     * Estimated rendered width of a string at a font size
     */
    function textWidthOf(text, fontSize) {
        return String(text || '').length * fontSize * CONSTANTS.LABEL_METRICS.CHAR_WIDTH_RATIO;
    }

    /**
     * Clip a title to a pixel budget, with an ellipsis. Keeps a long measure name
     * from running off the left edge of the viewport.
     */
    function truncateToWidth(text, fontSize, maxWidth) {
        var s = String(text || '');
        if (textWidthOf(s, fontSize) <= maxWidth) return s;
        var perChar = fontSize * CONSTANTS.LABEL_METRICS.CHAR_WIDTH_RATIO;
        var n = Math.floor(maxWidth / perChar) - 1;
        if (n < 1) return '';
        return s.slice(0, n) + '\u2026';
    }

    /**
     * Resolve an overlay position name into vertical + horizontal anchors.
     * Unknown values fall back to the caller's default.
     */
    function resolvePlacement(position, fallback) {
        var map = {
            topLeft: { vertical: 'top', horizontal: 'left' },
            topRight: { vertical: 'top', horizontal: 'right' },
            middleLeft: { vertical: 'middle', horizontal: 'left' },
            middleRight: { vertical: 'middle', horizontal: 'right' },
            bottomLeft: { vertical: 'bottom', horizontal: 'left' },
            bottomRight: { vertical: 'bottom', horizontal: 'right' }
        };
        return map[position] || map[fallback] || map.topRight;
    }

    /**
     * Place the overlay blocks (encoding key, group legend) around the viewport.
     *
     * Entries that resolve to the SAME position are stacked vertically in the order
     * given - key first, legend under it - separated by OVERLAY_STACK_GAP. A stack
     * landing bottom-right is lifted clear of the stamp block, which generalises the
     * old legend-above-stamp offset to the whole stack.
     *
     * Pure, so the resulting boxes can be asserted without a DOM.
     *
     * @param {Object} opts { width, height, stampLayout, entries: [ { id, position, height } ] }
     * @returns {Object} map of id -> { top, vertical, horizontal, inset }
     */
    function layoutOverlayStack(opts) {
        opts = opts || {};
        var width = opts.width;
        var height = opts.height;
        var entries = opts.entries || [];
        var inset = GEO.KEY_INSET;
        var gap = GEO.OVERLAY_STACK_GAP;
        var result = {};

        if (!(width > 0) || !(height > 0) || entries.length === 0) return result;

        // Top of the stamp block, if one is drawn
        var stampTop = null;
        if (opts.stampLayout && opts.stampLayout.lines && opts.stampLayout.lines.length > 0) {
            stampTop = opts.stampLayout.lines.reduce(function(top, line) {
                return Math.min(top, line.box.y0);
            }, Infinity);
        }

        // Group by position, preserving the caller's order within each group
        var order = [];
        var groups = {};
        entries.forEach(function(entry) {
            var key = entry.position || '';
            if (!groups[key]) {
                groups[key] = [];
                order.push(key);
            }
            groups[key].push(entry);
        });

        order.forEach(function(position) {
            var members = groups[position];
            var placement = resolvePlacement(position, CONSTANTS.OVERLAY_POSITIONS.TOP_RIGHT);

            var totalHeight = 0;
            members.forEach(function(entry, i) {
                totalHeight += entry.height + (i > 0 ? gap : 0);
            });

            // The stamp only ever occupies the bottom-right corner
            var bottomLimit = height - inset;
            if (placement.vertical === 'bottom' && placement.horizontal === 'right' && stampTop !== null) {
                bottomLimit = Math.min(bottomLimit, stampTop - GEO.LEGEND_STAMP_GAP);
            }

            var top;
            if (placement.vertical === 'top') {
                top = inset;
            } else if (placement.vertical === 'middle') {
                top = (height - totalHeight) / 2;
            } else {
                top = bottomLimit - totalHeight;
            }
            top = Math.max(0, top);

            members.forEach(function(entry) {
                result[entry.id] = {
                    top: top,
                    vertical: placement.vertical,
                    horizontal: placement.horizontal,
                    inset: inset
                };
                top += entry.height + gap;
            });
        });

        return result;
    }

    /**
     * Lay the key block out in the top-right corner, in ABSOLUTE svg coordinates.
     * Right-aligned text with a small glyph column to its right, one row per field.
     * Pure, so the geometry can be asserted without a DOM.
     *
     * @returns {Object|null} { fontSize, rowHeight, rows: [ { text, glyph, textX, baseline, glyphCX, glyphCY, box } ] }
     */
    function layoutEncodingKey(rows, width, height, fontSize, horizontal, blockTop, glyphScale) {
        if (!rows || rows.length === 0) return null;
        if (!(width > 0) || !(height > 0)) return null;

        // glyphScale is 1 on the AUTO font path, which keeps the figure on the
        // fixed constants it was drawn against - defaults stay byte-identical.
        // With an EXPLICIT key font it is fontSize / KEY_FONT_BASE, so the column,
        // the band, the symbolic gaps and the bubble ceiling all grow with the text
        // instead of leaving a tiny figure beside large type.
        var scale = (typeof glyphScale === 'number' && isFinite(glyphScale) && glyphScale > 0)
            ? glyphScale : 1;

        var inset = GEO.KEY_INSET;
        var glyphW = scale === 1
            ? GEO.KEY_GLYPH_WIDTH
            : Math.min(GEO.KEY_GLYPH_MAX_WIDTH, Math.round(GEO.KEY_GLYPH_WIDTH * scale));
        var glyphGap = GEO.KEY_GLYPH_GAP;
        var dashLen = GEO.KEY_DASH_LENGTH;
        var dashGap = GEO.KEY_DASH_GAP;
        var rowHeight = fontSize * GEO.KEY_ROW_RATIO;
        var onLeft = horizontal === 'left';
        var top = (typeof blockTop === 'number' && isFinite(blockTop)) ? blockTop : inset;
        var blockHeight = rows.length * rowHeight;

        // Glyph column hugs the outer edge; then the leader dash; then the text,
        // reading inward. Left placements mirror the whole arrangement.
        var glyphX0 = onLeft ? inset : (width - inset - glyphW);
        var glyphCX = glyphX0 + glyphW / 2;
        var dashOuter = onLeft ? (glyphX0 + glyphW + dashGap) : (glyphX0 - dashGap);
        var dashInner = onLeft ? (dashOuter + dashLen) : (dashOuter - dashLen);
        var textX = onLeft ? (dashInner + dashGap) : (dashInner - dashGap);
        var anchor = onLeft ? 'start' : 'end';
        var maxTextWidth = Math.max(0, width - 2 * inset - glyphW - dashLen - 2 * dashGap - glyphGap);

        // Row centres are evenly spaced, and the glyph's parts are then placed ON
        // those centres - so each row is aligned with the part it names by
        // construction, and rows can never overlap.
        function centreOf(i) { return top + (i + 0.5) * rowHeight; }

        var index = {};
        rows.forEach(function(row, i) { index[row.part] = i; });

        var bubbleR = clampNum(fontSize * 0.42, 4, 9 * scale);
        var spikeMid = centreOf(index.spike !== undefined ? index.spike : 0);
        var stickMid = centreOf(index.stick !== undefined ? index.stick : rows.length - 1);

        // Parts with no row of their own still draw, tucked between their neighbours
        var bandY = index.band !== undefined ? centreOf(index.band) : (spikeMid + stickMid) / 2;
        var bubbleY = index.bubble !== undefined
            ? centreOf(index.bubble)
            : Math.min(top + blockHeight - bubbleR - 2, stickMid + rowHeight * 0.7);

        var spikeTop = top + 2;
        var glyph = {
            cx: glyphCX,
            top: top,
            bottom: top + blockHeight,
            spikeTop: spikeTop,
            // Representative y of each part, for the row association
            spikeY: (spikeTop + bandY) / 2,
            bandY: bandY,
            bandWidth: glyphW * 0.72,
            bandDome: rowHeight * 0.38,
            // Symbolic separation between the band and the spike/stick
            gapUnit: 3 * scale,
            // Stroke weights follow the figure so a large key does not read thin
            // next to its type. Capped so an extreme font cannot make it a blob.
            strokeScale: Math.min(scale, 2.5),
            stickY: (bandY + bubbleY) / 2,
            bubbleY: bubbleY,
            bubbleR: bubbleR
        };

        var partY = {
            spike: glyph.spikeY,
            band: glyph.bandY,
            stick: glyph.stickY,
            bubble: glyph.bubbleY
        };

        var laid = rows.map(function(row, i) {
            var text = truncateToWidth(row.title, fontSize, maxTextWidth);
            var textWidth = textWidthOf(text, fontSize);
            var centre = centreOf(i);
            var baseline = centre + fontSize * 0.36;
            return {
                text: text,
                part: row.part,
                partY: partY[row.part],
                textX: textX,
                anchor: anchor,
                centreY: centre,
                baseline: baseline,
                dashX0: Math.min(dashOuter, dashInner),
                dashX1: Math.max(dashOuter, dashInner),
                box: {
                    x0: onLeft ? inset : (textX - textWidth),
                    y0: centre - rowHeight / 2,
                    x1: onLeft ? (textX + textWidth) : (width - inset),
                    y1: centre + rowHeight / 2
                }
            };
        });

        return {
            fontSize: fontSize,
            rowHeight: rowHeight,
            height: blockHeight,
            glyph: glyph,
            rows: laid
        };
    }

    /**
     * The inward entries that get a value label, largest measure 2 first with the
     * name as a deterministic tie-break. Shared by the renderer and by the
     * drawn-extent measurement so the two can never disagree about which labels
     * exist.
     */
    function inwardLabelCandidates(entries, count) {
        if (!entries || count <= 0) return [];
        return entries.slice().sort(function(a, b) {
            if (b.item.value2 !== a.item.value2) return b.item.value2 - a.item.value2;
            return String(a.item.name).localeCompare(String(b.item.name));
        }).slice(0, count);
    }

    /**
     * How far an inward value label can reach past the chart envelope.
     *
     * Inward labels are anchored between the bubble and the centre and run AWAY
     * from the bubble, so on a partial sweep they spill into the gap - past the
     * centre and outside the {centre + outer arc} hull. Auto-centering has to know
     * about that reach or the fit scale-up clips them.
     *
     * Only the labels that will actually be drawn are measured: the dual-mode
     * labelTopN candidates by measure 2, or the top-N candidates by rank. Returns 0
     * when no labels will be drawn.
     */
    function labelOvershoot(data, settings, radius, innerRatio, vizMode) {
        settings = settings || {};
        if (!data || !data.groups) return 0;

        var isDual = vizMode === CONSTANTS.VIZ_MODES.DUAL;
        var count = isDual
            ? Math.max(0, Math.floor(num(settings.labelTopN, POP.LABEL_TOP_N)))
            : Math.max(0, Math.floor(num(settings.topN, POP.TOP_N)));

        if (count === 0) return 0;
        if (!isDual && settings.showTopLabels === false) return 0;

        var items = [];
        data.groups.forEach(function(group) {
            (group.items || []).forEach(function(item) { items.push(item); });
        });
        if (items.length === 0) return 0;

        var hasMeasure2 = !!data.hasMeasure2;
        var candidates;
        var textOf;

        if (isDual) {
            candidates = items.filter(function(item) {
                return item.value2 !== null && item.value2 !== undefined;
            }).sort(function(a, b) { return b.value2 - a.value2; });
            textOf = function(item) { return item.text2 || ''; };
        } else {
            var rank = function(item) {
                return (hasMeasure2 && item.value2 !== null && item.value2 !== undefined)
                    ? item.value2 : item.value1;
            };
            candidates = items.slice().sort(function(a, b) { return rank(b) - rank(a); });
            textOf = function(item) {
                return (hasMeasure2 && item.text2) ? item.text2 : (item.text1 || '');
            };
        }

        candidates = candidates.slice(0, count);
        if (candidates.length === 0) return 0;

        var chars = 0;
        candidates.forEach(function(item) {
            var len = String(textOf(item)).length;
            if (len > chars) chars = len;
        });
        if (chars === 0) return 0;

        // Pre-fit estimates. Both terms are clamped, so neither grows faster than R.
        var labelSize = num(settings.labelSize, 0) > 0
            ? num(settings.labelSize, 0)
            : clampNum(radius * GEO.LABEL_AUTO_RATIO, GEO.LABEL_AUTO_MIN, GEO.LABEL_AUTO_MAX);
        var r0 = radius * innerRatio;
        var bubble = Math.min(GEO.TOP_BUBBLE_MAX_RADIUS, Math.max(4, r0 * 0.18));

        return chars * labelSize * CONSTANTS.LABEL_METRICS.CHAR_WIDTH_RATIO + bubble + GEO.TOP_LABEL_GAP;
    }

    /**
     * Bounding box of the chart envelope over a sweep, in chart-local coordinates.
     *
     * The centre is always included: every inner element (ring band, ticks, inward
     * sticks and bubbles) lies on a segment between the centre and a point on the
     * outer arc, so the hull of {centre} + outer arc contains all of them.
     * The box scales linearly with the radius, which is what lets the caller solve
     * for a fitted radius from a single unit-radius measurement.
     */
    function envelopeBBox(radius, a0, a1) {
        var lo = Math.min(a0, a1);
        var hi = Math.max(a0, a1);

        // Exact, not sampled: an arc's extremes can only occur at its endpoints or
        // where it crosses an axis, so those points plus the centre give the true box.
        var points = [[0, 0], polarToXY(radius, lo), polarToXY(radius, hi)];
        for (var k = Math.ceil(lo / 90); k <= Math.floor(hi / 90); k++) {
            points.push(polarToXY(radius, k * 90));
        }

        var minX = points[0][0];
        var maxX = points[0][0];
        var minY = points[0][1];
        var maxY = points[0][1];

        points.forEach(function(p) {
            if (p[0] < minX) minX = p[0];
            if (p[0] > maxX) maxX = p[0];
            if (p[1] < minY) minY = p[1];
            if (p[1] > maxY) maxY = p[1];
        });

        return {
            x0: minX, y0: minY, x1: maxX, y1: maxY,
            width: maxX - minX,
            height: maxY - minY,
            cx: (minX + maxX) / 2,
            cy: (minY + maxY) / 2
        };
    }

    // Qlik's object chrome sits between our container and the sheet grid cell.
    // These class names come from a live Qlik Cloud DOM capture: walking up from
    // our container the chain is
    //   DIV.ng-scope -> DIV.qv-object-content -> DIV.qv-object-content-container
    //   -> DIV.qv-inner-object -> ARTICLE.qv-object -> cell wrappers
    // The three white ones get painted; qv-inner-object also carries the visible
    // padding band. The ARTICLE.qv-object is the boundary: never touched.
    //
    // Matching is on exact classList TOKENS, not substrings - 'qv-object' is a
    // substring of 'qv-object-content', so substring matching would stop the walk
    // at the very first element we mean to paint.
    var CONTAINER_FILL_ALLOW = [
        'qv-object-content',
        'qv-object-content-container',
        'qv-inner-object'
    ];

    // Elements that carry the padding band we flatten
    var CONTAINER_FILL_PAD = ['qv-inner-object'];

    // Reaching this token means we are at the object boundary - stop WITHOUT
    // touching it or anything above it.
    var CONTAINER_FILL_STOP = ['qv-object'];

    /**
     * Class name of an element, tolerating SVG's SVGAnimatedString
     */
    function classNameOf(element) {
        if (!element) return '';
        var name = element.className;
        if (typeof name === 'string') return name;
        if (name && typeof name.baseVal === 'string') return name.baseVal;
        return '';
    }

    /**
     * Exact class-token test. Uses classList where available and falls back to
     * splitting the class string, so element-like test doubles work too.
     */
    function hasClassToken(element, token) {
        if (!element) return false;
        if (element.classList && typeof element.classList.contains === 'function') {
            return element.classList.contains(token);
        }
        return String(classNameOf(element)).split(/\s+/).indexOf(token) !== -1;
    }

    function hasAnyClassToken(element, tokens) {
        for (var i = 0; i < tokens.length; i++) {
            if (hasClassToken(element, tokens[i])) return true;
        }
        return false;
    }

    /**
     * Ancestors of the extension container that are Qlik object chrome and may be
     * painted. Stops before the object boundary and never walks past maxDepth, so
     * an unexpected DOM simply yields nothing.
     * Pure: takes any element-like tree, so it runs without a browser.
     *
     * @returns {Array} [ { element, padding } ]
     */
    function collectContainerFillTargets(container, maxDepth) {
        var targets = [];
        if (!container) return targets;
        var depth = (typeof maxDepth === 'number' && maxDepth > 0)
            ? maxDepth : GEO.CONTAINER_FILL_MAX_DEPTH;
        var element = container.parentElement;

        for (var i = 0; i < depth && element; i++) {
            if (hasAnyClassToken(element, CONTAINER_FILL_STOP)) break;
            if (hasAnyClassToken(element, CONTAINER_FILL_ALLOW)) {
                targets.push({
                    element: element,
                    padding: hasAnyClassToken(element, CONTAINER_FILL_PAD)
                });
            }
            element = element.parentElement;
        }
        return targets;
    }

    /**
     * Clamp a number into [min, max]
     */
    function clampNum(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    /**
     * Convert an angle in degrees (0 = 12 o'clock, clockwise) to radians
     */
    function toRadians(degrees) {
        return degrees * Math.PI / 180;
    }

    /**
     * Point on a circle centred at the origin.
     * 0 degrees = 12 o'clock, angles increase clockwise.
     */
    function polarToXY(radius, degrees) {
        var rad = toRadians(degrees);
        return [radius * Math.sin(rad), -radius * Math.cos(rad)];
    }

    /**
     * Resolve the effective arc sweep from the preset.
     * 'full'   -> a 360 degree sweep, minus a small seam gap so the first and
     *             last items do not overlap
     * 'half'   -> -90 .. 90
     * 'custom' -> the startAngle / endAngle settings (the default)
     */
    function resolveAngles(settings) {
        settings = settings || {};
        var preset = settings.arcPreset || CONSTANTS.ARC_PRESETS.CUSTOM;

        if (preset === CONSTANTS.ARC_PRESETS.FULL) {
            return {
                startAngle: -180 + GEO.FULL_CIRCLE_GAP,
                endAngle: 180 - GEO.FULL_CIRCLE_GAP
            };
        }
        if (preset === CONSTANTS.ARC_PRESETS.HALF) {
            return { startAngle: -90, endAngle: 90 };
        }
        if (preset === CONSTANTS.ARC_PRESETS.QUARTER) {
            return { startAngle: -45, endAngle: 45 };
        }
        return {
            startAngle: num(settings.startAngle, GEO.START_ANGLE),
            endAngle: num(settings.endAngle, GEO.END_ANGLE)
        };
    }

    /**
     * Resolve the effective visualization mode.
     * 'dual' needs at least two measures, so it degrades to 'topn' below that -
     * including when it was requested explicitly.
     * 'auto' picks 'dual' as soon as a second measure is present.
     */
    function resolveVizMode(settings, measureCount) {
        settings = settings || {};
        var mode = settings.vizMode || CONSTANTS.VIZ_MODES.AUTO;
        var count = num(measureCount, 1);

        if (count < 2) return CONSTANTS.VIZ_MODES.TOPN;
        if (mode === CONSTANTS.VIZ_MODES.DUAL) return CONSTANTS.VIZ_MODES.DUAL;
        if (mode === CONSTANTS.VIZ_MODES.TOPN) return CONSTANTS.VIZ_MODES.TOPN;
        return CONSTANTS.VIZ_MODES.DUAL;
    }

    /**
     * Axis-aligned box intersection, used by the dual-mode label collision pass
     */
    function boxesIntersect(a, b) {
        return !(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0);
    }

    /**
     * Estimated text box for a placed label, from its anchor point and alignment
     */
    function labelBox(placement, text, fontSize) {
        var size = (typeof fontSize === 'number' && isFinite(fontSize) && fontSize > 0)
            ? fontSize
            : CONSTANTS.LABEL_METRICS.LINE_HEIGHT;
        var w = String(text || '').length * size * CONSTANTS.LABEL_METRICS.CHAR_WIDTH_RATIO;
        var h = size;
        var x0;
        var y0;

        if (placement.anchor === 'end') {
            x0 = placement.x - w;
        } else if (placement.anchor === 'start') {
            x0 = placement.x;
        } else {
            x0 = placement.x - w / 2;
        }

        if (placement.baseline === 'hanging') {
            y0 = placement.y;
        } else if (placement.baseline === 'auto') {
            y0 = placement.y - h;
        } else {
            y0 = placement.y - h / 2;
        }

        return { x0: x0, y0: y0, x1: x0 + w, y1: y0 + h };
    }

    // Approximate vertical font metrics, as fractions of the font size
    var FONT_ASCENT = 0.80;
    var FONT_DESCENT = 0.22;

    /**
     * Coerce a stamp setting to a string. The value arrives already evaluated, so an
     * expression returning a number lands here as a number - render it, don't drop it.
     * null / undefined / '' mean "no stamp".
     */
    function stampValue(value) {
        if (value === null || value === undefined) return '';
        return String(value);
    }

    /**
     * Lay out the bottom-right stamp block in ABSOLUTE svg coordinates.
     *
     * Baselines are anchored from the bottom edge upward using the real font
     * metrics, so both lines (either one alone, or both together) are provably
     * inside the viewport instead of being clipped by it. If the block cannot fit
     * at its natural size, every size is scaled down by one common factor.
     *
     * @returns {Object|null} { stampSize, subSize, lines: [ { text, size, x, baseline, box } ] }
     */
    function computeStampLayout(settings, width, height, options) {
        settings = settings || {};
        options = options || {};

        // Centred mode lays the block out around the chart's own origin (0,0) in
        // mainGroup coordinates, so it sits in the hollow and tracks auto-centring
        // and edge alignment for free. Corner mode stays in absolute viewport
        // coordinates exactly as before.
        var centered = !!options.centered;
        var hollowRadius = num(options.hollowRadius, 0);

        var stampText = stampValue(settings.stampText);
        var subText = stampValue(settings.stampSubText);
        if (!stampText && !subText) return null;
        if (!(width > 0) || !(height > 0)) return null;

        var inset = GEO.STAMP_INSET;
        var availableHeight = height - 2 * inset;
        var availableWidth = width - 2 * inset;
        if (centered && hollowRadius > 0) {
            var hollowSpan = 2 * GEO.STAMP_HOLLOW_RATIO * hollowRadius;
            availableHeight = Math.min(availableHeight, hollowSpan);
            availableWidth = Math.min(availableWidth, hollowSpan);
        }

        var stampSize = clampNum(Math.min(width, height) * GEO.STAMP_RATIO, GEO.STAMP_MIN, GEO.STAMP_MAX);
        var subSize = stampSize * GEO.STAMP_SUB_RATIO;
        var gap = stampSize * 0.15;

        // Wrap budget: an explicit setting wins, else a share of the viewport
        var explicitWrap = num(settings.stampMaxWidth, 0);
        var maxWidth = explicitWrap > 0
            ? explicitWrap
            : clampNum(width * GEO.STAMP_WRAP_RATIO, GEO.STAMP_WRAP_MIN, GEO.STAMP_WRAP_MAX);
        // In the hollow the block must also clear the ring, so the auto budget is
        // capped by the inner circle. An explicit stampMaxWidth still wins.
        if (centered && explicitWrap <= 0 && hollowRadius > 0) {
            maxWidth = Math.min(maxWidth, 2 * GEO.STAMP_HOLLOW_RATIO * hollowRadius);
        }
        if (availableWidth > 0) maxWidth = Math.min(maxWidth, availableWidth);

        var lineHeight = FONT_ASCENT + FONT_DESCENT;

        // Explicit newlines (e.g. an expression using chr(10)) are HARD breaks: the
        // text is split on them first and each segment is wrapped independently, so
        // a break is honoured even when both halves would have fitted one line. An
        // empty segment (a double newline) yields a blank line of the paragraph's
        // line height. Within a segment: greedy word wrap on the shared
        // character-width estimate; a single word wider than the budget keeps its
        // own line and the shrink-to-fit below deals with it.
        function wrapText(text, size) {
            var out = [];
            var segments = String(text).split(/\r?\n/);

            // Leading/trailing blank segments are dropped so an absent text yields
            // no lines at all and a stray trailing newline does not add an empty
            // row; blank segments BETWEEN content are kept as deliberate spacers.
            while (segments.length > 0 && segments[0].trim() === '') segments.shift();
            while (segments.length > 0 && segments[segments.length - 1].trim() === '') segments.pop();

            segments.forEach(function(segment) {
                var words = segment.split(/\s+/).filter(function(w) { return w.length > 0; });
                if (words.length === 0) {
                    out.push('');
                    return;
                }
                var current = words[0];
                for (var i = 1; i < words.length; i++) {
                    var candidate = current + ' ' + words[i];
                    if (textWidthOf(candidate, size) <= maxWidth) {
                        current = candidate;
                    } else {
                        out.push(current);
                        current = words[i];
                    }
                }
                out.push(current);
            });
            return out;
        }

        // Build the visual line list top-to-bottom: title paragraph, then subtext.
        // gapAbove is the space between a line and the one above it.
        function buildLines(titleSize, bodySize, blockGap) {
            var out = [];
            var intraTitle = titleSize * GEO.STAMP_LINE_GAP;
            var intraBody = bodySize * GEO.STAMP_LINE_GAP;

            wrapText(stampText, titleSize).forEach(function(text, i) {
                out.push({
                    text: text, size: titleSize, className: 'lollipop-stamp-text',
                    gapAbove: i === 0 ? 0 : intraTitle
                });
            });
            wrapText(subText, bodySize).forEach(function(text, i) {
                out.push({
                    text: text, size: bodySize, className: 'lollipop-stamp-subtext',
                    gapAbove: (i === 0 ? (out.length > 0 ? blockGap : 0) : intraBody)
                });
            });
            return out;
        }

        function measure(list) {
            var h = 0;
            var widest = 0;
            list.forEach(function(line) {
                h += line.gapAbove + line.size * lineHeight;
                widest = Math.max(widest, textWidthOf(line.text, line.size));
            });
            return { height: h, width: widest };
        }

        var lineList = buildLines(stampSize, subSize, gap);
        var extent = measure(lineList);

        // Shrink to fit, then REWRAP once at the reduced size (a smaller font fits
        // more per line, so the block gets shorter again). If it still overflows,
        // one residual uniform scale is applied without rewrapping.
        function fitScale(ext) {
            var scale = 1;
            if (ext.height > availableHeight && availableHeight > 0) {
                scale = Math.min(scale, availableHeight / ext.height);
            }
            if (ext.width > availableWidth && availableWidth > 0) {
                scale = Math.min(scale, availableWidth / ext.width);
            }
            return scale;
        }

        var scale = fitScale(extent);
        if (scale < 1) {
            stampSize *= scale;
            subSize *= scale;
            gap *= scale;
            lineList = buildLines(stampSize, subSize, gap);
            extent = measure(lineList);

            var residual = fitScale(extent);
            if (residual < 1) {
                stampSize *= residual;
                subSize *= residual;
                gap *= residual;
                lineList.forEach(function(line) {
                    line.size *= residual;
                    line.gapAbove *= residual;
                });
                extent = measure(lineList);
            }
        }

        // Stack bottom-up: the last line's descender rests exactly on the inset
        var x = centered ? 0 : (width - inset);
        var cursor = centered ? (-extent.height / 2) : (height - inset - extent.height);
        var lines = [];
        var box = null;

        lineList.forEach(function(line) {
            cursor += line.gapAbove;
            var baseline = cursor + line.size * FONT_ASCENT;
            var lineWidth = textWidthOf(line.text, line.size);
            var lineBox = {
                x0: centered ? (x - lineWidth / 2) : (x - lineWidth),
                y0: baseline - line.size * FONT_ASCENT,
                x1: centered ? (x + lineWidth / 2) : x,
                y1: baseline + line.size * FONT_DESCENT
            };
            lines.push({
                text: line.text,
                size: line.size,
                x: x,
                baseline: baseline,
                className: line.className,
                box: lineBox
            });
            box = box ? {
                x0: Math.min(box.x0, lineBox.x0), y0: Math.min(box.y0, lineBox.y0),
                x1: Math.max(box.x1, lineBox.x1), y1: Math.max(box.y1, lineBox.y1)
            } : { x0: lineBox.x0, y0: lineBox.y0, x1: lineBox.x1, y1: lineBox.y1 };
            cursor += line.size * lineHeight;
        });

        return {
            stampSize: stampSize,
            subSize: subSize,
            maxWidth: maxWidth,
            centered: centered,
            box: box,
            lines: lines
        };
    }

    /**
     * Build the angular layout: one contiguous block per group, one slot per item.
     * Returns { groups: [{ group, startAngle, endAngle, color }], items: [{ item, angle, group, color }] }
     */
    function computeLayout(groups, startAngle, endAngle, gapDegrees) {
        var result = { groups: [], items: [] };
        if (!groups || groups.length === 0) return result;

        var span = endAngle - startAngle;
        var direction = span < 0 ? -1 : 1;
        var magnitude = Math.abs(span);
        if (magnitude < 1) magnitude = 1;

        var totalItems = 0;
        groups.forEach(function(g) { totalItems += g.items.length; });
        if (totalItems === 0) return result;

        // Reserve inter-group gaps, but never let them eat the whole span
        var gapTotal = groups.length > 1 ? gapDegrees * (groups.length - 1) : 0;
        if (gapTotal >= magnitude * 0.5) {
            gapTotal = 0;
            gapDegrees = 0;
        }
        var usable = magnitude - gapTotal;

        var cursor = startAngle;
        groups.forEach(function(group, groupIndex) {
            var blockWidth = usable * (group.items.length / totalItems);
            var blockStart = cursor;
            var blockEnd = cursor + direction * blockWidth;

            result.groups.push({
                group: group,
                name: group.name,
                startAngle: blockStart,
                endAngle: blockEnd
            });

            var slot = group.items.length > 0 ? blockWidth / group.items.length : 0;
            group.items.forEach(function(item, itemIndex) {
                result.items.push({
                    item: item,
                    group: group,
                    angle: blockStart + direction * (itemIndex + 0.5) * slot
                });
            });

            if (groupIndex < groups.length - 1) {
                cursor = blockEnd + direction * gapDegrees;
            }
        });

        return result;
    }

    /**
     * Generate unique ID for this renderer instance
     */
    var rendererIdCounter = 0;

    /**
     * Radial Lollipop Renderer
     */
    function RadialLollipopRenderer(d3, container, options) {
        this.d3 = d3;
        this.container = container;
        this.options = options || {};
        this.svg = null;
        this.tooltip = null;
        this.legend = null;
        this._rendererId = 'lollipop-' + (++rendererIdCounter) + '-' + Date.now();
    }

    /**
     * Initialize SVG and tooltip
     */
    RadialLollipopRenderer.prototype.init = function(width, height, settings) {
        var d3 = this.d3;
        settings = settings || {};

        // Validate inputs
        if (!this.container) {
            console.warn('[RadialLollipopRenderer] No container provided');
            return this;
        }
        if (width <= 0 || height <= 0) {
            console.warn('[RadialLollipopRenderer] Invalid dimensions:', width, height);
            this.svg = null;
            return this;
        }

        // Clear container
        d3.select(this.container).selectAll('*').remove();
        this.svg = null;
        this.legend = null;

        // Too small to draw anything meaningful - show a message instead
        if (width < GEO.MIN_RENDER_SIZE || height < GEO.MIN_RENDER_SIZE) {
            d3.select(this.container)
                .append('div')
                .attr('class', 'lollipop-message')
                .text('Too small to display the chart');
            return this;
        }

        var backgroundColor = ColorUtils.getColor(settings.backgroundColor, CONSTANTS.COLORS.BACKGROUND);

        // Legend is an HTML overlay, so the container must be a positioning context
        d3.select(this.container).style('position', 'relative');

        // Create SVG
        this.svg = d3.select(this.container)
            .append('svg')
            .attr('class', 'lollipop-svg')
            .attr('width', width)
            .attr('height', height)
            .style('background-color', backgroundColor);

        // Main group - centred
        this.mainGroup = this.svg.append('g')
            .attr('class', 'lollipop-main')
            .attr('transform', 'translate(' + (width / 2) + ',' + (height / 2) + ')');

        // Tooltip - use unique ID to prevent memory leaks
        var tooltipId = 'tooltip-' + this._rendererId;

        // Remove any existing tooltip with this ID
        d3.select('#' + tooltipId).remove();
        if (this.tooltip) this.tooltip.remove();

        this.tooltip = d3.select('body').append('div')
            .attr('id', tooltipId)
            .attr('class', 'lollipop-tooltip')
            .style('position', 'absolute')
            .style('padding', '10px 14px')
            .style('background', 'rgba(0,0,0,0.9)')
            .style('color', '#fff')
            .style('border-radius', '6px')
            .style('font-size', '13px')
            .style('pointer-events', 'none')
            .style('opacity', 0)
            .style('z-index', CONSTANTS.TOOLTIP.Z_INDEX);

        return this;
    };

    /**
     * Render the radial lollipop chart
     *
     * @param {Object} data - { groups, hasMeasure2, measureLabels }
     * @param {Object} settings - Extension settings
     * @param {Function} colorScale - group name -> color
     * @param {Object} callbacks - { localSelections, hasQlikSelection, onSelect }
     */
    RadialLollipopRenderer.prototype.render = function(data, settings, colorScale, callbacks) {
        var self = this;
        var d3 = this.d3;

        if (!this.svg) return;

        // Validate input parameters
        if (!data || !data.groups || !Array.isArray(data.groups) || data.groups.length === 0) {
            console.warn('[RadialLollipopRenderer] Invalid data');
            return;
        }

        settings = settings || {};
        callbacks = callbacks || {};

        var width = parseInt(this.svg.attr('width'), 10) || 0;
        var height = parseInt(this.svg.attr('height'), 10) || 0;

        // Guard against invalid dimensions
        if (width <= 0 || height <= 0) {
            console.warn('[RadialLollipopRenderer] Invalid SVG dimensions in render:', width, height);
            return;
        }

        this.mainGroup.selectAll('*').remove();
        this.svg.selectAll('.lollipop-encoding-key').remove();
        this.removeLegend();

        // ---- Geometry --------------------------------------------------
        var R = Math.min(width, height) / 2 - GEO.OUTER_MARGIN;
        if (R <= 0) return;

        // Rotation is applied once here, at the source. Everything downstream -
        // ring segments, ticks, back arc, item slots, outward and inward geometry,
        // label placement - derives from these two angles, so it all inherits.
        // Deliberately NOT an SVG group transform: that would tip labels, the
        // stamp and the legend over with it.
        // Resolved before the radius because the sweep decides the envelope,
        // and the envelope decides how much the radius can grow.
        var angles = resolveAngles(settings);
        var rotation = num(settings.rotation, 0);
        var startAngle = angles.startAngle + rotation;
        var endAngle = angles.endAngle + rotation;

        // Mode and inner ratio are needed by the auto-centering allowance below,
        // so they are resolved here rather than further down.
        var hasMeasure2 = !!data.hasMeasure2;
        var hasMeasure3 = !!data.hasMeasure3;
        // A real second dimension is what makes the ring selectable
        var hasGroupDim = !!data.hasGroupDim;
        var measureCount = num(data.measureCount, hasMeasure2 ? 2 : 1);
        var vizMode = resolveVizMode(settings, measureCount);
        var isDual = vizMode === CONSTANTS.VIZ_MODES.DUAL;
        var innerRatio = Math.min(0.8, Math.max(0.3, num(settings.innerRadius, GEO.INNER_RADIUS)));

        // ---- Auto centering ---------------------------------------------
        // A partial sweep leaves dead canvas on the open side. Centre the drawing's
        // real envelope in the viewport, and grow the radius into the freed space.
        // The radius is scaled BEFORE any geometry is derived, not via an SVG
        // transform, so strokes and fonts stay crisp.
        var offsetX = 0;
        var offsetY = 0;
        var alignEnvelope = null;
        var alignH = settings.alignH || 'center';
        var alignV = settings.alignV || 'middle';

        if (settings.autoCenter !== false) {
            var availW = Math.max(1, width - 2 * GEO.OUTER_MARGIN);
            var availH = Math.max(1, height - 2 * GEO.OUTER_MARGIN);

            // Inward value labels run PAST the centre, out into the sweep's gap, so
            // the arc-plus-centre envelope understates the drawing and the fit
            // scale-up would push them off-canvas. Pad the envelope by how far a
            // label can overshoot. Padding all four sides is conservative - the
            // overshoot is only ever on the gap side - and costs a slightly smaller
            // chart in exchange for never clipping.
            var allowance = labelOvershoot(data, settings, R, innerRatio, vizMode);

            // The envelope scales linearly with the radius, so measure it once at
            // radius 1 and solve for the radius that fits the available box. The
            // allowance rides along in the same unit terms; because label size and
            // bubble radius are both clamped they grow no faster than R, so scaling
            // the allowance with R is safe.
            var unit = envelopeBBox(1, startAngle, endAngle);
            var pad = R > 0 ? allowance / R : 0;
            var unitW = unit.width + 2 * pad;
            var unitH = unit.height + 2 * pad;

            if (unitW > 0 && unitH > 0) {
                var fit = Math.min(availW / (unitW * R), availH / (unitH * R));
                // Never shrink, never exceed the cap. A full circle is symmetric and
                // already fills its limiting dimension, so this leaves it untouched.
                R = R * clampNum(fit, 1, GEO.AUTO_CENTER_MAX_SCALE);
            }

            // Symmetric padding does not move the centre, so the translation comes
            // from the unpadded envelope.
            var envelope = envelopeBBox(R, startAngle, endAngle);
            offsetX = -envelope.cx;
            offsetY = -envelope.cy;

            // Edge alignment is applied later, against the EXACT drawn extent
            // rather than this padded envelope - see the alignment pass below.
            alignEnvelope = envelope;
        }

        var r0 = R * innerRatio;

        // An explicit ring thickness always wins; otherwise it scales with the chart
        // 0 also means "auto": Qlik persists an empty integer input as 0
        var ringThickness = (num(settings.ringThickness, 0) > 0)
            ? num(settings.ringThickness, GEO.RING_THICKNESS)
            : clampNum(R * GEO.RING_AUTO_RATIO, GEO.RING_AUTO_MIN, GEO.RING_AUTO_MAX);
        var ringOuter = r0 + ringThickness;

        // Label size: 0 (or unset) means auto-scale with the chart radius
        var explicitLabelSize = num(settings.labelSize, 0);
        var labelSize = explicitLabelSize > 0
            ? explicitLabelSize
            : clampNum(R * GEO.LABEL_AUTO_RATIO, GEO.LABEL_AUTO_MIN, GEO.LABEL_AUTO_MAX);

        var dotMin = Math.max(0.5, num(settings.dotMin, POP.DOT_MIN));
        var dotMax = Math.max(dotMin, num(settings.dotMax, POP.DOT_MAX));
        var maxDotRadius = hasMeasure2 ? dotMax : POP.DOT_FIXED;

        // Outward space available for sticks (dot must still fit inside R)
        var outerSpace = R - ringOuter;
        var maxStickLength = Math.max(GEO.MIN_STICK_LENGTH, outerSpace - maxDotRadius - 2);

        var layout = computeLayout(data.groups, startAngle, endAngle, GEO.GROUP_GAP_DEGREES);
        if (layout.items.length === 0) return;

        // ---- Value scales ----------------------------------------------
        var maxValue1 = 0;
        var maxValue2 = 0;
        var maxValue3 = 0;
        layout.items.forEach(function(entry) {
            if (entry.item.value1 > maxValue1) maxValue1 = entry.item.value1;
            if (entry.item.value2 !== null && entry.item.value2 > maxValue2) maxValue2 = entry.item.value2;
            if (entry.item.value3 !== null && entry.item.value3 !== undefined && entry.item.value3 > maxValue3) {
                maxValue3 = entry.item.value3;
            }
        });

        var scaleMode = settings.stickScale;
        // The inward sticks may run on their own curve: log lifts a long tail but
        // flattens the top, so the two directions often want different shaping.
        var inwardScaleMode = (settings.inwardScale && settings.inwardScale !== 'inherit')
            ? settings.inwardScale
            : scaleMode;

        function stickLength(value) {
            // Guard division by zero / all-equal-at-zero data: everything sits at the minimum
            if (!(maxValue1 > 0)) return GEO.MIN_STICK_LENGTH;
            var t = value / maxValue1;
            if (t < 0) t = 0;
            if (t > 1) t = 1;
            t = shapeT(t, scaleMode);
            return GEO.MIN_STICK_LENGTH + t * Math.max(0, maxStickLength - GEO.MIN_STICK_LENGTH);
        }

        function dotRadius(item) {
            if (!hasMeasure2 || item.value2 === null || !(maxValue2 > 0)) {
                return POP.DOT_FIXED;
            }
            var t = item.value2 / maxValue2;
            if (t < 0) t = 0;
            if (t > 1) t = 1;
            return dotMin + Math.sqrt(t) * (dotMax - dotMin);
        }

        // Ranking value drives the inward top-N highlight
        function rankValue(item) {
            if (hasMeasure2 && item.value2 !== null) return item.value2;
            return item.value1;
        }

        // ---- Top-N inward highlight (top-N mode only) -------------------
        var topN = Math.max(0, Math.floor(num(settings.topN, POP.TOP_N)));
        if (topN > layout.items.length) topN = layout.items.length;
        if (isDual) topN = 0;

        var topSet = {};
        var topEntries = [];
        if (topN > 0) {
            topEntries = layout.items.slice().sort(function(a, b) {
                return rankValue(b.item) - rankValue(a.item);
            }).slice(0, topN);
            topEntries.forEach(function(entry, i) {
                topSet[entry.item.elemNo + '|' + entry.item.name] = true;
                entry.topRank = i;
            });
        }

        function isTop(entry) {
            return topSet[entry.item.elemNo + '|' + entry.item.name] === true;
        }

        var maxTopRank = 0;
        topEntries.forEach(function(entry) {
            var v = rankValue(entry.item);
            if (v > maxTopRank) maxTopRank = v;
        });

        // ---- Colors and selection state --------------------------------
        function groupColor(name) {
            var color = colorScale ? colorScale(name) : null;
            return color || CONSTANTS.COLORS.SINGLE;
        }

        var backgroundColor = ColorUtils.getColor(settings.backgroundColor, CONSTANTS.COLORS.BACKGROUND);
        var textColor = ColorUtils.getContrastColor(backgroundColor);

        // The group dimension carries its own selection state. A pending group
        // selection marks the dim-2 cells S/L while the item cells stay 'O', so
        // this must be consulted before falling back to the items.
        function groupStateSelected(group) {
            var state = group && group.groupState;
            return state === 'S' || state === 'L';
        }

        var localSelections = callbacks.localSelections || new Set();
        var localGroupSelections = callbacks.localGroupSelections || new Set();
        var hasQlikSelection = !!callbacks.hasQlikSelection;
        var hasLocalSelections = localSelections.size > 0;
        var hasLocalGroupSelections = localGroupSelections.size > 0;

        // Declared BEFORE selectionActive: it is a var, so reading it earlier
        // would see undefined and silently disable all dimming.
        var hasGroupSelection = (data.groups || []).some(function(group) {
            return groupStateSelected(group);
        });

        var selectionActive = hasLocalSelections || hasLocalGroupSelections ||
            hasQlikSelection || hasGroupSelection;

        // A group counts as selected by its OWN dim-2 state first, then by any of
        // its items being selected - by Qlik state or by the local set.
        function groupIsSelected(group) {
            if (groupStateSelected(group)) return true;
            // Local echo: a pending group click before Qlik reports any state
            if (hasLocalGroupSelections && group && localGroupSelections.has(group.name)) {
                return true;
            }
            var items = (group && group.items) || [];
            for (var i = 0; i < items.length; i++) {
                if (items[i].isSelected) return true;
                if (hasLocalSelections && localSelections.has(items[i].name)) return true;
            }
            return false;
        }

        function ringOpacity(group) {
            if (!selectionActive) return 0.95;
            return groupIsSelected(group) ? 0.95 : POP.DESELECTED_OPACITY;
        }

        // An item is lit when the item itself is selected OR its group is - a
        // union, so a group selection lights all of its items and a mixed
        // selection never blanks one out.
        function itemOpacity(item, group) {
            if (hasLocalSelections) {
                return localSelections.has(item.name) ? 1 : POP.DESELECTED_OPACITY;
            }
            if (!selectionActive) return 1;
            if (item.isSelected) return 1;
            if (groupStateSelected(group)) return 1;
            // A locally-clicked group lights every item it holds
            if (hasLocalGroupSelections && group && localGroupSelections.has(group.name)) {
                return 1;
            }
            return POP.DESELECTED_OPACITY;
        }

        // ---- Shared inward geometry (top-N highlight and dual mode) -----
        var innerMax = Math.max(GEO.MIN_STICK_LENGTH, r0 * GEO.INNER_STICK_RATIO);
        var maxBubbleRadius = Math.min(GEO.TOP_BUBBLE_MAX_RADIUS, Math.max(4, r0 * 0.18));

        // ---- Per-group ring thickness -----------------------------------
        // In 'value' mode each group's band encodes its total, varying symmetrically
        // around the band centreline so thick and thin segments share one spine.
        // In 'uniform' mode every group gets the full thickness, which reproduces
        // the original single-radius band exactly.
        var ringCentre = (r0 + ringOuter) / 2;
        var ringWeighted = settings.ringWeight === CONSTANTS.RING_WEIGHTS.VALUE;
        var maxRingT = ringThickness;
        var minRingT = Math.min(maxRingT, Math.max(3, 0.3 * maxRingT));

        function groupRingTotal(group) {
            var total = 0;
            group.items.forEach(function(item) {
                if (isDual) {
                    // Dual mode weights by measure 2, falling back to measure 1
                    total += (item.value2 !== null && item.value2 !== undefined) ? item.value2 : item.value1;
                } else {
                    total += item.value1;
                }
            });
            return total;
        }

        var maxGroupTotal = 0;
        if (ringWeighted) {
            layout.groups.forEach(function(g) {
                g.ringTotal = groupRingTotal(g.group);
                if (g.ringTotal > maxGroupTotal) maxGroupTotal = g.ringTotal;
            });
        }

        var ringGeom = {};
        layout.groups.forEach(function(g) {
            var thickness = maxRingT;
            if (ringWeighted && maxGroupTotal > 0) {
                thickness = minRingT + clampNum(g.ringTotal / maxGroupTotal, 0, 1) * (maxRingT - minRingT);
            }
            ringGeom[g.name] = {
                thickness: thickness,
                inner: ringCentre - thickness / 2,
                outer: ringCentre + thickness / 2
            };
        });

        // Per-group ring edges - everything that anchors on the ring uses these
        function ringInnerOf(name) {
            return ringGeom[name] ? ringGeom[name].inner : r0;
        }

        function ringOuterOf(name) {
            return ringGeom[name] ? ringGeom[name].outer : ringOuter;
        }

        // Radius (from centre) at which a bubble sits, clamped so it never crosses the centre
        function bubblePosRadius(stickLen, bubbleR, baseRadius) {
            var base = (baseRadius === undefined || baseRadius === null) ? r0 : baseRadius;
            return Math.max(bubbleR + 2, base - stickLen);
        }

        // Anchor point for an inward value label: the bubble centre pushed further
        // toward the centre of the chart by (bubbleRadius + gap), so the label always
        // starts fully OUTSIDE the bubble. The radius is clamped at 0 so the point can
        // never cross the centre; because bubblePosRadius() already keeps the bubble
        // at least its own radius + 2px away from the centre, even the clamped point
        // stays outside the bubble.
        function labelPlacement(angle, pos, bubble) {
            var idealRadius = pos - bubble - GEO.TOP_LABEL_GAP;

            // Unit vector pointing from the centre out toward the bubble. The text must
            // run the OTHER way so it extends away from the bubble, never across it.
            var dir = polarToXY(1, angle);
            var anchor;
            var baseline;

            if (idealRadius < 0) {
                // The inward anchor would cross the centre. Park the label BESIDE the
                // bubble instead of on the centre point: offset perpendicular to the ray
                // by (bubbleRadius + gap), which keeps it provably outside the bubble and
                // stops the largest item's label from squatting on the centre and
                // crowding out its neighbours.
                var centre = polarToXY(pos, angle);

                // Tangent to the ray, in the direction of increasing angle. Using a
                // consistent tangential side (rather than always the same screen
                // direction) fans neighbouring labels apart along the arc instead of
                // piling them on top of each other, and is fully determined by the angle.
                var perp = [-dir[1], dir[0]];
                var offset = bubble + GEO.TOP_LABEL_GAP;

                if (perp[0] > 0.3) {
                    anchor = 'start';
                    baseline = 'middle';
                } else if (perp[0] < -0.3) {
                    anchor = 'end';
                    baseline = 'middle';
                } else {
                    anchor = 'middle';
                    baseline = perp[1] > 0 ? 'hanging' : 'auto';
                }

                return {
                    x: centre[0] + perp[0] * offset,
                    y: centre[1] + perp[1] * offset,
                    anchor: anchor,
                    baseline: baseline
                };
            }

            var point = polarToXY(idealRadius, angle);

            if (dir[0] > 0.3) {
                // Bubble sits to the right -> text runs left
                anchor = 'end';
                baseline = 'middle';
            } else if (dir[0] < -0.3) {
                // Bubble sits to the left -> text runs right
                anchor = 'start';
                baseline = 'middle';
            } else {
                // Near-vertical: centre the text and run it away vertically
                anchor = 'middle';
                baseline = dir[1] < 0 ? 'hanging' : 'auto';
            }

            return { x: point[0], y: point[1], anchor: anchor, baseline: baseline };
        }

        // ---- Dual-mode inward geometry ----------------------------------
        // Defined here, not inside renderDualInward, so the drawn-extent pass below
        // measures with exactly the functions that later draw the marks.
        function dualInwardLength(item) {
            if (!(maxValue2 > 0)) return GEO.MIN_STICK_LENGTH;
            var t = item.value2 / maxValue2;
            if (t < 0) t = 0;
            if (t > 1) t = 1;
            t = shapeT(t, inwardScaleMode);
            return GEO.MIN_STICK_LENGTH + t * Math.max(0, innerMax - GEO.MIN_STICK_LENGTH);
        }

        function dualBubbleRadius(item) {
            var value = hasMeasure3 ? item.value3 : item.value2;
            var maxValue = hasMeasure3 ? maxValue3 : maxValue2;
            if (value === null || value === undefined || !(maxValue > 0)) {
                return dotMin;
            }
            var t = value / maxValue;
            if (t < 0) t = 0;
            if (t > 1) t = 1;
            return dotMin + Math.sqrt(t) * Math.max(0, maxBubbleRadius - dotMin);
        }

        function dualBubblePos(entry) {
            return bubblePosRadius(
                dualInwardLength(entry.item),
                dualBubbleRadius(entry.item),
                ringInnerOf(entry.group.name)
            );
        }

        // ---- Top-N inward geometry --------------------------------------
        // Hoisted for the same reason as the dual geometry: the alignment pass and
        // the renderer must measure with one set of functions.
        function topStickLength(item) {
            if (!(maxTopRank > 0)) return innerMax * 0.5;
            var t = rankValue(item) / maxTopRank;
            if (t < 0) t = 0;
            if (t > 1) t = 1;
            return innerMax * (0.35 + 0.65 * t);
        }

        function topBubbleRadiusOf(entry) {
            if (!(maxTopRank > 0)) return maxBubbleRadius * 0.5;
            var t = rankValue(entry.item) / maxTopRank;
            if (t < 0) t = 0;
            if (t > 1) t = 1;
            return Math.max(4, Math.sqrt(t) * maxBubbleRadius);
        }

        function topBubblePosOf(entry) {
            return bubblePosRadius(
                topStickLength(entry.item),
                topBubbleRadiusOf(entry),
                ringInnerOf(entry.group.name)
            );
        }

        // ---- Exact edge alignment ---------------------------------------
        // Aligning on the arc envelope alone leaves a gap the width of the label
        // allowance. Measure what is ACTUALLY drawn - the envelope, every inward
        // bubble at its own radius, and every label box at its real placement -
        // and pin that box to the margin. Centre alignment stays envelope-based.
        if (alignEnvelope && (alignH !== 'center' || alignV !== 'middle')) {
            var content = {
                x0: alignEnvelope.x0, y0: alignEnvelope.y0,
                x1: alignEnvelope.x1, y1: alignEnvelope.y1
            };

            function includeDisc(cx, cy, radius) {
                if (cx - radius < content.x0) content.x0 = cx - radius;
                if (cx + radius > content.x1) content.x1 = cx + radius;
                if (cy - radius < content.y0) content.y0 = cy - radius;
                if (cy + radius > content.y1) content.y1 = cy + radius;
            }

            function includeBox(box) {
                if (box.x0 < content.x0) content.x0 = box.x0;
                if (box.x1 > content.x1) content.x1 = box.x1;
                if (box.y0 < content.y0) content.y0 = box.y0;
                if (box.y1 > content.y1) content.y1 = box.y1;
            }

            if (isDual) {
                var alignInward = layout.items.filter(function(entry) {
                    return entry.item.value2 !== null && entry.item.value2 !== undefined;
                });
                alignInward.forEach(function(entry) {
                    var pos = dualBubblePos(entry);
                    var point = polarToXY(pos, entry.angle);
                    includeDisc(point[0], point[1], dualBubbleRadius(entry.item));
                });

                var alignCount = Math.max(0, Math.floor(num(settings.labelTopN, POP.LABEL_TOP_N)));
                inwardLabelCandidates(alignInward, alignCount).forEach(function(entry) {
                    var text = entry.item.text2;
                    if (!text) return;
                    var radius = dualBubbleRadius(entry.item);
                    var placement = labelPlacement(entry.angle, dualBubblePos(entry), radius);
                    includeBox(labelBox(placement, text, labelSize));
                });
            } else if (topEntries.length > 0) {
                topEntries.forEach(function(entry) {
                    var radius = topBubbleRadiusOf(entry);
                    var pos = topBubblePosOf(entry);
                    var point = polarToXY(pos, entry.angle);
                    includeDisc(point[0], point[1], radius);
                    if (settings.showTopLabels === false) return;
                    var text = (hasMeasure2 && entry.item.text2) ? entry.item.text2 : entry.item.text1;
                    if (!text) return;
                    includeBox(labelBox(labelPlacement(entry.angle, pos, radius), text, labelSize));
                });
            }

            if (alignH === 'left') {
                offsetX = GEO.OUTER_MARGIN - width / 2 - content.x0;
            } else if (alignH === 'right') {
                offsetX = width / 2 - GEO.OUTER_MARGIN - content.x1;
            }
            if (alignV === 'top') {
                offsetY = GEO.OUTER_MARGIN - height / 2 - content.y0;
            } else if (alignV === 'bottom') {
                offsetY = height / 2 - GEO.OUTER_MARGIN - content.y1;
            }
        }

        // Recentre the drawing group. Stamp and legend compensate for this so they
        // stay anchored to the viewport corner.
        var translateX = width / 2 + offsetX;
        var translateY = height / 2 + offsetY;
        this.mainGroup.attr('transform', 'translate(' + translateX + ',' + translateY + ')');

        // ---- Neutral back-arc band (under the coloured ring) ------------
        var isDarkBackground = textColor === '#FFFFFF';

        // The back arc is part of the ring band, so hiding the ring hides it too
        if (settings.showBackArc !== false && settings.showRing !== false) {
            var backArc = d3.arc()
                .innerRadius(Math.max(0, r0 - GEO.BACK_ARC_PAD))
                .outerRadius(ringOuter + GEO.BACK_ARC_PAD);

            this.mainGroup.append('path')
                .attr('class', 'lollipop-back-arc')
                .attr('d', backArc({
                    startAngle: toRadians(Math.min(startAngle, endAngle)),
                    endAngle: toRadians(Math.max(startAngle, endAngle))
                }))
                .attr('fill', isDarkBackground ? '#FFFFFF' : '#000000')
                .attr('fill-opacity', isDarkBackground ? POP.BACK_ARC_DARK_OPACITY : POP.BACK_ARC_LIGHT_OPACITY);
        }

        // ---- Donut ring band -------------------------------------------
        // Radii come from the datum so each group can carry its own thickness
        var arcGenerator = d3.arc();

        // Ring band is optional; r0/ringOuter stay in the geometry either way so
        // sticks, ticks and scales are unaffected by hiding it.
        if (settings.showRing !== false) {
            var ringSegments = this.mainGroup.append('g')
                .attr('class', 'lollipop-ring')
                .selectAll('.lollipop-ring-segment')
                .data(layout.groups)
                .enter()
                .append('path')
                .attr('class', 'lollipop-ring-segment')
                .attr('d', function(d) {
                    var a1 = Math.min(d.startAngle, d.endAngle);
                    var a2 = Math.max(d.startAngle, d.endAngle);
                    return arcGenerator({
                        innerRadius: ringInnerOf(d.name),
                        outerRadius: ringOuterOf(d.name),
                        startAngle: toRadians(a1),
                        endAngle: toRadians(a2)
                    });
                })
                .attr('fill', function(d) { return groupColor(d.name); })
                .attr('fill-opacity', function(d) { return ringOpacity(d.group); })
                .style('cursor', hasGroupDim ? 'pointer' : null);

            // Only a real second dimension is selectable; a synthetic single group
            // has no dim-2 cell behind it, so its ring stays inert.
            if (hasGroupDim) {
                this.attachRingInteractions(ringSegments, settings, callbacks, selectionActive);
            }
        }

        // ---- Clock texture: ticks on the ring's inner edge ---------------
        if (settings.showTicks !== false) {
            this.mainGroup.append('g')
                .attr('class', 'lollipop-ticks')
                .selectAll('.lollipop-tick')
                .data(layout.items)
                .enter()
                .append('line')
                .attr('class', 'lollipop-tick')
                .attr('x1', function(d) {
                    return polarToXY(Math.max(0, ringInnerOf(d.group.name) - GEO.TICK_LENGTH), d.angle)[0];
                })
                .attr('y1', function(d) {
                    return polarToXY(Math.max(0, ringInnerOf(d.group.name) - GEO.TICK_LENGTH), d.angle)[1];
                })
                .attr('x2', function(d) { return polarToXY(ringInnerOf(d.group.name), d.angle)[0]; })
                .attr('y2', function(d) { return polarToXY(ringInnerOf(d.group.name), d.angle)[1]; })
                .attr('stroke', function(d) { return groupColor(d.group.name); })
                .attr('stroke-width', 1)
                .attr('stroke-opacity', function(d) {
                    // Ticks dim with the segment they belong to
                    if (!selectionActive) return POP.TICK_OPACITY;
                    return groupIsSelected(d.group)
                        ? POP.TICK_OPACITY
                        : POP.TICK_OPACITY * POP.DESELECTED_OPACITY;
                });
        }

        // Outward stick width: dual mode defaults thicker, but an explicit
        // setting always wins in either mode
        var stickWidth = (settings.stickWidth !== undefined && settings.stickWidth !== null)
            ? Math.max(0.5, num(settings.stickWidth, POP.STICK_WIDTH))
            : (isDual ? POP.DUAL_STICK_WIDTH : POP.STICK_WIDTH);

        // Inward sticks follow the same explicit setting; default stays TOP_STICK_WIDTH
        var inwardStickWidth = (settings.stickWidth !== undefined && settings.stickWidth !== null)
            ? Math.max(0.5, num(settings.stickWidth, POP.TOP_STICK_WIDTH))
            : POP.TOP_STICK_WIDTH;

        // ---- Outward lollipops / spikes ---------------------------------
        // Top-N mode: the highlighted items are drawn inward instead of outward.
        // Dual mode: every item gets a bare outward spike (no dot).
        var outwardEntries = layout.items.filter(function(entry) { return !isTop(entry); });

        var sticks = this.mainGroup.append('g').attr('class', 'lollipop-items');

        var itemGroups = sticks.selectAll('.lollipop-item')
            .data(outwardEntries)
            .enter()
            .append('g')
            .attr('class', 'lollipop-item')
            .style('cursor', 'pointer')
            .style('opacity', function(d) { return itemOpacity(d.item, d.group); });

        itemGroups.append('line')
            .attr('class', 'lollipop-stick')
            .attr('x1', function(d) { return polarToXY(ringOuterOf(d.group.name), d.angle)[0]; })
            .attr('y1', function(d) { return polarToXY(ringOuterOf(d.group.name), d.angle)[1]; })
            .attr('x2', function(d) {
                return polarToXY(ringOuterOf(d.group.name) + stickLength(d.item.value1), d.angle)[0];
            })
            .attr('y2', function(d) {
                return polarToXY(ringOuterOf(d.group.name) + stickLength(d.item.value1), d.angle)[1];
            })
            .attr('stroke', function(d) { return groupColor(d.group.name); })
            .attr('stroke-width', stickWidth)
            .attr('stroke-linecap', 'round');

        // Dual mode spikes stay bare - the dot encoding moves inward. Top-N mode
        // can drop its tip dots too, for a bare radial spike chart.
        if (!isDual && settings.showDots !== false) {
            itemGroups.append('circle')
                .attr('class', 'lollipop-dot')
                .attr('cx', function(d) {
                    return polarToXY(ringOuterOf(d.group.name) + stickLength(d.item.value1), d.angle)[0];
                })
                .attr('cy', function(d) {
                    return polarToXY(ringOuterOf(d.group.name) + stickLength(d.item.value1), d.angle)[1];
                })
                .attr('r', function(d) { return dotRadius(d.item); })
                .attr('fill', function(d) { return groupColor(d.group.name); });
        }

        this.attachInteractions(itemGroups, data, settings, callbacks, selectionActive);

        // ---- Dual mode: inward stick + bubble per item -------------------
        if (isDual) {
            this.renderDualInward({
                layout: layout,
                data: data,
                settings: settings,
                callbacks: callbacks,
                selectionActive: selectionActive,
                itemOpacity: itemOpacity,
                groupColor: groupColor,
                textColor: textColor,
                backgroundColor: backgroundColor,
                bubblePosRadius: bubblePosRadius,
                labelPlacement: labelPlacement,
                inwardLength: dualInwardLength,
                bubbleRadius: dualBubbleRadius,
                bubblePos: dualBubblePos,
                innerMax: innerMax,
                maxBubbleRadius: maxBubbleRadius,
                maxValue2: maxValue2,
                maxValue3: maxValue3,
                hasMeasure3: hasMeasure3,
                dotMin: dotMin,
                scaleMode: scaleMode,
                inwardScaleMode: inwardScaleMode,
                inwardStickWidth: inwardStickWidth,
                labelSize: labelSize,
                ringInnerOf: ringInnerOf,
                r0: r0
            });
        }

        // ---- Top-N inward highlight ------------------------------------
        if (topEntries.length > 0) {
            var topBubbleRadius = function(item) { return topBubbleRadiusOf({ item: item }); };
            var topBubbleRadiusPos = topBubblePosOf;

            var topGroup = this.mainGroup.append('g').attr('class', 'lollipop-top-items');

            var topItemGroups = topGroup.selectAll('.lollipop-top-item')
                .data(topEntries)
                .enter()
                .append('g')
                .attr('class', 'lollipop-item lollipop-top-item')
                .style('cursor', 'pointer')
                .style('opacity', function(d) { return itemOpacity(d.item, d.group); });

            topItemGroups.append('line')
                .attr('class', 'lollipop-stick lollipop-top-stick')
                .attr('x1', function(d) { return polarToXY(ringInnerOf(d.group.name), d.angle)[0]; })
                .attr('y1', function(d) { return polarToXY(ringInnerOf(d.group.name), d.angle)[1]; })
                .attr('x2', function(d) { return polarToXY(topBubbleRadiusPos(d), d.angle)[0]; })
                .attr('y2', function(d) { return polarToXY(topBubbleRadiusPos(d), d.angle)[1]; })
                .attr('stroke', function(d) { return groupColor(d.group.name); })
                .attr('stroke-width', inwardStickWidth)
                .attr('stroke-linecap', 'round');

            topItemGroups.append('circle')
                .attr('class', 'lollipop-bubble')
                .attr('cx', function(d) { return polarToXY(topBubbleRadiusPos(d), d.angle)[0]; })
                .attr('cy', function(d) { return polarToXY(topBubbleRadiusPos(d), d.angle)[1]; })
                .attr('r', function(d) { return topBubbleRadius(d.item); })
                .attr('fill', function(d) { return groupColor(d.group.name); })
                .attr('fill-opacity', 0.9);

            function topLabelPlacement(entry) {
                return labelPlacement(entry.angle, topBubbleRadiusPos(entry), topBubbleRadius(entry.item));
            }

            if (settings.showTopLabels !== false) {
                function topLabelText(item) {
                    return (hasMeasure2 && item.text2) ? item.text2 : item.text1;
                }

                // Dense charts crowd these labels together near the centre, so run the
                // same collision pass as dual mode: largest rank first (name as
                // tie-break, for a deterministic result), and drop any label whose
                // estimated box hits one already placed.
                var topLabelCandidates = topEntries.slice().sort(function(a, b) {
                    var diff = rankValue(b.item) - rankValue(a.item);
                    if (diff !== 0) return diff;
                    return String(a.item.name).localeCompare(String(b.item.name));
                });

                var topPlacedBoxes = [];
                var topLabelKeys = {};
                var topLabelsSkipped = 0;

                topLabelCandidates.forEach(function(entry) {
                    var text = topLabelText(entry.item);
                    if (!text) return;

                    var box = labelBox(topLabelPlacement(entry), text, labelSize);

                    for (var i = 0; i < topPlacedBoxes.length; i++) {
                        if (boxesIntersect(box, topPlacedBoxes[i])) {
                            topLabelsSkipped++;
                            return;
                        }
                    }
                    topPlacedBoxes.push(box);
                    topLabelKeys[entry.item.elemNo + '|' + entry.item.name] = true;
                });

                if (window.LOLLIPOP_DEBUG && topLabelsSkipped > 0) {
                    console.log('[RadialLollipopRenderer] Skipped', topLabelsSkipped, 'colliding top-N label(s)');
                }

                topItemGroups
                    .filter(function(d) {
                        return topLabelKeys[d.item.elemNo + '|' + d.item.name] === true;
                    })
                    .append('text')
                    .attr('class', 'lollipop-top-label')
                    .attr('x', function(d) { return topLabelPlacement(d).x; })
                    .attr('y', function(d) { return topLabelPlacement(d).y; })
                    .style('text-anchor', function(d) { return topLabelPlacement(d).anchor; })
                    .style('dominant-baseline', function(d) { return topLabelPlacement(d).baseline; })
                    .style('fill', function(d) { return groupColor(d.group.name); })
                    .style('stroke', '#FFFFFF')
                    .style('stroke-width', 3)
                    .style('stroke-linejoin', 'round')
                    .style('paint-order', 'stroke')
                    .style('font-size', labelSize + 'px')
                    .style('font-family', 'sans-serif')
                    .style('font-weight', '600')
                    .style('pointer-events', 'none')
                    .text(function(d) {
                        return (hasMeasure2 && d.item.text2) ? d.item.text2 : d.item.text1;
                    });
            }

            this.attachInteractions(topItemGroups, data, settings, callbacks, selectionActive);
        }

        // ---- Overlays: stamp, encoding key, group legend ------------------
        var stampCentered = settings.stampPosition === 'center';
        var stampLayout = computeStampLayout(settings, width, height, {
            centered: stampCentered,
            hollowRadius: r0
        });
        this.renderStamp(stampLayout, translateX, translateY, textColor);

        var keyRows = encodingGuideVisible(settings, vizMode) ? buildEncodingRows(data) : [];

        // Explicit overlay font sizes feed the SAME variables the auto sizes do, so
        // row heights, the stack arithmetic, the glyph proportions and the label
        // width estimates all follow from one number each - no parallel path.
        var explicitKeyFont = num(settings.keyFontSize, 0);
        var keyFontSize = explicitKeyFont > 0
            ? explicitKeyFont
            : clampNum(R * 0.03, GEO.KEY_FONT_MIN, GEO.KEY_FONT_MAX);
        // Only an explicit font rescales the figure; auto keeps today's constants
        var keyGlyphScale = explicitKeyFont > 0 ? keyFontSize / GEO.KEY_FONT_BASE : 1;

        var showLegend = settings.showLegend !== false && data.groups.length >= 2;
        var explicitLegendFont = num(settings.legendFontSize, 0);
        var legendFontSize = explicitLegendFont > 0
            ? explicitLegendFont
            : clampNum(R * GEO.LEGEND_FONT_RATIO, GEO.LEGEND_FONT_MIN, GEO.LEGEND_FONT_MAX);
        var legendRowHeight = legendFontSize * GEO.LEGEND_ROW_RATIO;

        // Shared typography for both overlays. Colour falls back
        // icon -> text -> the automatic contrast colour.
        // Optionally paint Qlik's object chrome to match the canvas; when off, any
        // previous patch is undone so the DOM returns to its untouched state.
        if (settings.fillContainer === true) {
            this.applyContainerFill(backgroundColor);
        } else {
            this.restoreContainerFill();
        }

        var overlayFontFamily = (settings.overlayFontFamily && String(settings.overlayFontFamily).trim())
            || 'sans-serif';
        var overlayTextColor = ColorUtils.getColor(settings.overlayTextColor, textColor);
        var overlayStyle = {
            fontFamily: overlayFontFamily,
            fontWeight: settings.overlayFontWeight || '500',
            textColor: overlayTextColor,
            iconColor: ColorUtils.getColor(settings.overlayIconColor, overlayTextColor)
        };

        // Shrink-to-fit, same pattern as the stamp: if the tallest overlay group
        // cannot clear the insets, scale BOTH overlay fonts by one factor. This
        // only ever fires in cases that would otherwise overflow the viewport, so
        // every layout that already fits is untouched.
        var overlayAvailHeight = Math.max(1, height - 2 * GEO.KEY_INSET);
        var keyBlockHeight = keyRows.length * keyFontSize * GEO.KEY_ROW_RATIO;
        var legendBlockHeight = showLegend ? data.groups.length * legendRowHeight : 0;
        var keyPosition = settings.keyPosition || CONSTANTS.OVERLAY_POSITIONS.TOP_RIGHT;
        var legendPosition = settings.legendPosition || CONSTANTS.OVERLAY_POSITIONS.BOTTOM_RIGHT;
        var tallestGroup = (keyRows.length > 0 && showLegend && keyPosition === legendPosition)
            ? keyBlockHeight + GEO.OVERLAY_STACK_GAP + legendBlockHeight
            : Math.max(keyBlockHeight, legendBlockHeight);

        if (tallestGroup > overlayAvailHeight) {
            var overlayShrink = overlayAvailHeight / tallestGroup;
            keyFontSize *= overlayShrink;
            legendFontSize *= overlayShrink;
            legendRowHeight = legendFontSize * GEO.LEGEND_ROW_RATIO;
            keyGlyphScale = explicitKeyFont > 0 ? keyFontSize / GEO.KEY_FONT_BASE : 1;
        }

        // Both overlays are placed together so that sharing a position stacks them
        // instead of overlapping, and so a bottom-right stack clears the stamp.
        var overlayEntries = [];
        if (keyRows.length > 0) {
            overlayEntries.push({
                id: 'key',
                position: settings.keyPosition || CONSTANTS.OVERLAY_POSITIONS.TOP_RIGHT,
                height: keyRows.length * keyFontSize * GEO.KEY_ROW_RATIO
            });
        }
        if (showLegend) {
            overlayEntries.push({
                id: 'legend',
                position: settings.legendPosition || CONSTANTS.OVERLAY_POSITIONS.BOTTOM_RIGHT,
                height: data.groups.length * legendRowHeight
            });
        }

        var overlays = layoutOverlayStack({
            width: width,
            height: height,
            // Only a bottom-right stamp displaces the overlay stack; a centred one
            // lives in the hollow and leaves the corner free.
            stampLayout: stampCentered ? null : stampLayout,
            entries: overlayEntries
        });

        if (keyRows.length > 0 && overlays.key) {
            this.renderEncodingKey({
                rows: keyRows,
                fontSize: keyFontSize,
                glyphScale: keyGlyphScale,
                placement: overlays.key,
                textColor: overlayStyle.textColor,
                iconColor: overlayStyle.iconColor,
                fontFamily: overlayStyle.fontFamily,
                fontWeight: overlayStyle.fontWeight,
                backgroundColor: backgroundColor,
                width: width,
                height: height
            });
        }

        if (showLegend && overlays.legend) {
            this.renderLegend(data.groups, groupColor, overlayStyle.textColor, overlays.legend, {
                fontSize: legendFontSize,
                rowHeight: legendRowHeight,
                fontFamily: overlayStyle.fontFamily,
                fontWeight: overlayStyle.fontWeight
            });
        }

        // ---- Intro animation (first paint of this renderer only) ----------
        if (settings.introAnimation !== false && !this._introPlayed) {
            this._introPlayed = true;
            this.playIntro({ startAngle: startAngle, endAngle: endAngle });
        }
    };

    /**
     * Dual-measure mode: every item with a second measure also gets an inward
     * stick reaching toward the centre, ending in a bubble sized by measure 3
     * (or measure 2 when there is no third measure). Only the largest few get a
     * value label, and colliding labels are dropped.
     */
    RadialLollipopRenderer.prototype.renderDualInward = function(ctx) {
        var self = this;
        var settings = ctx.settings;
        var r0 = ctx.r0;

        // Items without a second measure keep their outward spike only
        var inwardEntries = ctx.layout.items.filter(function(entry) {
            return entry.item.value2 !== null && entry.item.value2 !== undefined;
        });
        if (inwardEntries.length === 0) return;

        // Geometry is owned by render() and shared with the edge-alignment pass,
        // so both measure and draw with the same functions.
        var bubbleRadius = ctx.bubbleRadius;
        var bubblePos = ctx.bubblePos;

        var inwardGroup = this.mainGroup.append('g').attr('class', 'lollipop-inward-items');

        var inwardGroups = inwardGroup.selectAll('.lollipop-inward-item')
            .data(inwardEntries)
            .enter()
            .append('g')
            .attr('class', 'lollipop-item lollipop-inward-item')
            .style('cursor', 'pointer')
            .style('opacity', function(d) { return ctx.itemOpacity(d.item, d.group); });

        inwardGroups.append('line')
            .attr('class', 'lollipop-stick lollipop-inward-stick')
            .attr('x1', function(d) { return polarToXY(ctx.ringInnerOf(d.group.name), d.angle)[0]; })
            .attr('y1', function(d) { return polarToXY(ctx.ringInnerOf(d.group.name), d.angle)[1]; })
            .attr('x2', function(d) { return polarToXY(bubblePos(d), d.angle)[0]; })
            .attr('y2', function(d) { return polarToXY(bubblePos(d), d.angle)[1]; })
            .attr('stroke', function(d) { return ctx.groupColor(d.group.name); })
            .attr('stroke-width', ctx.inwardStickWidth)
            .attr('stroke-linecap', 'round');

        inwardGroups.append('circle')
            .attr('class', 'lollipop-bubble')
            .attr('cx', function(d) { return polarToXY(bubblePos(d), d.angle)[0]; })
            .attr('cy', function(d) { return polarToXY(bubblePos(d), d.angle)[1]; })
            .attr('r', function(d) { return bubbleRadius(d.item); })
            .attr('fill', function(d) { return ctx.groupColor(d.group.name); })
            .attr('fill-opacity', 0.9);

        this.attachInteractions(inwardGroups, ctx.data, settings, ctx.callbacks, ctx.selectionActive);

        // ---- Value labels for the largest few ---------------------------
        var labelTopN = Math.max(0, Math.floor(num(settings.labelTopN, POP.LABEL_TOP_N)));
        if (labelTopN === 0) return;

        // Deterministic order: largest measure 2 first, name as tie-break.
        // Sorted COPY - positions always come from each entry's own angle.
        var candidates = inwardLabelCandidates(inwardEntries, labelTopN);

        var placed = [];
        var skipped = 0;

        candidates.forEach(function(entry) {
            var text = entry.item.text2;
            if (!text) return;

            var placement = ctx.labelPlacement(entry.angle, bubblePos(entry), bubbleRadius(entry.item));
            var box = labelBox(placement, text, ctx.labelSize);

            for (var i = 0; i < placed.length; i++) {
                if (boxesIntersect(box, placed[i].box)) {
                    skipped++;
                    return;
                }
            }
            placed.push({ entry: entry, placement: placement, box: box, text: text });
        });

        if (window.LOLLIPOP_DEBUG && skipped > 0) {
            console.log('[RadialLollipopRenderer] Skipped', skipped, 'colliding dual-mode label(s)');
        }

        // Labels live above every bubble, so they go in their own group
        this.mainGroup.append('g')
            .attr('class', 'lollipop-labels')
            .selectAll('.lollipop-top-label')
            .data(placed)
            .enter()
            .append('text')
            .attr('class', 'lollipop-top-label')
            .attr('x', function(d) { return d.placement.x; })
            .attr('y', function(d) { return d.placement.y; })
            .style('text-anchor', function(d) { return d.placement.anchor; })
            .style('dominant-baseline', function(d) { return d.placement.baseline; })
            .style('fill', ctx.textColor)
            .style('stroke', ctx.backgroundColor)
            .style('stroke-width', 3)
            .style('stroke-linejoin', 'round')
            .style('paint-order', 'stroke')
            .style('font-size', ctx.labelSize + 'px')
            .style('font-family', 'sans-serif')
            .style('font-weight', '600')
            .style('pointer-events', 'none')
            .text(function(d) { return d.text; });
    };

    /**
     * First-paint intro animation.
     *
     * Runs once per renderer instance (the entry reuses one renderer for the life
     * of the object on the sheet), so selections, resizes and property edits all
     * repaint instantly. Every transition targets the value the static render
     * already wrote, so the final frame is identical to the static output - which
     * also keeps selection opacities correct when the first paint carries a
     * bookmark.
     */
    RadialLollipopRenderer.prototype.playIntro = function(opts) {
        var d3 = this.d3;
        if (!this.svg) return;

        var T = CONSTANTS.TIMING;
        var lo = Math.min(opts.startAngle, opts.endAngle);
        var hi = Math.max(opts.startAngle, opts.endAngle);
        var span = hi - lo;

        // Stagger is a fixed total SPAN shared by all items, so item count can
        // never stretch the sequence past its budget
        function delayFor(d) {
            var angle = null;
            if (d && typeof d.angle === 'number') angle = d.angle;
            else if (d && d.entry && typeof d.entry.angle === 'number') angle = d.entry.angle;
            if (angle === null || !(span > 0)) return 0;
            var t = (angle - lo) / span;
            if (t < 0) t = 0;
            if (t > 1) t = 1;
            return t * T.INTRO_STAGGER;
        }

        // 1. Ring band, back arc and ticks wash in
        this.svg.selectAll('.lollipop-back-arc, .lollipop-ring-segment, .lollipop-tick')
            .style('opacity', 0)
            .transition()
            .duration(T.INTRO_RING)
            .style('opacity', 1);

        // 2. Sticks grow out of the ring - the drawn endpoints are the targets
        var growStart = T.INTRO_RING;
        this.svg.selectAll('.lollipop-stick').each(function(d) {
            var line = d3.select(this);
            var x2 = line.attr('x2');
            var y2 = line.attr('y2');
            line.attr('x2', line.attr('x1')).attr('y2', line.attr('y1'))
                .transition()
                .delay(growStart + delayFor(d))
                .duration(T.INTRO_GROW)
                .attr('x2', x2)
                .attr('y2', y2);
        });

        // 3. Dots and bubbles pop, overlapping the growth
        this.svg.selectAll('.lollipop-dot, .lollipop-bubble').each(function(d) {
            var circle = d3.select(this);
            var r = circle.attr('r');
            circle.attr('r', 0)
                .transition()
                .delay(growStart + delayFor(d) + T.INTRO_GROW * 0.5)
                .duration(T.INTRO_BUBBLE)
                .attr('r', r);
        });

        // 4. Everything written on top fades in last. These carry no selection
        // opacity of their own, so fading to 1 is safe; the top-N labels sit inside
        // their item group and therefore inherit its (correct) opacity.
        // Overlaps the tail of the growth so the whole sequence lands on budget
        var fadeStart = growStart + T.INTRO_GROW + T.INTRO_STAGGER - T.INTRO_FADE;
        this.svg.selectAll('.lollipop-top-label, .lollipop-stamp, .lollipop-encoding-key')
            .style('opacity', 0)
            .transition()
            .delay(fadeStart)
            .duration(T.INTRO_FADE)
            .style('opacity', 1);

        if (this.legend) {
            this.legend
                .style('opacity', 0)
                .transition()
                .delay(fadeStart)
                .duration(T.INTRO_FADE)
                .style('opacity', 1);
        }
    };

    /**
     * Render the stamp text block in the bottom-right corner of the SVG
     */
    RadialLollipopRenderer.prototype.renderStamp = function(layout, translateX, translateY, textColor) {
        if (!layout || layout.lines.length === 0) return;

        var stamp = this.mainGroup.append('g')
            .attr('class', 'lollipop-stamp')
            .style('pointer-events', 'none');

        // Corner mode undoes mainGroup's translation so the stamp stays pinned to
        // the viewport corner. Centred mode keeps the translation, so the block
        // rides with the chart and lands in its hollow.
        var centered = !!layout.centered;
        var dx = centered ? 0 : translateX;
        var dy = centered ? 0 : translateY;

        layout.lines.forEach(function(line) {
            stamp.append('text')
                .attr('class', line.className)
                .attr('x', line.x - dx)
                .attr('y', line.baseline - dy)
                .style('text-anchor', centered ? 'middle' : 'end')
                .style('fill', textColor)
                .style('font-size', line.size + 'px')
                .style('font-family', 'sans-serif')
                .style('font-weight', 'bold')
                .text(line.text);
        });
    };

    /**
     * Wire hover + click behaviour onto a selection of item groups
     */
    RadialLollipopRenderer.prototype.attachInteractions = function(selection, data, settings, callbacks, selectionActive) {
        var self = this;
        var d3 = this.d3;

        selection
            .on('click', function(event, d) {
                if (callbacks && callbacks.onSelect && d.item.elemNo !== undefined) {
                    // dimension 0 = the item dimension
                    callbacks.onSelect(0, d.item.elemNo, d.item.name);
                }
            })
            .on('mouseover', function(event, d) {
                if (!selectionActive) {
                    d3.select(this).style('opacity', 1);
                }
                if (settings.showTooltip !== false) {
                    self.showTooltip(event, d, data);
                }
            })
            .on('mousemove', function(event) {
                self.tooltip
                    .style('left', (event.pageX + 15) + 'px')
                    .style('top', (event.pageY - 10) + 'px');
            })
            .on('mouseout', function(event, d) {
                if (!selectionActive) {
                    d3.select(this).style('opacity', 1);
                }
                self.tooltip.style('opacity', 0);
            });
    };

    /**
     * Ring segments select the GROUP dimension (dimension 1).
     *
     * Attached to the individual arc paths, not to their container group, and the
     * ring is drawn before the sticks and dots - so a click that lands on a stick
     * hits the stick, never the arc beneath it. The two paths are siblings rather
     * than nested, so no stopPropagation is needed to keep them from double-firing.
     */
    RadialLollipopRenderer.prototype.attachRingInteractions = function(selection, settings, callbacks, selectionActive) {
        var self = this;
        var d3 = this.d3;

        selection
            .on('click', function(event, d) {
                var group = d.group || {};
                if (callbacks && callbacks.onSelect &&
                    group.groupElemNo !== undefined && group.groupElemNo !== null) {
                    // dimension 1 = the group dimension
                    callbacks.onSelect(1, group.groupElemNo, d.name);
                }
            })
            .on('mouseover', function(event, d) {
                if (!selectionActive) {
                    d3.select(this).attr('fill-opacity', 1);
                }
                if (settings.showTooltip !== false) {
                    self.showRingTooltip(event, d);
                }
            })
            .on('mousemove', function(event) {
                if (self.tooltip) {
                    self.tooltip
                        .style('left', (event.pageX + 15) + 'px')
                        .style('top', (event.pageY - 10) + 'px');
                }
            })
            .on('mouseout', function(event, d) {
                if (!selectionActive) {
                    d3.select(this).attr('fill-opacity', 0.95);
                }
                if (self.tooltip) self.tooltip.style('opacity', 0);
            });
    };

    /**
     * Tooltip for a ring segment: the group and how many items it holds
     */
    RadialLollipopRenderer.prototype.showRingTooltip = function(event, d) {
        if (!this.tooltip) return;

        var group = d.group || {};
        var count = (group.items || []).length;
        var html = '<strong>' + escapeHtml(d.name) + '</strong>' +
            '<br><span style="color:#aaa">' + count + (count === 1 ? ' item' : ' items') + '</span>';

        this.tooltip
            .html(html)
            .style('opacity', 1)
            .style('left', (event.pageX + 15) + 'px')
            .style('top', (event.pageY - 10) + 'px');
    };

    /**
     * Show tooltip
     */
    RadialLollipopRenderer.prototype.showTooltip = function(event, d, data) {
        if (!this.tooltip) return;

        var item = d.item;
        var labels = (data && data.measureLabels) || [];

        var html = '<strong>' + escapeHtml(item.name) + '</strong>';
        if (item.group && data && data.groups && data.groups.length > 1) {
            html += '<br><span style="color:#aaa">' + escapeHtml(item.group) + '</span>';
        }
        html += '<br>' + escapeHtml(labels[0] || 'Value') + ': ' + escapeHtml(item.text1);
        if (item.value2 !== null && item.value2 !== undefined) {
            html += '<br>' + escapeHtml(labels[1] || 'Size') + ': ' + escapeHtml(item.text2);
        }

        this.tooltip
            .html(html)
            .style('opacity', 1)
            .style('left', (event.pageX + 15) + 'px')
            .style('top', (event.pageY - 10) + 'px');
    };

    /**
     * Render the HTML legend overlay (bottom-right)
     */
    RadialLollipopRenderer.prototype.renderLegend = function(groups, groupColor, textColor, placement, sizing) {
        var d3 = this.d3;

        this.removeLegend();

        placement = placement || { top: 0, horizontal: 'right', inset: GEO.LEGEND_INSET };
        sizing = sizing || {};
        var fontSize = sizing.fontSize || GEO.LEGEND_FONT_MIN;
        var rowHeight = sizing.rowHeight || fontSize * GEO.LEGEND_ROW_RATIO;
        var swatch = clampNum(fontSize * 0.7, GEO.LEGEND_SWATCH_MIN, GEO.LEGEND_SWATCH_MAX);
        var onLeft = placement.horizontal === 'left';
        var inset = placement.inset === undefined ? GEO.LEGEND_INSET : placement.inset;
        // Nudge the block inward so the swatch centres share the key figure's
        // vertical axis (glyph column centre = inset + KEY_GLYPH_WIDTH / 2)
        var edgeOffset = inset + Math.max(0, (GEO.KEY_GLYPH_WIDTH - swatch) / 2);

        this.legend = d3.select(this.container)
            .append('div')
            .attr('class', 'lollipop-legend')
            .style('color', textColor)
            // Positioned from the resolved stack slot; row height is pinned so the
            // block's height is exactly rows x rowHeight, which is what the stack
            // arithmetic assumed.
            .style('top', placement.top + 'px')
            .style('bottom', 'auto')
            .style('left', onLeft ? edgeOffset + 'px' : 'auto')
            .style('right', onLeft ? 'auto' : edgeOffset + 'px')
            .style('align-items', onLeft ? 'flex-start' : 'flex-end')
            .style('gap', '0px')
            .style('font-size', fontSize + 'px')
            .style('font-family', sizing.fontFamily || 'sans-serif')
            .style('font-weight', sizing.fontWeight || 500);

        var rows = this.legend.selectAll('.lollipop-legend-item')
            .data(groups)
            .enter()
            .append('div')
            .attr('class', 'lollipop-legend-item')
            .style('height', rowHeight + 'px')
            .style('line-height', rowHeight + 'px')
            .style('gap', GEO.LEGEND_SWATCH_GAP + 'px')
            // Swatch on the outer edge, mirroring the key
            .style('flex-direction', onLeft ? 'row' : 'row-reverse');

        rows.append('span')
            .attr('class', 'lollipop-legend-swatch')
            .style('width', swatch + 'px')
            .style('height', swatch + 'px')
            .style('background-color', function(d) { return groupColor(d.name); });

        rows.append('span')
            .attr('class', 'lollipop-legend-label')
            .text(function(d) { return d.name; });
    };

    /**
     * Render the dual-mode key: right-aligned rows in the top-right corner, each
     * naming a field and ending in a small glyph of the mark that encodes it.
     *
     * Drawn straight onto the svg, NOT into mainGroup, so auto-centering does not
     * drag it around - it stays pinned to the viewport corner like the stamp.
     */
    RadialLollipopRenderer.prototype.renderEncodingKey = function(ctx) {
        var placement = ctx.placement || { horizontal: 'right', top: GEO.KEY_INSET };
        var fontSize = ctx.fontSize;
        var layout = layoutEncodingKey(
            ctx.rows, ctx.width, ctx.height, fontSize,
            placement.horizontal, placement.top, ctx.glyphScale
        );
        if (!layout) return;

        var key = this.svg.append('g')
            .attr('class', 'lollipop-encoding-key')
            .style('pointer-events', 'none');

        // Figure and leader dashes follow the icon colour; the titles follow the
        // text colour. Identical unless the user overrides one of them.
        var stroke = ctx.iconColor || ctx.textColor;
        var g = layout.glyph;

        // ---- One composite figure: spike, ring band, inward stick, bubble ----
        var figure = key.append('g').attr('class', 'lollipop-encoding-figure');

        // (1) thin outward spike, rising from the band
        figure.append('line')
            .attr('class', 'lollipop-key-spike')
            .attr('x1', g.cx).attr('y1', g.spikeTop)
            .attr('x2', g.cx).attr('y2', g.bandY - g.bandDome - g.gapUnit)
            .attr('stroke', stroke)
            .attr('stroke-width', 1.5 * g.strokeScale)
            .attr('stroke-linecap', 'round');

        // (2) the ring, as the shallow dome it is on the chart
        figure.append('path')
            .attr('class', 'lollipop-key-band')
            .attr('d', 'M' + (g.cx - g.bandWidth / 2) + ',' + g.bandY +
                ' Q' + g.cx + ',' + (g.bandY - g.bandDome) +
                ' ' + (g.cx + g.bandWidth / 2) + ',' + g.bandY)
            .attr('fill', 'none')
            .attr('stroke', stroke)
            .attr('stroke-width', 3 * g.strokeScale)
            .attr('stroke-linecap', 'round');

        // (3) inward stick, descending from the band to the bubble
        figure.append('line')
            .attr('class', 'lollipop-key-stick')
            .attr('x1', g.cx).attr('y1', g.bandY + g.gapUnit)
            .attr('x2', g.cx).attr('y2', g.bubbleY)
            .attr('stroke', stroke)
            .attr('stroke-width', 1.5 * g.strokeScale)
            .attr('stroke-linecap', 'round');

        // (4) the bubble at its tip
        figure.append('circle')
            .attr('class', 'lollipop-key-bubble')
            .attr('cx', g.cx).attr('cy', g.bubbleY)
            .attr('r', g.bubbleR)
            .attr('fill', stroke);

        // ---- Rows: leader dash + title ----------------------------------
        layout.rows.forEach(function(row) {
            key.append('line')
                .attr('class', 'lollipop-encoding-dash')
                .attr('x1', row.dashX0).attr('y1', row.centreY)
                .attr('x2', row.dashX1).attr('y2', row.centreY)
                .attr('stroke', stroke)
                .attr('stroke-opacity', 0.7)
                .attr('stroke-width', 1.5 * g.strokeScale)
                .attr('stroke-linecap', 'round');

            key.append('text')
                .attr('class', 'lollipop-encoding-label')
                .attr('x', row.textX)
                .attr('y', row.baseline)
                .style('text-anchor', row.anchor)
                .style('fill', ctx.textColor)
                .style('fill-opacity', 0.85)
                // Same knockout the value labels use, so the key stays readable
                // if the chart grows under it
                .style('stroke', ctx.backgroundColor)
                .style('stroke-width', 3)
                .style('stroke-linejoin', 'round')
                .style('paint-order', 'stroke')
                .style('font-size', fontSize + 'px')
                .style('font-family', ctx.fontFamily || 'sans-serif')
                .style('font-weight', ctx.fontWeight || 500)
                .text(row.text);
        });
    };

    /**
     * Remove the legend overlay if present
     */
    RadialLollipopRenderer.prototype.removeLegend = function() {
        if (this.legend) {
            this.legend.remove();
            this.legend = null;
        }
    };

    /**
     * Destroy renderer
     */
    /**
     * Paint the object chrome behind the chart so a dark canvas is not framed in
     * white. Every change is recorded first, so restoreContainerFill() puts the DOM
     * back exactly as it was - including removing properties that had no inline
     * value to begin with.
     */
    RadialLollipopRenderer.prototype.applyContainerFill = function(backgroundColor) {
        // Undo the previous patch first so a colour change cannot stack
        this.restoreContainerFill();
        if (!this.container || !backgroundColor) return;

        var targets = collectContainerFillTargets(this.container, GEO.CONTAINER_FILL_MAX_DEPTH);
        if (targets.length === 0) {
            if (typeof window !== 'undefined' && window.LOLLIPOP_DEBUG) {
                console.log('[RadialLollipopRenderer] No object-chrome ancestor matched; container fill skipped');
            }
            return;
        }

        var patches = [];

        function patch(element, property, value) {
            patches.push({
                element: element,
                property: property,
                value: element.style.getPropertyValue(property),
                priority: element.style.getPropertyPriority(property)
            });
            element.style.setProperty(property, value);
        }

        targets.forEach(function(target) {
            patch(target.element, 'background-color', backgroundColor);
            // Only the inner object carries the visible padding band
            if (target.padding) {
                patch(target.element, 'padding', '0px');
            }
        });

        this._containerFillPatches = patches;
    };

    /**
     * Put every element touched by applyContainerFill back to its original inline
     * state. Safe to call when nothing was patched.
     */
    RadialLollipopRenderer.prototype.restoreContainerFill = function() {
        var patches = this._containerFillPatches;
        if (!patches || patches.length === 0) return;

        // Unwind in reverse so multiple properties on one element restore cleanly
        for (var i = patches.length - 1; i >= 0; i--) {
            var p = patches[i];
            if (!p.element || !p.element.style) continue;
            if (p.value) {
                p.element.style.setProperty(p.property, p.value, p.priority);
            } else {
                p.element.style.removeProperty(p.property);
            }
        }
        this._containerFillPatches = [];
    };

    RadialLollipopRenderer.prototype.destroy = function() {
        // Clean up tooltip by ID
        if (this._rendererId) {
            this.d3.select('#tooltip-' + this._rendererId).remove();
        }
        if (this.tooltip) {
            this.tooltip.remove();
            this.tooltip = null;
        }
        this.removeLegend();
        this.restoreContainerFill();
        if (this.svg) {
            this.svg.remove();
            this.svg = null;
        }
    };

    return {
        RadialLollipopRenderer: RadialLollipopRenderer,
        polarToXY: polarToXY,
        toRadians: toRadians,
        resolveAngles: resolveAngles,
        resolveVizMode: resolveVizMode,
        shapeT: shapeT,
        computeStampLayout: computeStampLayout,
        collectContainerFillTargets: collectContainerFillTargets,
        classNameOf: classNameOf,
        hasClassToken: hasClassToken,
        envelopeBBox: envelopeBBox,
        buildEncodingRows: buildEncodingRows,
        encodingGuideVisible: encodingGuideVisible,
        layoutEncodingKey: layoutEncodingKey,
        layoutOverlayStack: layoutOverlayStack,
        resolvePlacement: resolvePlacement,
        labelOvershoot: labelOvershoot,
        labelBox: labelBox,
        boxesIntersect: boxesIntersect,
        computeLayout: computeLayout
    };
});
