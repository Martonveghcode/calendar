import { useMemo, useRef, useState } from "react";
import { Copy, Download, Upload, X } from "lucide-react";

export default function SetupModal({ open, onClose, dataSnapshot, onImportData }) {
  const [importError, setImportError] = useState("");
  const [importSuccess, setImportSuccess] = useState("");
  const fileInputRef = useRef(null);
  const formattedSnapshot = useMemo(() => JSON.stringify(dataSnapshot ?? {}, null, 2), [dataSnapshot]);

  if (!open) return null;

  const handleExport = () => {
    try {
      const payload = formattedSnapshot || "{}";
      const blob = new Blob([payload], { type: "application/json" });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `lesson-calendar-data-${stamp}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
      setImportSuccess("Download started.");
      setImportError("");
    } catch (downloadError) {
      setImportError(downloadError.message || "Failed to start download.");
      setImportSuccess("");
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formattedSnapshot || "{}");
      setImportSuccess("Copied.");
      setImportError("");
    } catch (copyError) {
      setImportError(copyError.message || "Failed to copy.");
      setImportSuccess("");
    }
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    setImportError("");
    setImportSuccess("");

    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text());
      const result = onImportData(parsed);
      setImportSuccess(Array.isArray(result) && result.length ? `Imported ${result.join(", ")}.` : "Import completed.");
    } catch (importErr) {
      setImportError(importErr.message || "Failed to import.");
      setImportSuccess("");
    } finally {
      event.target.value = "";
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 px-4 py-6 backdrop-blur sm:items-center">
      <div className="app-modal overflow-y-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="app-section-title">Data backup</h2>
            <p className="app-meta mt-2">Google connects from the main screen and stays linked in this browser.</p>
          </div>

          <button type="button" onClick={onClose} className="app-button app-button-square" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <section className="mt-6 space-y-4">
          <textarea readOnly value={formattedSnapshot} className="app-code" />

          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={handleExport} className="app-button">
              <Download className="h-4 w-4" />
              Download
            </button>

            <button type="button" onClick={handleCopy} className="app-button">
              <Copy className="h-4 w-4" />
              Copy
            </button>

            <button type="button" onClick={() => fileInputRef.current?.click()} className="app-button app-button-primary">
              <Upload className="h-4 w-4" />
              Import
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {importError && <div className="app-alert app-alert-error">{importError}</div>}
          {importSuccess && <div className="app-alert app-alert-success">{importSuccess}</div>}
        </section>
      </div>
    </div>
  );
}
