export let copyTargetAddresses: string[] = [];

export function setCopyTargets(proxies: string[]): void {
  copyTargetAddresses = proxies;
}

export function getCopyTargets(): string[] {
  return copyTargetAddresses;
}
