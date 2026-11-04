import type { ComponentProps } from "react";

import { SettingsView } from "../components/SettingsView";
import { useSidebar } from "../components/SidebarDrawer";

/** `SettingsView` with the shell's sidebar state, which `App` otherwise owns. */
export function SettingsHarness(props: Omit<ComponentProps<typeof SettingsView>, "sidebar">) {
  const sidebar = useSidebar();
  return <SettingsView {...props} sidebar={sidebar} />;
}
