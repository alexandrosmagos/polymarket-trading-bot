export let copyTargetAddresses: string[] = [];
export let whaleTargetEntries: { address: string; minUsd: number }[] = [];
export let riskerTargetAddresses: string[] = [];

export function setCopyTargets(proxies: string[]): void {
  copyTargetAddresses = proxies;
}

export function getCopyTargets(): string[] {
  return copyTargetAddresses;
}

export function setWhaleTargets(entries: { address: string; minUsd: number }[]): void {
  whaleTargetEntries = entries;
}

export function getWhaleTargets(): { address: string; minUsd: number }[] {
  return whaleTargetEntries;
}

export function setRiskerTargets(proxies: string[]): void {
  riskerTargetAddresses = proxies;
}

export function getRiskerTargets(): string[] {
  return riskerTargetAddresses;
}
