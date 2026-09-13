// Bridge to the native BluetoothThermal plugin (Android APK builds).
// In a plain browser these functions are never called — thermal.ts keeps the
// Web Bluetooth path there. Shared by thermal.ts and the device picker UI.

import { Capacitor, registerPlugin } from '@capacitor/core';

export interface ThermalDeviceInfo {
  address: string;
  name: string;
}

export interface ThermalDevicesResult {
  devices: ThermalDeviceInfo[];
  supported: boolean;
  enabled: boolean;
}

interface NativeBluetoothThermal {
  getPairedDevices(): Promise<ThermalDevicesResult>;
  connect(options: { address: string }): Promise<{ connected: boolean; name?: string; address?: string }>;
  write(options: { data: string }): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): Promise<{ connected: boolean; address?: string }>;
  addListener(
    eventName: 'connected' | 'disconnected',
    listener: (data: { address?: string; name?: string }) => void
  ): Promise<{ remove: () => void }>;
}

const NativeThermal = registerPlugin<NativeBluetoothThermal>('BluetoothThermal');

/** True when running inside the native Android app (Capacitor). */
export function isNativeApp(): boolean {
  return typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform();
}

export async function getThermalDevicesInfo(): Promise<ThermalDevicesResult> {
  if (!isNativeApp()) return { devices: [], supported: false, enabled: false };
  const res = await NativeThermal.getPairedDevices();
  return {
    devices: res.devices ?? [],
    supported: res.supported ?? true,
    enabled: res.enabled ?? true,
  };
}

export async function nativeConnect(address: string): Promise<{ connected: boolean; name?: string }> {
  return NativeThermal.connect({ address });
}

export async function nativeWrite(dataBase64: string): Promise<void> {
  return NativeThermal.write({ data: dataBase64 });
}

export async function nativeDisconnect(): Promise<void> {
  return NativeThermal.disconnect();
}

export function nativeOnDisconnected(cb: () => void): void {
  void NativeThermal.addListener('disconnected', cb).catch(() => {});
}

/** Base64-encode a small byte chunk (240B max) for the native transport. */
export function base64FromBytes(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
