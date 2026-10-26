import { field } from "../content";
import { PurchasedAsset } from "../PurchasedAsset";
import type { ResultView, ResultViewProps } from "../types";

/**
 * Compra en un catálogo de medios ({ asset, downloadUrl }): la misma tarjeta del Playground, en vez
 * de la lista de enlaces crudos (previewUrl, downloadUrl…) de la vista genérica.
 */
function MediaPurchase({ data }: ResultViewProps) {
  const asset = field<Record<string, unknown>>(data, "asset")!;
  const downloadUrl = field<string>(data, "downloadUrl")!;
  return <PurchasedAsset asset={asset} downloadUrl={downloadUrl} expiresAt={field(data, "expiresAt")} />;
}

export const mediaPurchaseView: ResultView = {
  id: "media-purchase",
  match: ({ data }) => {
    const asset = field(data, "asset");
    return !!asset && typeof asset === "object" && typeof field(data, "downloadUrl") === "string";
  },
  Component: MediaPurchase,
};
