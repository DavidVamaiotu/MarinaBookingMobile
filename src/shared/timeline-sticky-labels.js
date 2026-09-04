(function timelineStickyLabelsModule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TimelineStickyLabels = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createTimelineStickyLabels() {
  "use strict";

  function boundedShift({ visibleLeft, barRight, labelLeft, labelRight, scale = 1 }) {
    if (![visibleLeft, barRight, labelLeft, labelRight, scale].every(Number.isFinite) || scale <= 0) return 0;
    if (barRight <= visibleLeft || labelRight <= labelLeft) return 0;
    const needed = Math.max(0, visibleLeft - labelLeft);
    const available = Math.max(0, barRight - labelRight);
    return Math.min(needed, available) / scale;
  }

  function reset(rows) {
    if (!rows) return;
    for (const label of rows.querySelectorAll(".timeline-bar-label")) {
      label.style.setProperty("--timeline-sticky-label-shift", "0px");
    }
  }

  function measure({ viewport, rows, scale = 1, gap = 8 }) {
    if (!viewport || !rows) return [];
    const labels = [...rows.querySelectorAll(".timeline-bar-label")];
    const viewportRect = viewport.getBoundingClientRect();
    const unitRights = new Map();
    const measurements = [];
    for (const label of labels) {
      const bar = label.closest(".timeline-bar");
      if (!bar || bar.classList.contains("is-tight") || bar.classList.contains("is-compact")) continue;
      const row = bar.closest(".timeline-row");
      const guest = label.querySelector(".timeline-bar-guest") || label;
      const barRect = bar.getBoundingClientRect();
      const labelRect = guest.getBoundingClientRect();
      if (!unitRights.has(row)) unitRights.set(row, row?.querySelector(".timeline-unit")?.getBoundingClientRect().right ?? viewportRect.left);
      const unitRight = unitRights.get(row);
      const visibleLeft = Math.max(viewportRect.left, unitRight) + gap * scale;
      const shift = boundedShift({
        visibleLeft,
        barRight: barRect.right,
        labelLeft: labelRect.left,
        labelRight: labelRect.right,
        scale
      });
      measurements.push({ label, shift });
    }
    return measurements;
  }

  function apply(measurements) {
    for (const { label, shift } of measurements || []) label.style.setProperty("--timeline-sticky-label-shift", `${shift}px`);
  }

  function update(options) {
    if (!options?.viewport || !options?.rows) return;
    reset(options.rows);
    apply(measure(options));
  }

  return { apply, boundedShift, measure, reset, update };
});
