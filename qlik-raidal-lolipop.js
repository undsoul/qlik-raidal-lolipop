/**
 * qlik-raidal-lolipop.js
 * Main entry point for the Radial Lollipop Qlik Sense Extension
 *
 * Items are fanned around a large arc, grouped into colored category segments
 * on a thin donut ring band. Each item is a lollipop (radial stick with a dot),
 * and the top ranked items are highlighted inward with large bubbles and labels.
 */
define([
    'qlik',
    'jquery',
    './lib/d3.v7.min',
    './qlik-raidal-lolipop-constants',
    './qlik-raidal-lolipop-colors',
    './qlik-raidal-lolipop-data',
    './qlik-raidal-lolipop-renderer',
    './qlik-raidal-lolipop-properties',
    'css!./qlik-raidal-lolipop-style.css'
], function(qlik, $, d3, CONSTANTS, ColorUtils, DataUtils, RendererModule, properties) {
    'use strict';

    // Verify d3 is loaded (only logs when debug enabled)
    if (window.LOLLIPOP_DEBUG) {
        console.log('[RadialLollipop] d3 version:', d3 && d3.version);
    }

    /**
     * Debug logging utility
     */
    function createDebugLogger(enabled) {
        return function() {
            if (enabled) {
                console.log.apply(console, ['[RadialLollipop]'].concat(Array.prototype.slice.call(arguments)));
            }
        };
    }

    /**
     * Set color state helper
     */
    function setColorState(self, colors, changeHash, isFetching) {
        self._fetchingColors = isFetching || false;
        self._colorsFetched = !isFetching;
        self._masterItemColors = colors || {};
        if (changeHash !== undefined) {
            self._colorChangeHash = changeHash;
        }
    }

    /**
     * Extension definition
     */
    return {
        // Initial hypercube properties
        initialProperties: {
            qHyperCubeDef: {
                qDimensions: [],
                qMeasures: [],
                qInitialDataFetch: [{
                    qWidth: 10,
                    qHeight: 1000
                }],
                qSuppressZero: false,
                qSuppressMissing: true
            },
            showTitles: true,
            title: 'Radial Lollipop'
        },

        // Property panel definition
        definition: properties,

        // Extension capabilities
        support: {
            snapshot: true,
            export: true,
            exportData: true
        },

        /**
         * Main paint function
         */
        paint: function($element, layout) {
            var self = this;
            var app = qlik.currApp();

            // Recursion prevention - limit paint depth
            self._paintDepth = (self._paintDepth || 0) + 1;
            if (self._paintDepth > 5) {
                console.warn('[RadialLollipop] Paint recursion limit reached');
                self._paintDepth = 0;
                return qlik.Promise.resolve();
            }

            // Paint guard to prevent race conditions
            if (self._isPainting) {
                self._needsRepaint = true;
                self._paintDepth--;
                return qlik.Promise.resolve();
            }
            self._isPainting = true;

            // Initialize local selection tracking (for immediate visual feedback)
            if (!self._localSelections) {
                self._localSelections = new Set();
            }
            // Same idea for the group dimension: during a PENDING dim-2 selection
            // Qlik hands us no S states at all, so the ring needs its own local
            // echo exactly like the items have.
            if (!self._localGroupSelections) {
                self._localGroupSelections = new Set();
            }

            // A click repaints synchronously with the SAME cached layout object, in
            // which qSelectionInfo has not caught up yet. Read the flag here and
            // reset it immediately, so it can never survive a paint and can only
            // ever suppress the session clear for that one echo repaint.
            var isLocalEcho = self._localEcho === true;
            self._localEcho = false;

            // Note: We don't block on _fetchingColors anymore
            // Instead we render with fallback colors and repaint when master colors arrive

            // Get settings
            var settings = layout.settings || {};
            window.LOLLIPOP_DEBUG = settings.enableDebug || false;
            var debugLog = createDebugLogger(settings.enableDebug);

            debugLog('Paint called', layout);

            // Get dimensions
            var width = $element.width();
            var height = $element.height();

            // Validate data
            if (!layout.qHyperCube || !layout.qHyperCube.qDataPages || !layout.qHyperCube.qDataPages[0]) {
                $element.html('<div class="lollipop-message">Loading data...</div>');
                return qlik.Promise.resolve();
            }

            var matrix = layout.qHyperCube.qDataPages[0].qMatrix;
            if (!matrix || matrix.length === 0) {
                $element.html('<div class="lollipop-message">No data available. Add a dimension and a measure.</div>');
                return qlik.Promise.resolve();
            }

            // Validate hypercube structure
            if (!layout.qHyperCube.qDimensionInfo || !layout.qHyperCube.qMeasureInfo) {
                $element.html('<div class="lollipop-message">Invalid hypercube structure. Please check configuration.</div>');
                return qlik.Promise.resolve();
            }

            var dimensionCount = layout.qHyperCube.qDimensionInfo.length;
            var measureCount = layout.qHyperCube.qMeasureInfo.length;

            // Validate minimum requirements
            if (dimensionCount < 1) {
                $element.html('<div class="lollipop-message">Add at least one dimension to display the chart.</div>');
                return qlik.Promise.resolve();
            }
            if (measureCount < 1) {
                $element.html('<div class="lollipop-message">Add a measure to display the chart.</div>');
                return qlik.Promise.resolve();
            }

            debugLog('Data:', dimensionCount, 'dimensions,', measureCount, 'measures,', matrix.length, 'rows');

            // Initialize or reuse renderer
            if (!self._renderer) {
                self._renderer = new RendererModule.RadialLollipopRenderer(d3, $element[0], {});
            }

            // Initialize renderer
            self._renderer.init(width, height, settings);

            // Build the grouped item model
            var model = DataUtils.buildItems(matrix, layout, settings);

            debugLog('Items built:', model.processedCount, 'items in', model.groups.length, 'groups,',
                model.skippedCount, 'rows skipped');

            if (model.processedCount === 0) {
                $element.html('<div class="lollipop-message">No valid data to display</div>');
                return qlik.Promise.resolve();
            }

            // Measure labels for the tooltip; dimension labels for the encoding key
            model.measureLabels = layout.qHyperCube.qMeasureInfo.map(function(m) {
                return m.qFallbackTitle || '';
            });
            model.dimensionLabels = layout.qHyperCube.qDimensionInfo.map(function(d) {
                return d.qFallbackTitle || '';
            });

            // Get groups for color scale
            var groups = DataUtils.getGroups(model);

            // Handle color fetching for master items
            var colorMode = settings.colorMode || 'auto';
            var masterItemColors = self._masterItemColors || {};

            // Check if we need to fetch master colors
            var dimInfo = dimensionCount > 1 ? layout.qHyperCube.qDimensionInfo[1] : null;

            // Check if we already have valid cached colors - if so, use them directly
            var hasCachedColors = self._colorsFetched && self._masterItemColors && Object.keys(self._masterItemColors).length > 0;
            if (colorMode === 'master' && hasCachedColors) {
                debugLog('Using cached master colors for rendering');
                masterItemColors = self._masterItemColors;

                // Background check for color changes (non-blocking)
                if (dimInfo && dimInfo.qLibraryId && !self._checkingColors) {
                    self._checkingColors = true;
                    var enigmaAppBg = app.model.enigmaModel;
                    enigmaAppBg.getDimension(dimInfo.qLibraryId)
                        .then(function(masterDim) { return masterDim.getLayout(); })
                        .then(function(masterLayout) {
                            self._checkingColors = false;
                            var currentChangeHash = (masterLayout.qDim && masterLayout.qDim.coloring && masterLayout.qDim.coloring.changeHash) || null;
                            if (currentChangeHash && currentChangeHash !== self._colorChangeHash) {
                                debugLog('Colors changed! Invalidating cache and repainting...');
                                self._colorsFetched = false;
                                self._masterItemColors = {};
                                self._colorChangeHash = null;
                                self.paint($element, layout);
                            }
                        })
                        .catch(function() { self._checkingColors = false; });
                }
            }

            // Check if we need to fetch master colors
            var needsMasterFetch = colorMode === 'master' && dimInfo && dimInfo.qLibraryId && !self._colorsFetched && !self._fetchingColors;

            if (needsMasterFetch) {
                debugLog('Fetching master dimension colors...');
                self._fetchingColors = true;

                // Release paint guard before async operation
                self._isPainting = false;

                var enigmaApp = app.model.enigmaModel;
                var dimensionValues = DataUtils.getDimensionValues(matrix, 1);
                var masterDimRef = null;
                var fetchedColors = {};

                enigmaApp.getDimension(dimInfo.qLibraryId)
                    .then(function(masterDim) {
                        if (!masterDim) {
                            throw new Error('Master dimension not found');
                        }
                        masterDimRef = masterDim;
                        return masterDim.getLayout();
                    })
                    .then(function(masterLayout) {
                        if (!masterLayout) {
                            throw new Error('Master dimension layout not available');
                        }
                        debugLog('Master dimension layout:', masterLayout);

                        var currentChangeHash = (masterLayout.qDim && masterLayout.qDim.coloring && masterLayout.qDim.coloring.changeHash) || null;
                        var colorMapRef = masterLayout.qDim && masterLayout.qDim.coloring && masterLayout.qDim.coloring.colorMapRef;

                        // Strategy 1: Get properties with valueColors
                        return masterDimRef.getProperties().then(function(dimProps) {
                            debugLog('Dimension properties:', dimProps);

                            // Extract valueColors
                            if (dimProps && dimProps.qDim && dimProps.qDim.coloring && dimProps.qDim.coloring.valueColors) {
                                debugLog('Found valueColors!');
                                dimProps.qDim.coloring.valueColors.forEach(function(vc) {
                                    if (vc.value && vc.baseColor) {
                                        var colorValue = ColorUtils.extractColorValue(vc.baseColor);
                                        if (colorValue) {
                                            fetchedColors[vc.value] = colorValue;
                                            debugLog('Color for "' + vc.value + '":', colorValue);
                                        }
                                    }
                                });
                            }

                            if (Object.keys(fetchedColors).length > 0) {
                                setColorState(self, fetchedColors, currentChangeHash);
                                return self.paint($element, layout);
                            }

                            // Strategy 2: Try ColorMapModel
                            if (colorMapRef) {
                                var colorMapId = 'ColorMapModel_' + colorMapRef;
                                debugLog('Trying ColorMapModel:', colorMapId);

                                return enigmaApp.getObject(colorMapId)
                                    .then(function(colorMapObj) { return colorMapObj.getLayout(); })
                                    .then(function(colorMapLayout) {
                                        debugLog('ColorMapModel layout:', colorMapLayout);
                                        var extracted = ColorUtils.extractColorsFromColorMap(colorMapLayout, dimensionValues);
                                        Object.keys(extracted).forEach(function(k) { fetchedColors[k] = extracted[k]; });

                                        if (Object.keys(fetchedColors).length > 0) {
                                            setColorState(self, fetchedColors, currentChangeHash);
                                            return self.paint($element, layout);
                                        }
                                        return applyDataRowColors();
                                    })
                                    .catch(function() {
                                        debugLog('ColorMapModel failed, trying data rows');
                                        return applyDataRowColors();
                                    });
                            }

                            return applyDataRowColors();
                        });

                        function applyDataRowColors() {
                            // Extract from master dimension layout coloring
                            var layoutColors = ColorUtils.extractMasterDimColors(masterLayout, dimensionValues);
                            Object.keys(layoutColors).forEach(function(k) {
                                if (!fetchedColors[k]) fetchedColors[k] = layoutColors[k];
                            });

                            // Extract from data row qAttrExps
                            matrix.forEach(function(row) {
                                if (row[1] && row[1].qAttrExps && row[1].qAttrExps.qValues && Array.isArray(row[1].qAttrExps.qValues)) {
                                    var dimValue = row[1].qText;
                                    if (dimValue && !fetchedColors[dimValue]) {
                                        for (var i = 0; i < row[1].qAttrExps.qValues.length; i++) {
                                            var attr = row[1].qAttrExps.qValues[i];
                                            // Safe check: ensure qText is a non-empty string before charAt
                                            if (attr && attr.qText && typeof attr.qText === 'string' && attr.qText.length > 0 && attr.qText.charAt(0) === '#') {
                                                fetchedColors[dimValue] = attr.qText;
                                                break;
                                            } else if (attr && attr.qNum !== undefined && !isNaN(attr.qNum)) {
                                                fetchedColors[dimValue] = ColorUtils.argbToHex(attr.qNum);
                                                break;
                                            }
                                        }
                                    }
                                }
                            });

                            debugLog('Extracted colors:', fetchedColors);
                            setColorState(self, fetchedColors, currentChangeHash);
                            return self.paint($element, layout);
                        }
                    })
                    .catch(function(err) {
                        if (window.LOLLIPOP_DEBUG) {
                            console.warn('[RadialLollipop] Error fetching master colors:', err);
                        }
                        self._fetchingColors = false;
                        self._colorsFetched = true;
                        // Render with fallback
                        return self.paint($element, layout);
                    });

                // Return promise to prevent double render
                return qlik.Promise.resolve();
            }

            // Create color scale
            var colorScale = ColorUtils.createColorScale(settings, groups, masterItemColors);

            // Check for active Qlik selections
            var hasQlikSelection = DataUtils.hasActiveSelection(matrix, dimensionCount);

            // Qlik's selection-SESSION signal. Pending selections leave every
            // qState at 'O', so hasQlikSelection can never flip during one and the
            // old guard below could never fire - the local sets were immortal.
            // qInSelections is the reliable "the user is still choosing" flag: once
            // the session ends, cancelled OR confirmed, the local echo has done its
            // job. A confirmed selection then drives the visuals from real qStates.
            var inSelections = !!(layout.qSelectionInfo && layout.qSelectionInfo.qInSelections);

            if (!inSelections && !isLocalEcho &&
                (self._localSelections.size > 0 || self._localGroupSelections.size > 0)) {
                debugLog('Selection session ended - clearing local echo');
                self._localSelections.clear();
                self._localGroupSelections.clear();
            }

            // Belt: also clear when Qlik's own selection state goes away
            if (!hasQlikSelection && self._hadQlikSelection) {
                self._localSelections.clear();
                self._localGroupSelections.clear();
            }
            self._hadQlikSelection = hasQlikSelection;

            // Render the radial lollipop chart with selection state
            self._renderer.render(model, settings, colorScale, {
                localSelections: self._localSelections,
                localGroupSelections: self._localGroupSelections,
                hasQlikSelection: hasQlikSelection,
                onSelect: function(dimIndex, elem, name) {
                    debugLog('Selection: dim', dimIndex, elem, name);

                    // Both dimensions keep a local echo for immediate feedback:
                    // a PENDING selection arrives with every cell still 'O', so
                    // without this nothing would dim until the user confirms.
                    var localSet = (dimIndex === 1)
                        ? self._localGroupSelections
                        : self._localSelections;

                    if (localSet.has(name)) {
                        localSet.delete(name);
                    } else {
                        localSet.add(name);
                    }

                    // The repaint below is our own synchronous echo: it reuses this
                    // same layout object, whose qSelectionInfo has not caught up.
                    self._localEcho = true;

                    // Tell Qlik to select
                    self.selectValues(dimIndex, [elem], true);

                    // Repaint for immediate visual feedback
                    self.paint($element, layout);
                }
            });

            // Handle window resize - store timer on instance to prevent memory leaks
            $(window).off('resize.lollipop' + layout.qInfo.qId);
            $(window).on('resize.lollipop' + layout.qInfo.qId, function() {
                clearTimeout(self._resizeTimer);
                self._resizeTimer = setTimeout(function() {
                    self.paint($element, layout);
                }, CONSTANTS.TIMING.RESIZE_DEBOUNCE);
            });

            // Cleanup on destroy
            $element.off('$destroy').on('$destroy', function() {
                // Clear any pending resize timer
                clearTimeout(self._resizeTimer);
                self._resizeTimer = null;

                // Cancel any pending RAF
                if (self._rafId) {
                    cancelAnimationFrame(self._rafId);
                    self._rafId = null;
                }

                if (self._renderer) {
                    self._renderer.destroy();
                    self._renderer = null;
                }
                $(window).off('resize.lollipop' + layout.qInfo.qId);
            });

            // Release paint guard and reset depth counter
            self._isPainting = false;
            self._paintDepth = 0;

            // Check for deferred repaints using requestAnimationFrame
            // Cancel any existing pending RAF to prevent accumulation
            if (self._needsRepaint) {
                self._needsRepaint = false;
                if (self._rafId) {
                    cancelAnimationFrame(self._rafId);
                }
                self._rafId = requestAnimationFrame(function() {
                    self._rafId = null;
                    self.paint($element, layout);
                });
            }

            return qlik.Promise.resolve();
        }
    };
});
