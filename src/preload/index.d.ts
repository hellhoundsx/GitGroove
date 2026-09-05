import type { GitApi, ShellApi } from '@shared/types';

declare global {
  interface Window {
    api: GitApi;
    shell: ShellApi;
    platform: NodeJS.Platform;
  }
}

export {};
