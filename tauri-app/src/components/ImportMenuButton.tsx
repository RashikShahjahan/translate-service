import { useEffect, useRef, useState } from "react";

type ImportMenuButtonProps = {
  disabled: boolean;
  importing: boolean;
  onImportFiles: () => void;
  onImportFolder: () => void;
  className: string;
  menuAlign?: "left" | "right";
};

function ImportMenuButton(props: ImportMenuButtonProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  const unavailable = props.disabled || props.importing;
  const menuPositionClass = props.menuAlign === "left" ? "left-0" : "right-0";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={unavailable}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={props.className}
      >
        {props.importing ? "Importing..." : "Import"}
      </button>

      {open && !unavailable ? (
        <div className={`absolute ${menuPositionClass} top-full z-20 mt-2 min-w-40 rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel)] p-2 shadow-lg shadow-black/20 backdrop-blur-[14px]`}>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              props.onImportFiles();
            }}
            className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-medium text-[var(--app-text)] transition hover:bg-white/8"
          >
            Import files
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              props.onImportFolder();
            }}
            className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-medium text-[var(--app-text)] transition hover:bg-white/8"
          >
            Import folder
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default ImportMenuButton;
