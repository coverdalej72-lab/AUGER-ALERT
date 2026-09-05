import { API } from "@/src/api";

export type UploadResult = {
  schedule: { source_filename: string } | null;
  shed_count: number;
  farms: string[];
};

/** Pick a .xlsx/.csv (works in the phone browser and native) and upload it. */
export async function pickAndUploadSheet(): Promise<UploadResult | null> {
  const DocumentPicker = await import("expo-document-picker");
  const res = await DocumentPicker.getDocumentAsync({
    type: [
      "text/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "*/*",
    ],
    copyToCacheDirectory: true,
  });
  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];
  const fd = new FormData();
  if ((asset as any).file) {
    fd.append("file", (asset as any).file, asset.name);
  } else {
    fd.append("file", {
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType || "application/octet-stream",
    } as any);
  }
  const r = await fetch(`${API}/upload`, { method: "POST", body: fd });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw new Error((b as any).detail || "Upload failed");
  }
  return r.json();
}
