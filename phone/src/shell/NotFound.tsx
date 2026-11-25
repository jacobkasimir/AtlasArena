import { LinkButton, StatusMessage } from "@phone/ui";
import { usePhoneChrome } from "./chrome";
import { paths } from "./paths";

export function NotFound() {
  usePhoneChrome({ title: "Page not found" });
  return (
    <div className="ph-stack">
      <StatusMessage>This page does not exist in the phone app.</StatusMessage>
      <LinkButton to={paths.home} variant="primary" block>
        Go to Home
      </LinkButton>
    </div>
  );
}
