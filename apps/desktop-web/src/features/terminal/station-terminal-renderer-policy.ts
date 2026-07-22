export function shouldUseStationTerminalWebglRenderer(isMacOsWebKitEnvironment: boolean): boolean {
  return !isMacOsWebKitEnvironment
}
