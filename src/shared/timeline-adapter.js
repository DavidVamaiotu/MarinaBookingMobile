(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TimelineAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function field(booking, name) {
    return String(booking.formData?.[name]?.value || "").trim();
  }

  function toItem(booking) {
    const fullName = [field(booking, "name") || field(booking, "firstname"), field(booking, "secondname") || field(booking, "lastname")].filter(Boolean).join(" ");
    const name = fullName || field(booking, "email") || `Booking ${booking.serverId || "local"}`;
    return {
      key: booking.localId,
      serverId: booking.serverId,
      resourceId: Number(booking.resourceId),
      start: booking.startDate || booking.dates?.[0],
      end: booking.endDate || booking.dates?.[booking.dates.length - 1],
      title: name,
      subtitle: field(booking, "phone") || field(booking, "email"),
      status: booking.trashed ? "trashed" : booking.status,
      syncState: booking.syncState || "synced",
      booking
    };
  }

  function mapState(resources, bookings) {
    const items = bookings.map(toItem);
    return resources.map((resource) => ({
      id: Number(resource.id),
      title: resource.title || `Resource ${resource.id}`,
      subtitle: resource.capacity ? `Capacity ${resource.capacity}` : "Booking resource",
      items: items.filter((item) => item.resourceId === Number(resource.id))
    }));
  }

  return { field, mapState, toItem };
});
