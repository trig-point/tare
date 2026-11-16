import { createContext, type ReactNode, useContext } from "react";

const PortalContainerContext = createContext<HTMLElement | undefined>(
  undefined,
);

/**
 * Sets where the portaled components below it (tooltip, popover, dialog, context menu) mount.
 * Without a provider they mount under document.body and theme from the app-wide variables.
 */
export function PortalContainerProvider({
  container,
  children,
}: {
  readonly container: HTMLElement | undefined;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <PortalContainerContext.Provider value={container}>
      {children}
    </PortalContainerContext.Provider>
  );
}

export function usePortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainerContext);
}
