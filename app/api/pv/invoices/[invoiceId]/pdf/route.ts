import { getAuthedUser } from "@/lib/dashboard/requestScope";
import { buildPvInvoicePdf } from "@/lib/pv/invoicePdf";
import { getPvInvoicePdfModel } from "@/services/hermes/pvBilling";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ invoiceId: string }> },
) {
  const user = await getAuthedUser();
  if (!user) return new Response("Non authentifié", { status: 401 });
  const { invoiceId } = await ctx.params;
  const model = await getPvInvoicePdfModel(invoiceId);
  if (!model) {
    return new Response("Facture introuvable ou snapshot légal incomplet.", { status: 404 });
  }
  const pdf = buildPvInvoicePdf(model);
  const body = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
  const safe = model.invoiceNumber.replace(/[^A-Za-z0-9._-]+/g, "-");
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safe}.pdf"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
