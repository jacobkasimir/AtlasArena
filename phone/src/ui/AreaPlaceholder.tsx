import { usePhoneChrome } from "@phone/shell/chrome";
import { Card } from "./Card";

/** Temporary content for an area that is not built yet. Remove once the area has real screens. */
export function AreaPlaceholder({ title, text }: { title: string; text?: string }) {
  usePhoneChrome({ title });
  return (
    <Card>
      <p className="font-bold">{title} is coming to the phone app.</p>
      <p className="ph-muted mt-2">{text ?? "This screen is still being built."}</p>
    </Card>
  );
}
