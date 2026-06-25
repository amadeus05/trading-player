# Drawing subsystem

Each drawing tool owns only its geometry and domain-specific interactions.

- `DrawingManager.ts` is the single owner of the active mode and interaction priority. It disables hit-testing for every existing drawing while any creation tool is active. Global hotkeys: copy/paste/delete selection, delete all (`Ctrl+Shift+Delete`), escape.
- `shared/coordinates.ts` is the single conversion layer between timestamps, prices and pixels.
- `shared/overlay.ts` owns SVG creation and clipping to the candle plot so drawings never cover chart scales or adjacent panels.
- `shared/floatingPanel.ts` owns toolbar placement, dragging and per-drawing position persistence.
- `shared/popup.ts` owns anchored popup positioning, outside-click handling and cleanup.
- `shared/colorPalette.ts` provides the common palette used by drawing toolbars.
- `shared/types.ts` contains lifecycle contracts shared by persistent drawing tools.
- `shared/ManagedDrawingTool.ts` provides clipboard bridge, DrawingManager lifecycle wiring, plot clamp helpers, pointer-drag sessions and scale-interaction sync for fibonacci overlays.

New tools receive the same `DrawingManager` through `ManagedDrawingToolOptions` and should compose these primitives instead of implementing active-mode guards, pointer-event switching, overlay creation, coordinate interpolation, floating panels or popup lifecycle.
