/**
 * qlik-raidal-lolipop-colors.js
 * Color utilities and management for Radial Lollipop
 */
define(['./qlik-raidal-lolipop-constants'], function(CONSTANTS) {
    'use strict';

    /**
     * Extract color from Qlik color picker object
     */
    function getColor(colorObj, defaultColor) {
        if (colorObj && colorObj.color) {
            return colorObj.color;
        }
        return defaultColor || CONSTANTS.COLORS.SINGLE;
    }

    /**
     * Convert ARGB number to hex color
     */
    function argbToHex(argb) {
        if (argb < 0) {
            argb = argb >>> 0;
        }
        var r = (argb >> 16) & 0xFF;
        var g = (argb >> 8) & 0xFF;
        var b = argb & 0xFF;
        return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }

    /**
     * Extract color value from various Qlik color formats
     */
    function extractColorValue(colorEntry) {
        if (!colorEntry) return null;
        if (typeof colorEntry === 'string') return colorEntry;
        if (colorEntry.color) return colorEntry.color;
        if (colorEntry.qColor) return extractColorValue(colorEntry.qColor);
        if (typeof colorEntry === 'number') return argbToHex(colorEntry);
        if (colorEntry.qNum !== undefined && !isNaN(colorEntry.qNum)) {
            return argbToHex(colorEntry.qNum);
        }
        return null;
    }

    /**
     * Darken a hex color by a percentage
     */
    function darkenColor(hex, percent) {
        var num = parseInt(hex.replace('#', ''), 16);
        var amt = Math.round(2.55 * percent);
        var R = Math.max(0, (num >> 16) - amt);
        var G = Math.max(0, ((num >> 8) & 0x00FF) - amt);
        var B = Math.max(0, (num & 0x0000FF) - amt);
        return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
    }

    /**
     * Lighten a hex color by a percentage
     */
    function lightenColor(hex, percent) {
        var num = parseInt(hex.replace('#', ''), 16);
        var amt = Math.round(2.55 * percent);
        var R = Math.min(255, (num >> 16) + amt);
        var G = Math.min(255, ((num >> 8) & 0x00FF) + amt);
        var B = Math.min(255, (num & 0x0000FF) + amt);
        return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
    }

    /**
     * Get contrasting text color (black or white) for a background
     */
    function getContrastColor(hexColor) {
        // Validate input
        if (!hexColor || typeof hexColor !== 'string') {
            return '#FFFFFF';  // Default to white
        }

        var hex = hexColor.replace('#', '');

        // Validate hex format (3 or 6 characters)
        if (!/^[0-9A-Fa-f]{3}$|^[0-9A-Fa-f]{6}$/.test(hex)) {
            return '#FFFFFF';  // Default to white for invalid colors
        }

        // Expand 3-char hex to 6-char
        if (hex.length === 3) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }

        var r = parseInt(hex.substring(0, 2), 16);
        var g = parseInt(hex.substring(2, 4), 16);
        var b = parseInt(hex.substring(4, 6), 16);

        // Check for NaN (shouldn't happen after validation, but be safe)
        if (isNaN(r) || isNaN(g) || isNaN(b)) {
            return '#FFFFFF';
        }

        var luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance > 0.5 ? '#333333' : '#FFFFFF';
    }

    /**
     * Create a color scale function based on settings
     */
    function createColorScale(settings, groups, masterColors) {
        var colorMode = settings.colorMode || 'auto';
        var palette = CONSTANTS.PALETTES[settings.colorPalette] || CONSTANTS.PALETTES.Q10;

        // Pre-compute group index map for O(1) lookup instead of O(n) indexOf
        var groupIndexMap = {};
        groups.forEach(function(g, i) {
            groupIndexMap[g] = i;
        });

        if (colorMode === 'single') {
            var singleColor = getColor(settings.singleColor, CONSTANTS.COLORS.SINGLE);
            return function() { return singleColor; };
        }

        if (colorMode === 'master' && masterColors) {
            return function(group) {
                if (masterColors[group]) {
                    return masterColors[group];
                }
                var index = groupIndexMap[group] !== undefined ? groupIndexMap[group] : 0;
                return CONSTANTS.COLORS.FALLBACK[index % CONSTANTS.COLORS.FALLBACK.length];
            };
        }

        if (colorMode === 'custom' && settings.customColors) {
            var customColors = {};
            try {
                customColors = JSON.parse(settings.customColors);
            } catch (e) {
                customColors = {};
            }
            return function(group) {
                if (customColors[group]) return customColors[group];
                var index = groupIndexMap[group] !== undefined ? groupIndexMap[group] : 0;
                return palette[index % palette.length];
            };
        }

        // Default: auto mode with palette
        return function(group) {
            var index = groupIndexMap[group] !== undefined ? groupIndexMap[group] : 0;
            return palette[index % palette.length];
        };
    }

    /**
     * Extract colors from master dimension
     */
    function extractMasterDimColors(masterDimLayout, dimensionValues) {
        var colors = {};

        // Check qDim.coloring
        if (masterDimLayout.qDim && masterDimLayout.qDim.coloring) {
            var coloring = masterDimLayout.qDim.coloring;

            if (coloring.colorMap && coloring.colorMap.colors) {
                Object.keys(coloring.colorMap.colors).forEach(function(key) {
                    var colorValue = extractColorValue(coloring.colorMap.colors[key]);
                    if (colorValue) {
                        colors[key] = colorValue;
                        var numKey = parseInt(key, 10);
                        if (!isNaN(numKey) && dimensionValues[numKey]) {
                            colors[dimensionValues[numKey]] = colorValue;
                        }
                    }
                });
            }

            if (coloring.valueColors) {
                coloring.valueColors.forEach(function(vc, index) {
                    if (vc.value && vc.baseColor) {
                        var colorValue = extractColorValue(vc.baseColor);
                        if (colorValue) {
                            colors[vc.value] = colorValue;
                        }
                    } else if (vc.baseColor && dimensionValues[index]) {
                        colors[dimensionValues[index]] = extractColorValue(vc.baseColor);
                    }
                });
            }
        }

        return colors;
    }

    /**
     * Extract colors from ColorMap object
     */
    function extractColorsFromColorMap(colorMapLayout, dimensionValues) {
        var colors = {};

        // colorMap.colors structure
        if (colorMapLayout.colorMap && colorMapLayout.colorMap.colors) {
            var mapColors = colorMapLayout.colorMap.colors;

            if (Array.isArray(mapColors)) {
                mapColors.forEach(function(entry) {
                    if (entry && entry.value) {
                        var colorValue = null;
                        if (entry.baseColor && entry.baseColor.color) {
                            colorValue = entry.baseColor.color;
                        } else if (entry.color) {
                            colorValue = entry.color;
                        } else {
                            colorValue = extractColorValue(entry);
                        }
                        if (colorValue) {
                            colors[entry.value] = colorValue;
                        }
                    }
                });
            } else {
                Object.keys(mapColors).forEach(function(key) {
                    var colorValue = extractColorValue(mapColors[key]);
                    if (colorValue) {
                        colors[key] = colorValue;
                    }
                });
            }
        }

        // qColorMap structure
        if (colorMapLayout.qColorMap && colorMapLayout.qColorMap.colors) {
            Object.keys(colorMapLayout.qColorMap.colors).forEach(function(key) {
                var colorValue = extractColorValue(colorMapLayout.qColorMap.colors[key]);
                if (colorValue && !colors[key]) {
                    colors[key] = colorValue;
                }
            });
        }

        // valueColors structure
        if (colorMapLayout.valueColors) {
            colorMapLayout.valueColors.forEach(function(vc) {
                if (vc.value !== undefined) {
                    var colorValue = extractColorValue(vc.baseColor || vc.color || vc);
                    if (colorValue) {
                        colors[vc.value] = colorValue;
                    }
                }
            });
        }

        return colors;
    }

    // Public API
    return {
        getColor: getColor,
        argbToHex: argbToHex,
        extractColorValue: extractColorValue,
        darkenColor: darkenColor,
        lightenColor: lightenColor,
        getContrastColor: getContrastColor,
        createColorScale: createColorScale,
        extractMasterDimColors: extractMasterDimColors,
        extractColorsFromColorMap: extractColorsFromColorMap
    };
});
