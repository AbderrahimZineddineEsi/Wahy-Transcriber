import { useEffect } from "react";
import { useHealth } from "../api/health";
import { useI18n } from "./i18n";

/** Two editions of one codebase (docs/editions.md): "studio" has the research screens (training data, the request
 *  log, local Laya); "tadqeeq" is the product people download. The server says which one it is. */
export type Edition = "studio" | "tadqeeq";

/** The edition the server runs, or undefined until it first answers. */
export function useEdition(): Edition | undefined {
  return useHealth().data?.edition;
}

/** Whether to show the research screens and options. False until the server answers, so the product never
 *  flashes them. */
export function useStudio(): boolean {
  return useEdition() === "studio";
}

/** Hand the edition to the words (the product has its own name and wording) and to the browser tab's title. */
export function useEditionSync(): void {
  const edition = useEdition();
  const { setWording } = useI18n();
  useEffect(() => {
    if (!edition) return;
    setWording(edition);
    document.title = edition === "tadqeeq" ? "تدقيق · Tadqeeq" : "وحي ستوديو · Wahy Studio";
  }, [edition, setWording]);
}
