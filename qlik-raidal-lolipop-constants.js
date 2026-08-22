/**
 * qlik-raidal-lolipop-constants.js
 * Centralized constants for the Radial Lollipop extension
 */
define([], function() {
    'use strict';

    return {
        // Animation and timing
        TIMING: {
            RESIZE_DEBOUNCE: 300,
            ANIMATION_FAST: 200,
            ANIMATION_MEDIUM: 500,
            ANIMATION_SLOW: 750,
            // Intro animation, first paint only (~900ms end to end)
            INTRO_RING: 250,
            INTRO_GROW: 500,
            INTRO_BUBBLE: 250,
            INTRO_FADE: 200,
            // Total stagger SPAN, not per item - so item count cannot stretch the
            // sequence past its budget however many items there are
            INTRO_STAGGER: 150
        },

        // Radial geometry defaults
        GEOMETRY: {
            START_ANGLE: -135,
            END_ANGLE: 135,
            // Half of the gap kept at the seam of a full-circle sweep so the
            // first and last items do not overlap
            FULL_CIRCLE_GAP: 2,
            INNER_RADIUS: 0.55,
            RING_THICKNESS: 10,
            GROUP_GAP_DEGREES: 2,
            OUTER_MARGIN: 24,
            MIN_STICK_LENGTH: 4,
            MIN_RENDER_SIZE: 120,
            INNER_STICK_RATIO: 0.8,
            TOP_BUBBLE_MAX_RADIUS: 20,
            TOP_LABEL_GAP: 6,
            // Clock texture: tick marks on the ring's inner edge
            TICK_LENGTH: 3,
            // Neutral band drawn under the coloured ring segments
            BACK_ARC_PAD: 2,
            // Stamp text block, inset from the bottom-right corner
            STAMP_INSET: 24,
            STAMP_GAP: 20,
            // Stamp font scales with the chart: clamp(MIN, min(w,h) * RATIO, MAX)
            STAMP_RATIO: 0.06,
            STAMP_MIN: 24,
            STAMP_MAX: 64,
            STAMP_SUB_RATIO: 0.34,
            // Wrapping: auto max width = clamp(MIN, width * RATIO, MAX)
            // Share of the inner radius a centred stamp may occupy
            // How many ancestors the container-fill walk may touch
            CONTAINER_FILL_MAX_DEPTH: 5,
            STAMP_HOLLOW_RATIO: 0.9,
            STAMP_WRAP_RATIO: 0.35,
            STAMP_WRAP_MIN: 240,
            STAMP_WRAP_MAX: 640,
            // Gap between wrapped lines of the same paragraph, in em
            STAMP_LINE_GAP: 0.15,
            // Dual-mode encoding key, pinned to the top-right corner
            KEY_INSET: 20,
            KEY_GLYPH_WIDTH: 30,
            KEY_GLYPH_GAP: 8,
            KEY_ROW_RATIO: 1.7,
            KEY_DASH_LENGTH: 10,
            KEY_DASH_GAP: 6,
            // Baseline font the fixed glyph constants were drawn against; an
            // explicit key font scales the figure relative to this.
            KEY_FONT_BASE: 14,
            KEY_GLYPH_MAX_WIDTH: 64,
            KEY_FONT_MIN: 14,
            KEY_FONT_MAX: 17,
            // Auto centering: how far the radius may grow into freed canvas
            AUTO_CENTER_MAX_SCALE: 1.6,
            // Clearance kept between the legend and the stamp block
            LEGEND_STAMP_GAP: 8,
            // Group legend, sized to sit alongside the key
            LEGEND_INSET: 20,
            LEGEND_FONT_RATIO: 0.028,
            LEGEND_FONT_MIN: 13,
            LEGEND_FONT_MAX: 17,
            LEGEND_ROW_RATIO: 1.7,
            LEGEND_SWATCH_MIN: 10,
            LEGEND_SWATCH_MAX: 12,
            LEGEND_SWATCH_GAP: 8,
            // Vertical gap when the key and the legend share a position
            OVERLAY_STACK_GAP: 14,
            // Auto ring thickness: clamp(MIN, R * RATIO, MAX)
            RING_AUTO_RATIO: 0.045,
            RING_AUTO_MIN: 8,
            RING_AUTO_MAX: 24,
            // Auto label size: clamp(MIN, R * RATIO, MAX)
            LABEL_AUTO_RATIO: 0.035,
            LABEL_AUTO_MIN: 11,
            LABEL_AUTO_MAX: 22
        },

        // Lollipop stick / dot defaults
        LOLLIPOP: {
            STICK_WIDTH: 1,
            TOP_STICK_WIDTH: 1.25,
            // Default outward spike width in dual-measure mode
            DUAL_STICK_WIDTH: 1.5,
            DOT_MIN: 2,
            DOT_MAX: 8,
            DOT_FIXED: 3.5,
            TOP_N: 3,
            // How many dual-mode items get a value label
            LABEL_TOP_N: 4,
            DESELECTED_OPACITY: 0.25,
            TICK_OPACITY: 0.55,
            // Neutral back-arc band fill, chosen by background luminance
            BACK_ARC_LIGHT_OPACITY: 0.07,
            BACK_ARC_DARK_OPACITY: 0.10
        },

        // Rough text metrics used by the label collision pass. Boxes are derived
        // from the ACTUAL font size so collision stays truthful at any label size.
        LABEL_METRICS: {
            CHAR_WIDTH_RATIO: 0.58,
            CHAR_WIDTH: 7,
            LINE_HEIGHT: 12
        },

        // Corner/edge slots an overlay can be anchored to
        OVERLAY_POSITIONS: {
            TOP_LEFT: 'topLeft',
            TOP_RIGHT: 'topRight',
            MIDDLE_LEFT: 'middleLeft',
            MIDDLE_RIGHT: 'middleRight',
            BOTTOM_LEFT: 'bottomLeft',
            BOTTOM_RIGHT: 'bottomRight'
        },

        // Ring thickness weighting modes
        RING_WEIGHTS: {
            UNIFORM: 'uniform',
            VALUE: 'value'
        },

        // Font scaling factors
        FONT_SCALE: {
            LABEL: 0.15,
            VALUE: 0.12,
            GROUP: 0.08,
            MIN_FONT_SIZE: 8,
            MAX_FONT_SIZE: 24,
            TOP_LABEL_SIZE: 11,
            LEGEND_SIZE: 11,
            STAMP_SIZE: 44,
            STAMP_SUB_SIZE: 15
        },

        // Tooltip settings
        TOOLTIP: {
            Z_INDEX: 10000,
            PADDING: '12px 16px',
            BORDER_RADIUS: '6px',
            FONT_SIZE: '13px',
            MAX_WIDTH: '300px'
        },

        // Default appearance values
        DEFAULTS: {
            MAX_ITEMS: 1000,
            LABEL_SIZE: 12,
            VALUE_SIZE: 10,
            GROUP_LABEL_SIZE: 14,
            SHOW_LEGEND: true,
            SHOW_TOP_LABELS: true,
            SORT_MODE: 'valueDesc',
            STICK_SCALE: 'linear'
        },

        // Default colors
        COLORS: {
            BACKGROUND: '#FFFFFF',
            STROKE: '#FFFFFF',
            LABEL: '#FFFFFF',
            VALUE: 'rgba(255,255,255,0.85)',
            GROUP_LABEL: '#333333',
            SINGLE: '#4A90D9',
            FALLBACK: [
                '#4A90D9', '#E85D75', '#50C878', '#FFB347',
                '#9B59B6', '#3498DB', '#E74C3C', '#2ECC71',
                '#F39C12', '#1ABC9C'
            ]
        },

        // Color palettes
        PALETTES: {
            vibrant: [
                '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
                '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
                '#BB8FCE', '#85C1E9'
            ],
            earth: [
                '#8B4513', '#D2691E', '#CD853F', '#DEB887',
                '#F5DEB3', '#D2B48C', '#BC8F8F', '#F4A460',
                '#DAA520', '#B8860B'
            ],
            ocean: [
                '#001f3f', '#0074D9', '#7FDBFF', '#39CCCC',
                '#3D9970', '#2ECC40', '#01FF70', '#FFDC00',
                '#FF851B', '#FF4136'
            ],
            sunset: [
                '#FF6B35', '#F7C59F', '#EFEFD0', '#004E89',
                '#1A659E', '#FF9F1C', '#E71D36', '#2EC4B6',
                '#FFBF69', '#CBF3F0'
            ],
            nordic: [
                '#2E4057', '#048A81', '#54C6EB', '#8EE3EF',
                '#F7F7F7', '#084C61', '#DB504A', '#E3B505',
                '#4F6D7A', '#56A3A6'
            ],
            carbon: [
                '#8E1F6B', '#4BA3D3', '#F2B441', '#E8536B',
                '#5FBF9F', '#7A62C9', '#D97C2B', '#3B7EA1',
                '#C94F8C', '#69A84F'
            ],
            Q10: [
                '#767DF2', '#BF2B17', '#F25C06', '#65AA88',
                '#039289', '#1A778B', '#FA8907', '#F7BB02',
                '#D5BD4B', '#17becf'
            ],
            category10: [
                '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728',
                '#9467bd', '#8c564b', '#e377c2', '#7f7f7f',
                '#bcbd22', '#17becf'
            ],
            category20: [
                '#1f77b4', '#aec7e8', '#ff7f0e', '#ffbb78',
                '#2ca02c', '#98df8a', '#d62728', '#ff9896',
                '#9467bd', '#c5b0d5', '#8c564b', '#c49c94',
                '#e377c2', '#f7b6d2', '#7f7f7f', '#c7c7c7',
                '#bcbd22', '#dbdb8d', '#17becf', '#9edae5'
            ]
        },

        // Visualization modes
        VIZ_MODES: {
            AUTO: 'auto',
            TOPN: 'topn',
            DUAL: 'dual'
        },

        // Arc sweep presets
        ARC_PRESETS: {
            FULL: 'full',
            HALF: 'half',
            QUARTER: 'quarter',
            CUSTOM: 'custom'
        },

        // Item sort modes within a group
        SORT_MODES: {
            VALUE_DESC: 'valueDesc',
            VALUE_ASC: 'valueAsc',
            ALPHA: 'alpha',
            SOURCE: 'source'
        }
    };
});
