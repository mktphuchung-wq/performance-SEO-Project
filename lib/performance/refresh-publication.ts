export type RefreshPublicationOutcome = {
  status: "success" | "partial" | "failed";
  publish: boolean;
};

/** A staging snapshot is all-or-nothing: any failed URL leaves cache and KPI untouched. */
export function refreshPublicationOutcome(totalUrls: number, failedUrls: number): RefreshPublicationOutcome {
  if (failedUrls <= 0) return { status: "success", publish: true };
  return {
    status: failedUrls >= totalUrls ? "failed" : "partial",
    publish: false,
  };
}
