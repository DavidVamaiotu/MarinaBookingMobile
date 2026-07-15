"use strict";

const resources = [
  { id: 1, title: "Camera cvadruplă 1" },
  { id: 2, title: "Camera dublă 2" },
  { id: 3, title: "Camera fără rezervări" },
  { id: 4, title: "Bungalow superior 4" }
];
const bookings = [
  { resourceId: 1, status: "approved", dates: BookingCalendar.dateRange("2026-07-28", "2026-08-04") },
  { resourceId: 1, status: "pending", dates: BookingCalendar.dateRange("2026-08-04", "2026-08-09") },
  { resourceId: 2, status: "approved", dates: BookingCalendar.dateRange("2026-08-12", "2026-08-18") },
  { resourceId: 4, status: "approved", dates: BookingCalendar.dateRange("2026-08-01", "2026-08-02") },
  { resourceId: 4, status: "approved", dates: BookingCalendar.dateRange("2026-08-24", "2026-09-03") }
];
const weekdayInitials = ["D", "L", "M", "M", "J", "V", "S"];
let month = new Date("2026-08-01T00:00:00Z");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function addMonths(value, count) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + count, 1));
}

function render() {
  const view = AvailabilityTimeline.buildMonth(resources, bookings, month);
  const label = new Intl.DateTimeFormat("ro-RO", { month: "long", year: "numeric", timeZone: "UTC" }).format(month);
  const grid = document.querySelector("#availabilityGrid");
  grid.style.setProperty("--availability-days", view.dates.length);
  document.querySelector("#availabilityMonthLabel").textContent = label;
  grid.innerHTML = `<div class="availability-corner">Cameră</div><div class="availability-month">${escapeHtml(label)}</div>${view.rows.map((row) => `<div class="availability-room">${escapeHtml(row.title)}</div>${view.dates.map((date) => `<div class="availability-date-number">${date.day}</div>`).join("")}${row.cells.map((cell, index) => `<div class="availability-cell" data-date="${cell.date}" data-am="${cell.am === "available" ? "available" : "occupied"}" data-pm="${cell.pm === "available" ? "available" : "occupied"}"><span>${weekdayInitials[view.dates[index].weekday]}</span></div>`).join("")}`).join("")}`;
}

document.querySelector("#availabilityPrev").addEventListener("click", () => { month = addMonths(month, -1); render(); });
document.querySelector("#availabilityNext").addEventListener("click", () => { month = addMonths(month, 1); render(); });
document.querySelector("#previewToggle").addEventListener("click", (event) => {
  const page = document.querySelector("#availabilityPage");
  const existing = document.querySelector("#previewExisting");
  page.hidden = !page.hidden;
  existing.hidden = !existing.hidden;
  event.currentTarget.textContent = page.hidden ? "Disponibilitate" : "Calendar rezervări";
});
render();
