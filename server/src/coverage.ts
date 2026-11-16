export function coverageStatus(item: {
  invoice_requirement: string;
  quantity: string | number;
  purchase_subtotal: string | number;
}, activeQuantity: number, _activeDpp = 0, _pendingCount = 0) {
  if (item.invoice_requirement === "NOT_REQUIRED") return "NOT_REQUIRED";

  // Binary coverage: item with an active invoice is COMPLETE, otherwise WAITING
  return activeQuantity > 0 ? "COMPLETE" : "WAITING";
}
