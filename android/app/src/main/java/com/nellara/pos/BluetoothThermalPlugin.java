package com.nellara.pos;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Native classic-Bluetooth SPP transport for ESC/POS thermal printers.
 *
 * The web layer renders receipts to a 1-bit raster and sends the resulting
 * bytes here as base64; this plugin writes them to the printer's RFCOMM
 * socket. Works with the vast majority of 58mm/80mm thermal printers, which
 * expose the standard Serial Port Profile (SPP) UUID.
 */
@CapacitorPlugin(
    name = "BluetoothThermal",
    permissions = {
        @Permission(alias = "connect", strings = {Manifest.permission.BLUETOOTH_CONNECT}),
        @Permission(alias = "legacy", strings = {Manifest.permission.BLUETOOTH, Manifest.permission.BLUETOOTH_ADMIN})
    }
)
public class BluetoothThermalPlugin extends Plugin {

    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private BluetoothSocket socket;
    private OutputStream output;
    private boolean connected;
    private String connectedAddress;

    // ── API ───────────────────────────────────────────────────────────────

    @PluginMethod
    public void getPairedDevices(PluginCall call) {
        if (!ensureConnectPermission(call)) return;
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            JSArray devices = new JSArray();
            boolean supported = adapter != null;
            boolean enabled = supported && adapter.isEnabled();
            if (supported && enabled) {
                for (BluetoothDevice d : adapter.getBondedDevices()) {
                    JSObject o = new JSObject();
                    o.put("address", d.getAddress());
                    String name = d.getName();
                    o.put("name", name != null ? name : d.getAddress());
                    devices.put(o);
                }
            }
            JSObject ret = new JSObject();
            ret.put("devices", devices);
            ret.put("supported", supported);
            ret.put("enabled", enabled);
            call.resolve(ret);
        } catch (SecurityException e) {
            call.reject("Bluetooth permission denied");
        }
    }

    @PluginMethod
    public void connect(PluginCall call) {
        if (!ensureConnectPermission(call)) return;
        String address = call.getString("address");
        if (address == null || address.isEmpty()) {
            call.reject("Device address is required");
            return;
        }
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) {
            call.reject("Bluetooth is not supported on this device");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("Bluetooth is turned off. Turn it on in Quick Settings first.");
            return;
        }
        final BluetoothDevice device;
        try {
            device = adapter.getRemoteDevice(address);
        } catch (IllegalArgumentException e) {
            call.reject("Invalid device address");
            return;
        }
        final BluetoothSocket[] socketRef = new BluetoothSocket[1];
        executor.execute(() -> {
            try {
                BluetoothSocket s = null;
                try {
                    s = device.createRfcommSocketToServiceRecord(SPP_UUID);
                    s.connect();
                } catch (IOException first) {
                    // Many cheap printers only accept the insecure channel.
                    closeQuietly(s);
                    s = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
                    s.connect();
                }
                socketRef[0] = s;
                synchronized (this) {
                    closeSocket();
                    socket = s;
                    output = s.getOutputStream();
                    connected = true;
                    connectedAddress = address;
                }
                startReader(s);
                String name = device.getName() != null ? device.getName() : address;
                JSObject ret = new JSObject();
                ret.put("connected", true);
                ret.put("name", name);
                ret.put("address", address);
                call.resolve(ret);
                notifyListeners("connected", ret);
            } catch (Exception e) {
                closeQuietly(socketRef[0]);
                call.reject("Connection failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void write(PluginCall call) {
        String data = call.getString("data");
        if (data == null || data.isEmpty()) {
            call.reject("Data is required");
            return;
        }
        final byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("Invalid data payload");
            return;
        }
        executor.execute(() -> {
            OutputStream o;
            synchronized (this) {
                o = output;
            }
            if (o == null) {
                call.reject("Printer is not connected");
                return;
            }
            try {
                o.write(bytes);
                o.flush();
                call.resolve();
            } catch (IOException e) {
                onSocketLost();
                call.reject("Write failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        executor.execute(() -> {
            synchronized (this) {
                closeSocket();
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void isConnected(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("connected", connected);
        ret.put("address", connectedAddress);
        call.resolve(ret);
    }

    // ── Permission handling ───────────────────────────────────────────────

    @PermissionCallback
    private void permissionResult(PluginCall call) {
        if (!hasConnectPermission()) {
            call.reject("Bluetooth permission denied");
            return;
        }
        String method = call.getMethodName();
        if ("getPairedDevices".equals(method)) {
            getPairedDevices(call);
        } else if ("connect".equals(method)) {
            connect(call);
        } else {
            call.resolve();
        }
    }

    private boolean ensureConnectPermission(PluginCall call) {
        if (hasConnectPermission()) return true;
        requestPermissionForAlias("connect", call, "permissionResult");
        return false;
    }

    private boolean hasConnectPermission() {
        // BLUETOOTH_CONNECT only exists on API 31+; below that the legacy
        // BLUETOOTH/BLUETOOTH_ADMIN permissions are install-time only.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        return getPermissionState("connect") == com.getcapacitor.PermissionState.GRANTED;
    }

    // ── Connection plumbing ───────────────────────────────────────────────

    private void startReader(BluetoothSocket s) {
        Thread t = new Thread(() -> {
            try {
                InputStream in = s.getInputStream();
                byte[] buf = new byte[256];
                while (in.read(buf) >= 0) {
                    // Printer status bytes; nothing to do with them.
                }
            } catch (IOException ignored) {
                // Socket died — treat as disconnection.
            }
            onSocketLost();
        });
        t.setDaemon(true);
        t.start();
    }

    private synchronized void onSocketLost() {
        if (connected) {
            closeSocket();
            notifyListeners("disconnected", new JSObject());
        }
    }

    private synchronized void closeSocket() {
        if (socket != null) {
            try {
                socket.close();
            } catch (IOException ignored) {
            }
            socket = null;
        }
        output = null;
        connected = false;
        connectedAddress = null;
    }

    private static void closeQuietly(BluetoothSocket s) {
        if (s == null) return;
        try {
            s.close();
        } catch (IOException ignored) {
        }
    }

    @Override
    protected void handleOnDestroy() {
        executor.execute(() -> {
            synchronized (this) {
                closeSocket();
            }
        });
    }
}
