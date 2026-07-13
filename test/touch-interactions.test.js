"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const mobileBridgeSource = fs.readFileSync(path.join(__dirname, "..", "mobile", "mobile-bridge.js"), "utf8");

test("Android Back closes an open booking menu before exiting the app", () => {
  assert.match(mobileBridgeSource, /App\.addListener\("backButton"/);
  assert.match(mobileBridgeSource, /new Event\("marina:back", \{ cancelable: true \}\)/);
  assert.match(mobileBridgeSource, /if \(!window\.dispatchEvent\(event\)\) return;/);
  assert.match(appSource, /function dismissTopLayer\(\)/);
  assert.match(appSource, /if \(!bookingMenu\.hidden\) \{ dismissBookingMenu\(\); return true; \}/);
  assert.match(appSource, /window\.addEventListener\("marina:back", \(event\) => \{\s*if \(!dismissTopLayer\(\)\) return;\s*event\.preventDefault\(\);/);
});

test("touch input cannot start a reservation resize", () => {
  assert.match(appSource, /function beginDrag\(event\) \{\s*if \(event\.pointerType === "touch"\) return;/);
  assert.match(stylesSource, /\.timeline-handle\{cursor:ew-resize;touch-action:pan-x pan-y\}/);
});

test("cancelled pointers restore the original booking instead of syncing a resize", () => {
  assert.match(appSource, /document\.addEventListener\("pointercancel", cancelDrag\)/);
  assert.match(appSource, /cancelled\.booking\.dates = cancelled\.originalDates/);
  assert.doesNotMatch(appSource, /document\.addEventListener\("pointercancel", endDrag\)/);
});

test("horizontal pinch uses the original timeline width without camera layers", () => {
  assert.match(indexSource, /<div class="timeline-shell" id="timelineShell"[^>]*>\s*<div class="timeline-scale" id="timelineScale"><\/div>\s*<div class="guest-timeline" id="guestTimeline"><\/div>/);
  assert.match(stylesSource, /\.timeline-scale \.timeline-corner,\.timeline-unit\{position:sticky;left:0;/);
  assert.doesNotMatch(indexSource, /timeline-camera|timeline-header-pane|timeline-row-pane/);
  assert.doesNotMatch(appSource, /viewportZoom|setViewportZoom/);
  assert.match(appSource, /function setTimelineZoom\(nextWidth, clientX, anchorDay = null/);
  assert.match(appSource, /timelineShell\.addEventListener\("touchstart", beginTouchZoom, \{ passive: false \}\)/);
  assert.match(appSource, /queueTimelineZoom\(touchZoomState\.startDayWidth \* scale, touchMidpointX\(event\.touches\), touchZoomState\.anchorDay\)/);
  const wheelSource = appSource.slice(appSource.indexOf("function handleTimelineWheel"), appSource.indexOf("function autoScrollDuringDrag"));
  assert.match(wheelSource, /wheelPinchState\.mode === "horizontal"[\s\S]*queueTimelineZoom\(baseWidth \* Math\.exp\(-delta \* 0\.01\), event\.clientX\)/);
});

test("horizontal pinch batches work and renders date numbers at every rounded frame", () => {
  assert.match(appSource, /function queueTimelineZoom\(nextWidth, clientX, anchorDay = null\)[\s\S]*requestAnimationFrame/);
  const liveZoomSource = appSource.slice(appSource.indexOf("function setTimelineZoom"), appSource.indexOf("function queueTimelineZoom"));
  assert.doesNotMatch(liveZoomSource, /querySelectorAll|queueRowRender/);
  assert.match(liveZoomSource, /updateDateGridBackground\(\)/);
  assert.match(appSource, /const next = Math\.round\(Math\.min\(MAX_ZOOM_DAY_WIDTH/);
  assert.doesNotMatch(appSource, /is-horizontal-pinching/);
  assert.doesNotMatch(stylesSource, /is-horizontal-pinching|visibility:hidden/);
});

test("vertical pinch locks direction and magnifies only the root rendered surface", () => {
  assert.match(appSource, /const MIN_DISPLAY_MAGNIFICATION = 1/);
  assert.match(appSource, /const MAX_DISPLAY_MAGNIFICATION = 2/);
  assert.match(appSource, /const PINCH_DIRECTION_THRESHOLD = 8/);
  assert.match(appSource, /touchZoomState\.mode = horizontalChange >= verticalChange \? "horizontal" : "vertical"/);
  assert.match(stylesSource, /:root\{[^}]*--display-magnification:1[^}]*transform:scale\(var\(--display-magnification\)\)[^}]*transform-origin:0 0/);
  const displaySource = appSource.slice(appSource.indexOf("function setDisplayMagnification"), appSource.indexOf("function queueDisplayMagnification"));
  assert.match(displaySource, /document\.documentElement\.style\.setProperty\("--display-magnification"/);
  assert.match(displaySource, /window\.scrollTo\([\s\S]*anchor\.x \* displayMagnification - clientX[\s\S]*anchor\.y \* displayMagnification - clientY/);
  assert.doesNotMatch(displaySource, /dayWidth|timeline|row|column|font|height|width/);
  assert.doesNotMatch(indexSource, /timeline-camera|timeline-header-pane|timeline-row-pane/);
});

test("manual timeline coordinates invert the display magnification", () => {
  assert.match(appSource, /const x = \(event\.clientX - rect\.left\) \/ displayMagnification - timelineUnitWidth\(\) \+ timelineScrollLeft\(\)/);
  assert.match(appSource, /\(event\.clientX - dragState\.clientX\) \/ displayMagnification/);
  assert.match(appSource, /previousBounds\.right - currentBounds\.left\) \/ displayMagnification/);
});

test("high resolution horizontal scrolling preserves the full trackpad delta", () => {
  const wheelSource = appSource.slice(appSource.indexOf("function handleTimelineWheel"), appSource.indexOf("function autoScrollDuringDrag"));
  assert.match(wheelSource, /timelineShell\.scrollLeft \+= horizontal/);
  assert.doesNotMatch(wheelSource, /Math\.min\(Math\.max\(horizontal/);
});

test("each stacked reservation lane receives its own compact date strip", () => {
  const dateGridSource = appSource.slice(appSource.indexOf("function updateDateGridBackground"), appSource.indexOf("function assignLanes"));
  assert.match(dateGridSource, /const rowHeight = LANE_HEIGHT/);
  assert.match(stylesSource, /\.timeline-row::before\{[^}]*inset:4px 0 4px var\(--timeline-unit-width\)[^}]*background-repeat:repeat-y[^}]*background-size:var\(--timeline-date-grid-width\) 34px/);
  assert.match(stylesSource, /\.guest-timeline\{display:grid;align-content:start/);
});

test("phone and Fold timelines keep enough width for complete room identifiers", () => {
  assert.match(stylesSource, /@media\(max-width:900px\)[\s\S]*--timeline-unit-width:150px/);
  assert.match(stylesSource, /\.timeline-unit strong\{overflow:visible;font-size:10px;text-overflow:clip;white-space:normal;overflow-wrap:anywhere\}/);
  assert.match(stylesSource, /@media\(min-width:600px\) and \(max-width:1100px\)[\s\S]*--timeline-unit-width:180px/);
  assert.match(appSource, /label\.title = row\.resource\.title/);
});

test("camping alone uses a compact timeline category column", () => {
  assert.match(stylesSource, /\.timeline-shell\.is-camping-workspace\{--timeline-unit-width:112px\}/);
  assert.match(appSource, /function timelineUnitWidth\(\)[\s\S]*getComputedStyle\(timelineShell\)[\s\S]*--timeline-unit-width/);
  assert.doesNotMatch(appSource, /\bRESOURCE_WIDTH\b/);
});

test("past timeline days and only the past segment of reservations are faded", () => {
  assert.match(appSource, /value < today \? "is-past"/);
  assert.match(appSource, /const pastDays = Math\.max\(0, Math\.min\(end - start, todayIndex - start\)\)/);
  assert.match(appSource, /bar\.dataset\.pastDays = String\(normalized\)/);
  assert.match(appSource, /--timeline-past-width", `calc\(\$\{normalized\} \* var\(--timeline-day-width\)\)`/);
  assert.doesNotMatch(appSource, /function updateRenderedPastWidths/);
  assert.match(stylesSource, /--timeline-booking-bg:#ffeead/);
  assert.match(stylesSource, /--timeline-booking-bg:#36A83F/);
  assert.match(stylesSource, /linear-gradient\(to right,var\(--timeline-booking-bg-past\) 0 var\(--timeline-past-width\),var\(--timeline-booking-bg\) var\(--timeline-past-width\) 100%\)/);
  assert.match(stylesSource, /\.timeline-scale \.timeline-day\.is-past/);
});

test("client popup uses viewport-safe positioning on phone and Fold widths", () => {
  const positionSource = appSource.slice(appSource.indexOf("function positionBookingMenu"), appSource.indexOf("function openBookingMenu"));
  assert.match(positionSource, /matchMedia\("\(max-width: 900px\)"\)/);
  assert.match(positionSource, /removeProperty\("left"\)[\s\S]*removeProperty\("top"\)/);
  assert.match(stylesSource, /\.booking-menu\{inset:auto 6px max\(6px,env\(safe-area-inset-bottom\)\);width:auto;max-height:min\(520px,calc\(100dvh/);
});
