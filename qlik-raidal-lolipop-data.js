/**
 * qlik-raidal-lolipop-data.js
 * Data transformation and group building for Radial Lollipop
 */
define([
    './qlik-raidal-lolipop-constants',
    './qlik-raidal-lolipop-colors'
], function(CONSTANTS, ColorUtils) {
    'use strict';

    /**
     * Format large numbers with K/M/B/T suffixes
     */
    function formatLargeNumber(val, decimals) {
        decimals = decimals !== undefined ? decimals : 1;
        if (val >= 1e12) return (val / 1e12).toFixed(decimals) + 'T';
        if (val >= 1e9) return (val / 1e9).toFixed(decimals) + 'B';
        if (val >= 1e6) return (val / 1e6).toFixed(decimals) + 'M';
        if (val >= 1e3) return (val / 1e3).toFixed(decimals) + 'K';
        return val.toFixed(decimals);
    }

    /**
     * Extract a color from a cell's attribute expressions (if any)
     */
    function extractCellColor(cell) {
        if (!cell || !cell.qAttrExps || !cell.qAttrExps.qValues || !Array.isArray(cell.qAttrExps.qValues)) {
            return null;
        }
        for (var i = 0; i < cell.qAttrExps.qValues.length; i++) {
            var attr = cell.qAttrExps.qValues[i];
            if (attr && attr.qText && typeof attr.qText === 'string' && attr.qText.charAt(0) === '#') {
                return attr.qText;
            }
            if (attr && attr.qNum !== undefined && !isNaN(attr.qNum)) {
                return ColorUtils.argbToHex(attr.qNum);
            }
        }
        return null;
    }

    /**
     * Read a measure cell into { value, text, valid }
     * Rows whose measure qNum is null / NaN / '-' are flagged invalid.
     */
    function readMeasure(cell) {
        if (!cell) {
            return { value: null, text: '', valid: false };
        }
        var num = cell.qNum;
        if (num === null || num === undefined || typeof num !== 'number' || isNaN(num)) {
            return { value: null, text: cell.qText || '', valid: false };
        }
        return { value: num, text: cell.qText || '', valid: true };
    }

    /**
     * Build the grouped item model from the Qlik hypercube matrix.
     *
     * @param {Array} matrix - The qMatrix from the hypercube
     * @param {Object} layout - The layout object
     * @param {Object} settings - Extension settings
     * @returns {Object} { groups: [ { name, color, total, items: [...] } ], processedCount, skippedCount, hasMeasure2 }
     */
    function buildItems(matrix, layout, settings) {
        settings = settings || {};

        var dimensionInfo = layout.qHyperCube.qDimensionInfo || [];
        var measureInfo = layout.qHyperCube.qMeasureInfo || [];
        var dimensionCount = dimensionInfo.length;
        var measureCount = measureInfo.length;

        var hasGroupDim = dimensionCount > 1;
        var hasMeasure2 = measureCount > 1;
        var hasMeasure3 = measureCount > 2;

        // With a single dimension there is one implicit group, named after the measure
        var defaultGroupName = (measureInfo[0] && measureInfo[0].qFallbackTitle) || 'All';

        var groupMap = {};
        var groupOrder = [];
        var processedCount = 0;
        var skippedCount = 0;

        matrix.forEach(function(row, rowIndex) {
            // Validate row structure
            if (!Array.isArray(row) || row.length < dimensionCount + measureCount) {
                skippedCount++;
                return;
            }
            if (!row[0]) {
                skippedCount++;
                return;
            }

            // Measure 1 = stick length (required)
            var m1 = readMeasure(row[dimensionCount]);
            if (!m1.valid) {
                skippedCount++;
                return;
            }

            // Negative stick values clamp to zero
            var value1 = m1.value < 0 ? 0 : m1.value;

            // Measure 2 = bubble size (optional, may be missing per-row)
            var value2 = null;
            var text2 = '';
            if (hasMeasure2) {
                var m2 = readMeasure(row[dimensionCount + 1]);
                if (m2.valid) {
                    value2 = m2.value < 0 ? 0 : m2.value;
                    text2 = m2.text;
                }
            }

            // Measure 3 = bubble size in dual mode (optional, may be missing per-row)
            var value3 = null;
            var text3 = '';
            if (hasMeasure3) {
                var m3 = readMeasure(row[dimensionCount + 2]);
                if (m3.valid) {
                    value3 = m3.value < 0 ? 0 : m3.value;
                    text3 = m3.text;
                }
            }

            var itemName = row[0].qText || 'Unknown';
            var groupName = hasGroupDim && row[1] ? (row[1].qText || 'Other') : defaultGroupName;

            // Color from attribute expressions - prefer the group dimension cell
            var itemColor = hasGroupDim ? extractCellColor(row[1]) : extractCellColor(row[0]);

            if (!groupMap[groupName]) {
                groupMap[groupName] = {
                    name: groupName,
                    color: itemColor,
                    total: 0,
                    // Identity of the group's own dimension-2 cell, so the ring
                    // segment can select it. Identical across the group's rows.
                    groupElemNo: (hasGroupDim && row[1]) ? row[1].qElemNumber : null,
                    groupState: (hasGroupDim && row[1]) ? (row[1].qState || 'O') : null,
                    items: []
                };
                groupOrder.push(groupMap[groupName]);
            }
            if (itemColor && !groupMap[groupName].color) {
                groupMap[groupName].color = itemColor;
            }

            var qState = row[0].qState || 'O';

            groupMap[groupName].items.push({
                name: itemName,
                elemNo: row[0].qElemNumber,
                value1: value1,
                text1: m1.text || formatLargeNumber(value1),
                value2: value2,
                text2: text2,
                value3: value3,
                text3: text3,
                group: groupName,
                color: itemColor,
                sourceIndex: rowIndex,
                qState: qState,
                isSelected: qState === 'S' || qState === 'L',
                isExcluded: qState === 'X'
            });

            groupMap[groupName].total += value1;
            processedCount++;
        });

        // Groups ordered by total of measure 1, descending
        groupOrder.sort(function(a, b) { return b.total - a.total; });

        // Items within a group keep the hypercube (source) order: sorting is
        // owned by Qlik's native Sorting section, not by the extension.
        // (Any persisted settings.sortMode from older versions is ignored.)
        groupOrder.forEach(function(group) {
            group.items.sort(function(a, b) { return a.sourceIndex - b.sourceIndex; });
        });

        return {
            groups: groupOrder,
            processedCount: processedCount,
            skippedCount: skippedCount,
            hasMeasure2: hasMeasure2,
            hasMeasure3: hasMeasure3,
            hasGroupDim: hasGroupDim,
            measureCount: measureCount
        };
    }

    /**
     * Get unique dimension values for color mapping
     */
    function getDimensionValues(matrix, dimensionIndex) {
        var values = [];
        var seen = {};

        matrix.forEach(function(row) {
            if (row[dimensionIndex] && row[dimensionIndex].qText && !seen[row[dimensionIndex].qText]) {
                values.push(row[dimensionIndex].qText);
                seen[row[dimensionIndex].qText] = true;
            }
        });

        return values;
    }

    /**
     * Get list of group names from the built model
     */
    function getGroups(model) {
        if (!model || !model.groups) return [];
        return model.groups.map(function(group) {
            return group.name;
        });
    }

    /**
     * Check if there's an active selection in the data
     */
    function hasActiveSelection(matrix, dimensionCount) {
        // Scans EVERY dimension column, not just the first. A pending selection on
        // the group dimension leaves the item cells at 'O', so looking only at
        // column 0 reported "no selection" and nothing dimmed.
        var columns = (typeof dimensionCount === 'number' && dimensionCount > 0)
            ? dimensionCount : 1;

        for (var i = 0; i < matrix.length; i++) {
            var row = matrix[i];
            if (!row) continue;
            for (var c = 0; c < columns; c++) {
                var cell = row[c];
                if (cell && cell.qState && cell.qState !== 'O') {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Get selected elements from matrix
     */
    function getSelectedElements(matrix) {
        var selected = [];
        matrix.forEach(function(row) {
            if (row[0].qState === 'S' || row[0].qState === 'L') {
                selected.push(row[0].qElemNumber);
            }
        });
        return selected;
    }

    // Public API
    return {
        formatLargeNumber: formatLargeNumber,
        buildItems: buildItems,
        getDimensionValues: getDimensionValues,
        getGroups: getGroups,
        hasActiveSelection: hasActiveSelection,
        getSelectedElements: getSelectedElements
    };
});
