import { createElement, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Download, FileIcon, Image as ImageIcon, Music } from "lucide-react";
import type { ResultFile } from "@/lib/api";
import type { ResultView, ResultViewProps } from "../types";
import "../response-summary.css";

/**
 * Archivos del resultado: los que el gateway copió a la cuenta (`call.files`; files.ts) o, si el
 * detalle no los trae, los enlaces a /v1/files/ de la respuesta. Vista previa del principal
 * (modelo 3D, imagen, audio o vídeo) y un botón de descarga por archivo.
 *
 * El visor 3D es <model-viewer>, cargado solo cuando hay un .glb que mostrar; si no carga,
 * se muestra la miniatura y queda la descarga.
 */
const MODEL_VIEWER_URL = "https://cdn.jsdelivr.net/npm/@google/model-viewer@4.1.0/dist/model-viewer.min.js";

let modelViewerLoading: Promise<void> | undefined;
function loadModelViewer(): Promise<void> {
  if (customElements.get("model-viewer")) return Promise.resolve();
  modelViewerLoading ??= import(/* @vite-ignore */ MODEL_VIEWER_URL).then(() => undefined);
  return modelViewerLoading;
}

const EXT_TYPES: Record<string, string> = {
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  stl: "model/stl",
  obj: "model/obj",
  fbx: "application/octet-stream",
  usdz: "model/vnd.usdz+zip",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
  otf: "font/otf",
  ttf: "font/ttf",
  pdf: "application/pdf",
};

function typeByName(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return EXT_TYPES[ext] ?? "application/octet-stream";
}

/** Los archivos a mostrar: `call.files` si viene; si no, los enlaces de Kiba de la respuesta. */
export function filesOf({ call, urls }: ResultViewProps): ResultFile[] {
  if (call.files?.length) return call.files;
  const seen = new Set<string>();
  return urls
    .filter((u) => /\/v1\/files\/[0-9a-f]{32}\//.test(u.url) && !seen.has(u.url) && !!seen.add(u.url))
    .map((u) => {
      const name = decodeURIComponent(u.url.split("/").pop() ?? "") || "file";
      return { id: u.url, name, url: u.url, contentType: typeByName(name), bytes: 0, keyPath: u.key };
    });
}

function formatBytes(n: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function downloadUrl(f: ResultFile): string {
  return `${f.url}${f.url.includes("?") ? "&" : "?"}download=1`;
}

function kindOf(f: ResultFile): "model" | "image" | "audio" | "video" | "other" {
  const t = f.contentType;
  if (t.startsWith("model/") || /\.(glb|gltf|stl|obj|fbx|usdz)$/i.test(f.name)) return "model";
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("audio/")) return "audio";
  if (t.startsWith("video/")) return "video";
  return "other";
}

function ModelViewer({ src, poster }: { src: string; poster?: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    let alive = true;
    loadModelViewer().then(
      () => alive && setState("ready"),
      () => alive && setState("failed"),
    );
    return () => {
      alive = false;
    };
  }, []);
  if (state === "failed") {
    return (
      <div className="space-y-2">
        {poster && <img className="rs-asset__img" src={poster} alt="" />}
        <p className="rs-muted">{t("results.files.viewer_failed")}</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {createElement("model-viewer", {
        src,
        poster,
        "camera-controls": "",
        "auto-rotate": "",
        "shadow-intensity": "1",
        "touch-action": "pan-y",
        // Fondo gris neutro: los modelos sin textura son blancos y sobre blanco no se leen.
        style: {
          width: "100%",
          height: "380px",
          borderRadius: "10px",
          background: "#eceef1",
          border: "1px solid var(--color-border, #e5e7eb)",
        },
      })}
      <p className="rs-muted">{state === "loading" ? t("results.loading") : t("results.files.model_hint")}</p>
    </div>
  );
}

function Files(props: ResultViewProps) {
  const { t } = useTranslation();
  const files = filesOf(props);
  const model = files.find((f) => /\.glb$/i.test(f.name));
  const image = files.find((f) => kindOf(f) === "image");
  const audio = files.find((f) => kindOf(f) === "audio");
  const video = files.find((f) => kindOf(f) === "video");

  return (
    <div className="space-y-4">
      {model ? (
        <ModelViewer src={model.url} poster={image?.url} />
      ) : video ? (
        <video className="rs-asset__img" controls src={video.url} />
      ) : image ? (
        <img className="rs-asset__img" src={image.url} alt={image.name} />
      ) : null}
      {audio && <audio className="rs-asset__audio" controls src={audio.url} />}

      <ul className="space-y-2">
        {files.map((f) => {
          const kind = kindOf(f);
          const Icon = kind === "model" ? Box : kind === "image" ? ImageIcon : kind === "audio" ? Music : FileIcon;
          return (
            <li key={f.id} className="rs-asset__row">
              <div className="flex items-center gap-2 min-w-0">
                <Icon size={16} className="shrink-0 text-[var(--color-fg-muted)]" />
                <div className="min-w-0">
                  <p className="rs-asset__title truncate">{f.name}</p>
                  <p className="rs-muted">
                    {f.contentType}
                    {f.bytes ? ` · ${formatBytes(f.bytes)}` : ""}
                  </p>
                </div>
              </div>
              <a className="rs-btn" href={downloadUrl(f)}>
                <Download size={14} /> {t("results.files.download")}
              </a>
            </li>
          );
        })}
      </ul>
      <p className="rs-muted">{t("results.files.kept")}</p>
    </div>
  );
}

export const filesView: ResultView = {
  id: "files",
  match: (props) => filesOf(props).length > 0,
  Component: Files,
};
