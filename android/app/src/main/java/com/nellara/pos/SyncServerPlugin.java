package com.nellara.pos;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.util.Collections;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Embedded WebSocket server that turns this device into the LAN sync hub.
 *
 * A WebView cannot listen on a TCP port, so the hub lives here in native code
 * (Java-WebSocket). The web layer decides the protocol (pairing, snapshots,
 * merges); this plugin is a dumb JSON-message transport:
 *
 *   start(port)       — bind the server, resolve with local IPv4 addresses
 *   stop()            — unbind
 *   broadcast(msg)    — send to every connected client
 *   sendTo(id, msg)   — send to one client (by connectionId)
 *   close(id)         — drop a client (used when the pairing code is wrong)
 *
 * Events: syncClientConnected / syncClientDisconnected {connectionId, count},
 * syncMessage {connectionId, message}. Connection ids are assigned by the
 * plugin; the web layer maps them to device ids from the "hello" message.
 */
@CapacitorPlugin(name = "SyncServer")
public class SyncServerPlugin extends Plugin {

    private static final int MIN_PORT = 1024;
    private static final int MAX_PORT = 65535;

    private WebSocketServer server;
    private int port;
    private final AtomicInteger nextConnId = new AtomicInteger(1);
    private final Map<WebSocket, Integer> connIds = new ConcurrentHashMap<>();

    @PluginMethod
    public void start(PluginCall call) {
        Integer p = call.getInt("port", 8765);
        if (p == null || p < MIN_PORT || p > MAX_PORT) {
            call.reject("Port must be between " + MIN_PORT + " and " + MAX_PORT);
            return;
        }
        // Idempotent: a restart (new port/code) must not fail because an old
        // server instance is still bound.
        if (server != null) {
            stopServerAsync();
        }
        final int targetPort = p;
        try {
            WebSocketServer s = new WebSocketServer(new InetSocketAddress(targetPort)) {
                @Override
                public void onOpen(WebSocket conn, ClientHandshake handshake) {
                    int id = nextConnId.getAndIncrement();
                    connIds.put(conn, id);
                    JSObject ret = new JSObject();
                    ret.put("connectionId", id);
                    ret.put("count", connIds.size());
                    notifyListeners("syncClientConnected", ret);
                }

                @Override
                public void onMessage(WebSocket conn, String message) {
                    Integer id = connIds.get(conn);
                    if (id == null) return;
                    JSObject ret = new JSObject();
                    ret.put("connectionId", id);
                    ret.put("message", message);
                    notifyListeners("syncMessage", ret);
                }

                @Override
                public void onClose(WebSocket conn, int code, String reason, boolean remote) {
                    Integer id = connIds.remove(conn);
                    if (id != null) {
                        JSObject ret = new JSObject();
                        ret.put("connectionId", id);
                        ret.put("count", connIds.size());
                        notifyListeners("syncClientDisconnected", ret);
                    }
                }

                @Override
                public void onError(WebSocket conn, Exception ex) {
                    // Logged; onClose still fires for the affected socket.
                }

                @Override
                public void onStart() {
                }
            };
            s.setReuseAddr(true);
            s.start();
            server = s;
            port = targetPort;
            JSObject ret = new JSObject();
            ret.put("running", true);
            ret.put("port", targetPort);
            ret.put("addresses", getLocalAddresses());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not start sync hub: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopServerAsync();
        call.resolve();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("running", server != null);
        ret.put("port", port);
        ret.put("count", server != null ? connIds.size() : 0);
        ret.put("addresses", getLocalAddresses());
        call.resolve(ret);
    }

    @PluginMethod
    public void broadcast(PluginCall call) {
        String message = call.getString("message");
        if (message == null) {
            call.reject("message is required");
            return;
        }
        if (server == null) {
            call.reject("Sync hub is not running");
            return;
        }
        for (WebSocket conn : connIds.keySet()) {
            if (conn.isOpen()) conn.send(message);
        }
        call.resolve();
    }

    @PluginMethod
    public void sendTo(PluginCall call) {
        String message = call.getString("message");
        Integer connectionId = call.getInt("connectionId");
        if (message == null || connectionId == null) {
            call.reject("message and connectionId are required");
            return;
        }
        for (Map.Entry<WebSocket, Integer> e : connIds.entrySet()) {
            if (e.getValue().equals(connectionId) && e.getKey().isOpen()) {
                e.getKey().send(message);
                call.resolve();
                return;
            }
        }
        call.reject("Connection not found");
    }

    @PluginMethod
    public void close(PluginCall call) {
        Integer connectionId = call.getInt("connectionId");
        if (connectionId == null) {
            call.reject("connectionId is required");
            return;
        }
        for (Map.Entry<WebSocket, Integer> e : connIds.entrySet()) {
            if (e.getValue().equals(connectionId)) {
                e.getKey().close();
                call.resolve();
                return;
            }
        }
        call.resolve();
    }

    private JSArray getLocalAddresses() {
        JSArray arr = new JSArray();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress addr : Collections.list(ni.getInetAddresses())) {
                    if (addr instanceof Inet4Address && !addr.isLoopbackAddress()) {
                        arr.put(addr.getHostAddress());
                    }
                }
            }
        } catch (SocketException ignored) {
        }
        return arr;
    }

    private synchronized void stopServerAsync() {
        if (server == null) return;
        final WebSocketServer s = server;
        server = null;
        connIds.clear();
        Thread t = new Thread(() -> {
            try {
                s.stop();
            } catch (Exception ignored) {
            }
        });
        t.setDaemon(true);
        t.start();
    }

    @Override
    protected void handleOnDestroy() {
        stopServerAsync();
    }
}
