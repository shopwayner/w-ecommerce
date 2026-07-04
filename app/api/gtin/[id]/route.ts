import { updateGlobalGtinRecord } from "@/lib/services/gtin-global-update-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return updateGlobalGtinRecord(request, id, "/api/gtin/[id]");
}
