import * as Dialog from "@radix-ui/react-dialog";
import { Theme } from "@radix-ui/themes";
import type { PropsWithChildren } from "react";

export function DialogPortal({ children }: PropsWithChildren) {
  return (
    <Dialog.Portal>
      <Theme>{children}</Theme>
    </Dialog.Portal>
  );
}
