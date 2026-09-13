import { uid } from './types';

const DEVICE_ID_KEY = 'nellara-device-id';
const DEVICE_NAME_KEY = 'nellara-device-name';

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = uid();
    try {
      localStorage.setItem(DEVICE_ID_KEY, id);
    } catch {
      /* ignore */
    }
  }
  return id;
}

export function getDeviceName(): string {
  return localStorage.getItem(DEVICE_NAME_KEY) ?? 'Device';
}

export function setDeviceName(name: string): void {
  try {
    localStorage.setItem(DEVICE_NAME_KEY, name);
  } catch {
    /* ignore */
  }
}

export function newPairingCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}
