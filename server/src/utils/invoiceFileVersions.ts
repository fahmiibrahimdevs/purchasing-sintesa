export type InvoiceFileVersionEvent = {
  id: string;
  tax_invoice_id?: string;
  event_type: string;
  new_values: unknown;
};

export function eventNewValues(event: InvoiceFileVersionEvent): Record<string, any> | null {
  if (typeof event.new_values === "string") {
    try { return JSON.parse(event.new_values); } catch { return null; }
  }
  return event.new_values && typeof event.new_values === "object"
    ? event.new_values as Record<string, any>
    : null;
}

export function activeFileVersionCancellations<T extends InvoiceFileVersionEvent>(events: T[]): T[] {
  const restoredCancellationIds = new Set(events
    .filter((event) => event.event_type === "FILE_VERSION_RESTORED")
    .map((event) => String(eventNewValues(event)?.restored_cancellation_event_id || ""))
    .filter(Boolean));
  return events.filter((event) => event.event_type === "FILE_VERSION_CANCELLED" && !restoredCancellationIds.has(String(event.id)));
}

export function activeCancelledAttachmentKeys(events: InvoiceFileVersionEvent[]): Set<string> {
  return new Set(activeFileVersionCancellations(events)
    .map((event) => {
      const attachmentId = eventNewValues(event)?.attachment_id;
      return attachmentId && event.tax_invoice_id ? `${event.tax_invoice_id}:${attachmentId}` : "";
    })
    .filter(Boolean));
}
