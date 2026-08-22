/**
 * qlik-raidal-lolipop-properties.js
 * Property panel for the Radial Lollipop extension
 */
define([], function() {
    'use strict';

    /**
     * Number of measures currently on the hypercube
     */
    function measureCount(d) {
        return (d && d.qHyperCubeDef && d.qHyperCubeDef.qMeasures) ? d.qHyperCubeDef.qMeasures.length : 0;
    }

    /**
     * Effective mode - mirrors resolveVizMode() in the renderer so the panel
     * shows exactly the settings the chart will actually use.
     */
    function effectiveMode(d) {
        var mode = (d && d.settings && d.settings.vizMode) || 'auto';
        if (measureCount(d) < 2) return 'topn';
        if (mode === 'dual') return 'dual';
        if (mode === 'topn') return 'topn';
        return 'dual';
    }

    return {
        type: 'items',
        component: 'accordion',
        items: {
            // Data
            dimensions: {
                uses: 'dimensions',
                min: 1,
                max: 2,
                items: {
                    info: {
                        component: 'text',
                        style: 'hint',
                        label: 'Dim 1: Item | Dim 2 (optional): Group for colors'
                    }
                }
            },
            measures: {
                uses: 'measures',
                min: 1,
                max: 3,
                items: {
                    info: {
                        component: 'text',
                        style: 'hint',
                        label: 'M1: outward stick | M2: inward stick+bubble (dual mode) / bubble size (top-N mode) | M3: bubble size (dual mode)'
                    }
                }
            },
            // Item order is owned entirely by Qlik's native Sorting section
            sorting: {
                uses: 'sorting'
            },

            // Main Settings
            // Our chart settings live INSIDE Qlik's native Appearance accordion
            // (uses: 'settings' accepts custom items), so the panel shows one
            // Appearance section rather than two.
            appearance: {
                uses: 'settings',
                items: {
                    chartLayout: {
                        type: 'items',
                        label: 'Chart Layout',
                        items: {
                            vizMode: {
                                type: 'string',
                                component: 'dropdown',
                                label: 'Mode',
                                ref: 'settings.vizMode',
                                options: [
                                    { value: 'auto', label: 'Auto' },
                                    { value: 'topn', label: 'Top-N Highlight' },
                                    { value: 'dual', label: 'Dual Measure (Carbon Clock)' }
                                ],
                                defaultValue: 'auto'
                            },
                            arcPreset: {
                                type: 'string',
                                component: 'dropdown',
                                label: 'Arc Sweep',
                                ref: 'settings.arcPreset',
                                options: [
                                    { value: 'full', label: 'Full circle' },
                                    { value: 'half', label: 'Half circle' },
                                    { value: 'quarter', label: 'Quarter circle' },
                                    { value: 'custom', label: 'Custom' }
                                ],
                                defaultValue: 'custom'
                            },
                            startAngle: {
                                type: 'number',
                                label: 'Start Angle (deg)',
                                ref: 'settings.startAngle',
                                defaultValue: -135,
                                min: -180,
                                max: 180,
                                show: function(d) { return !d.settings || !d.settings.arcPreset || d.settings.arcPreset === 'custom'; }
                            },
                            endAngle: {
                                type: 'number',
                                label: 'End Angle (deg)',
                                ref: 'settings.endAngle',
                                defaultValue: 135,
                                min: -180,
                                max: 180,
                                show: function(d) { return !d.settings || !d.settings.arcPreset || d.settings.arcPreset === 'custom'; }
                            },
                            rotation: {
                                type: 'number',
                                label: 'Rotation (deg)',
                                ref: 'settings.rotation',
                                defaultValue: 0,
                                min: -180,
                                max: 180
                            },
                            innerRadius: {
                                type: 'number',
                                component: 'slider',
                                label: 'Ring Radius',
                                ref: 'settings.innerRadius',
                                min: 0.3,
                                max: 0.8,
                                step: 0.05,
                                defaultValue: 0.55
                            },
                            autoCenter: {
                                type: 'boolean',
                                label: 'Auto Center',
                                ref: 'settings.autoCenter',
                                defaultValue: true
                            },
                            alignH: {
                                type: 'string',
                                component: 'dropdown',
                                label: 'Horizontal Align',
                                ref: 'settings.alignH',
                                options: [
                                    { value: 'left', label: 'Left' },
                                    { value: 'center', label: 'Center' },
                                    { value: 'right', label: 'Right' }
                                ],
                                defaultValue: 'center',
                                show: function(d) { return !d.settings || d.settings.autoCenter !== false; }
                            },
                            alignV: {
                                type: 'string',
                                component: 'dropdown',
                                label: 'Vertical Align',
                                ref: 'settings.alignV',
                                options: [
                                    { value: 'top', label: 'Top' },
                                    { value: 'middle', label: 'Middle' },
                                    { value: 'bottom', label: 'Bottom' }
                                ],
                                defaultValue: 'middle',
                                show: function(d) { return !d.settings || d.settings.autoCenter !== false; }
                            }
                        }
                    },
                    ring: {
                        type: 'items',
                        label: 'Ring',
                        items: {
                            showRing: {
                                type: 'boolean',
                                label: 'Show Ring Band',
                                ref: 'settings.showRing',
                                defaultValue: true
                            },
                            ringThickness: {
                                type: 'integer',
                                label: 'Ring Thickness (px, max when weighted)',
                                ref: 'settings.ringThickness',
                                min: 0,
                                max: 60
                            },
                            ringWeight: {
                                type: 'string',
                                component: 'dropdown',
                                label: 'Ring Thickness By',
                                ref: 'settings.ringWeight',
                                options: [
                                    { value: 'uniform', label: 'Uniform' },
                                    { value: 'value', label: 'Group Value' }
                                ],
                                defaultValue: 'uniform'
                            },
                            showTicks: {
                                type: 'boolean',
                                label: 'Show Ring Ticks',
                                ref: 'settings.showTicks',
                                defaultValue: true
                            },
                            showBackArc: {
                                type: 'boolean',
                                label: 'Show Background Arc',
                                ref: 'settings.showBackArc',
                                defaultValue: true
                            }
                        }
                    },
                    sticksBubbles: {
                        type: 'items',
                        label: 'Sticks & Bubbles',
                        items: {
                            stickScale: {
                                type: 'string',
                                component: 'dropdown',
                                label: 'Stick Scale',
                                ref: 'settings.stickScale',
                                options: [
                                    { value: 'linear', label: 'Linear' },
                                    { value: 'sqrt', label: 'Square Root' },
                                    { value: 'log', label: 'Logarithmic' }
                                ],
                                defaultValue: 'linear'
                            },
                            inwardScale: {
                                type: 'string',
                                component: 'dropdown',
                                label: 'Inward Stick Scale',
                                ref: 'settings.inwardScale',
                                options: [
                                    { value: 'inherit', label: 'Same as Stick Scale' },
                                    { value: 'linear', label: 'Linear' },
                                    { value: 'sqrt', label: 'Square Root' },
                                    { value: 'log', label: 'Logarithmic' }
                                ],
                                defaultValue: 'inherit',
                                show: function(d) { return effectiveMode(d) === 'dual'; }
                            },
                            stickWidth: {
                                type: 'number',
                                component: 'slider',
                                label: 'Stick Width (px)',
                                ref: 'settings.stickWidth',
                                min: 0.5,
                                max: 4,
                                step: 0.5,
                                defaultValue: 1.5
                            },
                            showDots: {
                                type: 'boolean',
                                label: 'Show Tip Dots',
                                ref: 'settings.showDots',
                                defaultValue: true,
                                show: function(d) { return effectiveMode(d) !== 'dual'; }
                            },
                            topN: {
                                type: 'integer',
                                label: 'Highlight Top N Inward',
                                ref: 'settings.topN',
                                defaultValue: 3,
                                min: 0,
                                max: 20,
                                show: function(d) { return effectiveMode(d) !== 'dual'; }
                            },
                            showTopLabels: {
                                type: 'boolean',
                                label: 'Show Top N Value Labels',
                                ref: 'settings.showTopLabels',
                                defaultValue: true,
                                show: function(d) {
                                    return effectiveMode(d) !== 'dual' && (!d.settings || d.settings.topN !== 0);
                                }
                            },
                            dotMin: {
                                type: 'number',
                                label: 'Min Dot Radius (px)',
                                ref: 'settings.dotMin',
                                defaultValue: 2,
                                min: 0.5,
                                max: 20
                            },
                            dotMax: {
                                type: 'number',
                                label: 'Max Dot Radius (px)',
                                ref: 'settings.dotMax',
                                defaultValue: 8,
                                min: 1,
                                max: 40
                            }
                        }
                    },
                    labels: {
                        type: 'items',
                        label: 'Labels',
                        items: {
                            labelTopN: {
                                type: 'integer',
                                label: 'Label Top N',
                                ref: 'settings.labelTopN',
                                defaultValue: 4,
                                min: 0,
                                max: 15,
                                show: function(d) { return effectiveMode(d) === 'dual'; }
                            },
                            labelSize: {
                                type: 'number',
                                label: 'Label Size (px, 0 = auto)',
                                ref: 'settings.labelSize',
                                defaultValue: 0,
                                min: 0,
                                max: 32
                            }
                        }
                    },
                    guideLegend: {
                        type: 'items',
                        label: 'Reading Guide & Legend',
                        items: {
                            showEncodingLegend: {
                                type: 'boolean',
                                label: 'Show Reading Guide',
                                ref: 'settings.showEncodingLegend',
                                defaultValue: true,
                                show: function(d) { return effectiveMode(d) === 'dual'; }
                            },
                            keyPosition: {
                                type: 'string',
                                component: 'dropdown',
                                label: 'Reading Guide Position',
                                ref: 'settings.keyPosition',
                                options: [
                                    { value: 'topLeft', label: 'Top Left' },
                                    { value: 'topRight', label: 'Top Right' },
                                    { value: 'middleLeft', label: 'Middle Left' },
                                    { value: 'middleRight', label: 'Middle Right' },
                                    { value: 'bottomLeft', label: 'Bottom Left' },
                                    { value: 'bottomRight', label: 'Bottom Right' }
                                ],
                                defaultValue: 'topRight',
                                show: function(d) {
                                    return effectiveMode(d) === 'dual' &&
                                        (!d.settings || d.settings.showEncodingLegend !== false);
                                }
                            },
                            showLegend: {
                                type: 'boolean',
                                label: 'Show Legend',
                                ref: 'settings.showLegend',
                                defaultValue: true
                            },
                            legendPosition: {
                                type: 'string',
                                component: 'dropdown',
                                label: 'Legend Position',
                                ref: 'settings.legendPosition',
                                options: [
                                    { value: 'topLeft', label: 'Top Left' },
                                    { value: 'topRight', label: 'Top Right' },
                                    { value: 'middleLeft', label: 'Middle Left' },
                                    { value: 'middleRight', label: 'Middle Right' },
                                    { value: 'bottomLeft', label: 'Bottom Left' },
                                    { value: 'bottomRight', label: 'Bottom Right' }
                                ],
                                defaultValue: 'bottomRight',
                                show: function(d) { return !d.settings || d.settings.showLegend !== false; }
                            },
                            keyFontSize: {
                                type: 'number',
                                label: 'Guide Font Size (px, 0 = auto)',
                                ref: 'settings.keyFontSize',
                                defaultValue: 0,
                                min: 0,
                                max: 40,
                                show: function(d) { return effectiveMode(d) === 'dual'; }
                            },
                            legendFontSize: {
                                type: 'number',
                                label: 'Legend Font Size (px, 0 = auto)',
                                ref: 'settings.legendFontSize',
                                defaultValue: 0,
                                min: 0,
                                max: 40,
                                show: function(d) { return !d.settings || d.settings.showLegend !== false; }
                            },
                            overlayFontFamily: {
                                type: 'string',
                                label: 'Guide/Legend Font Family',
                                ref: 'settings.overlayFontFamily',
                                defaultValue: ''
                            },
                            overlayFontWeight: {
                                type: 'string',
                                component: 'dropdown',
                                label: 'Guide/Legend Font Weight',
                                ref: 'settings.overlayFontWeight',
                                options: [
                                    { value: 'normal', label: 'Normal' },
                                    { value: '500', label: 'Medium' },
                                    { value: 'bold', label: 'Bold' }
                                ],
                                defaultValue: '500'
                            },
                            overlayTextColor: {
                                label: 'Guide/Legend Text Color',
                                component: 'color-picker',
                                ref: 'settings.overlayTextColor',
                                type: 'object',
                                defaultValue: { index: -1, color: '' }
                            },
                            overlayIconColor: {
                                label: 'Guide Icon Color',
                                component: 'color-picker',
                                ref: 'settings.overlayIconColor',
                                type: 'object',
                                defaultValue: { index: -1, color: '' },
                                show: function(d) { return effectiveMode(d) === 'dual'; }
                            }
                        }
                    },
                    stamp: {
                        type: 'items',
                        label: 'Stamp',
                        items: {
                            stampPosition: {
                                type: 'string',
                                component: 'dropdown',
                                label: 'Stamp Position',
                                ref: 'settings.stampPosition',
                                options: [
                                    { value: 'bottomRight', label: 'Bottom Right' },
                                    { value: 'center', label: 'Center' }
                                ],
                                defaultValue: 'bottomRight'
                            },
                            stampText: {
                                type: 'string',
                                label: 'Stamp Text (e.g. 2019)',
                                ref: 'settings.stampText',
                                expression: 'optional',
                                defaultValue: ''
                            },
                            stampSubText: {
                                type: 'string',
                                label: 'Stamp Subtext',
                                ref: 'settings.stampSubText',
                                expression: 'optional',
                                defaultValue: ''
                            },
                            stampMaxWidth: {
                                type: 'number',
                                label: 'Stamp Max Width (px, 0 = auto)',
                                ref: 'settings.stampMaxWidth',
                                defaultValue: 0,
                                min: 0,
                                max: 1200
                            }
                        }
                    },
                    animation: {
                        type: 'items',
                        label: 'Animation',
                        items: {
                            introAnimation: {
                                type: 'boolean',
                                label: 'Intro Animation (on load)',
                                ref: 'settings.introAnimation',
                                defaultValue: true
                            }
                        }
                    }
                }
            },

            // Colors
            colors: {
                type: 'items',
                label: 'Colors',
                items: {
                    colorMode: {
                        type: 'string',
                        component: 'dropdown',
                        label: 'Color By',
                        ref: 'settings.colorMode',
                        options: [
                            { value: 'auto', label: 'Automatic Palette' },
                            { value: 'master', label: 'Master Item Colors' },
                            { value: 'single', label: 'Single Color' }
                        ],
                        defaultValue: 'auto'
                    },
                    colorPalette: {
                        type: 'string',
                        component: 'dropdown',
                        label: 'Palette',
                        ref: 'settings.colorPalette',
                        options: [
                            { value: 'carbon', label: 'Carbon' },
                            { value: 'vibrant', label: 'Vibrant' },
                            { value: 'Q10', label: 'Qlik' },
                            { value: 'category10', label: 'D3 Classic' },
                            { value: 'earth', label: 'Earth' },
                            { value: 'ocean', label: 'Ocean' }
                        ],
                        defaultValue: 'carbon',
                        show: function(d) { return !d.settings || d.settings.colorMode === 'auto'; }
                    },
                    singleColor: {
                        label: 'Color',
                        component: 'color-picker',
                        ref: 'settings.singleColor',
                        type: 'object',
                        defaultValue: { index: -1, color: '#4A90D9' },
                        show: function(d) { return d.settings && d.settings.colorMode === 'single'; }
                    },
                    backgroundColor: {
                        label: 'Background',
                        component: 'color-picker',
                        ref: 'settings.backgroundColor',
                        type: 'object',
                        defaultValue: { index: -1, color: '#FFFFFF' }
                    },
                    fillContainer: {
                        type: 'boolean',
                        label: 'Extend Background To Object Edge',
                        ref: 'settings.fillContainer',
                        defaultValue: false
                    }
                }
            },

            // Tooltip
            tooltip: {
                type: 'items',
                label: 'Tooltip',
                items: {
                    showTooltip: {
                        type: 'boolean',
                        label: 'Show Tooltip',
                        ref: 'settings.showTooltip',
                        defaultValue: true
                    }
                }
            },

            // Debug
            debug: {
                type: 'items',
                label: 'Debug',
                items: {
                    enableDebug: {
                        type: 'boolean',
                        component: 'switch',
                        label: 'Enable Console Logging',
                        ref: 'settings.enableDebug',
                        defaultValue: false,
                        options: [
                            { value: true, label: 'On' },
                            { value: false, label: 'Off' }
                        ]
                    }
                }
            },


            addons: {
                uses: 'addons',
                items: {
                    dataHandling: {
                        uses: 'dataHandling'
                    }
                }
            }
        }
    };
});
