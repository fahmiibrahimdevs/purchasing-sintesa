export function coverageStatus(item: {
  invoice_requirement: string;
  quantity: string | number;
  purchase_subtotal: string | number;
}, activeQuantity: number, activeDpp: number, pendingCount = 0) {
  if (item.invoice_requirement === "NOT_REQUIRED") return "NOT_REQUIRED";
  if (item.invoice_requirement === "UNDETERMINED") return "NEEDS_REVIEW";

  // Coverage answers whether the purchased quantity has an invoice link.
  // Invoice DPP can legitimately differ from the purchase subtotal, so it
  // must not make a fully invoiced item appear uncovered.
  const coverageComplete = activeQuantity + 0.0001 >= Number(item.quantity);
  const hasCoverage = activeQuantity > 0;

  if (coverageComplete) return "COMPLETE";
  if (hasCoverage) return "PARTIAL";
  return pendingCount ? "UNDER_REVIEW" : "WAITING";
}
