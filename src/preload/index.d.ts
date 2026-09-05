import type { GitApi } from '@shared/types';

declare global {
  interface Window {
    api: GitApi;
    platform: NodeJS.Platform;
  }
}

export {};
