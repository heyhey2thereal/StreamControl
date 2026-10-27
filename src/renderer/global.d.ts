import type { StreamControlApi } from '../shared/types';

declare global {
  interface Window {
    streamcontrol: StreamControlApi;
  }
}

export {};
