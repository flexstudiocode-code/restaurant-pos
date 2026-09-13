import { useEffect, useRef } from 'react';
import { useStore } from './store';
import { SyncHub } from './syncHub';
import { SyncClient, type WelcomeSnapshot } from './syncClient';
import { getDeviceId, getDeviceName } from './syncDevice';
import { diffKotsToPush, diffOrdersToPush, mergeKots, mergeOrders } from './syncMerge';

/**
 * Wires the store to the LAN sync transport. Renders nothing. One instance
 * mounts inside StoreProvider; it owns the SyncHub (this device as collector)
 * and the SyncClient (this device connected to a collector), driven by the
 * `sync` state the Settings screen edits.
 *
 * Dirty-tracking: orders/kots carry `updatedAt`; a hub broadcasts orders newer
 * than the last broadcast, a client pushes orders newer than the last push.
 * Merges preserve incoming updatedAt values, so changes never echo back to the
 * device they originated from.
 */
export function SyncEngine() {
  const store = useStore();
  const stateRef = useRef(store.state);
  stateRef.current = store.state;

  const hubRef = useRef<SyncHub | null>(null);
  const clientRef = useRef<SyncClient | null>(null);
  const lastBroadcastOrders = useRef(new Map<string, number>());
  const lastBroadcastKots = useRef(new Map<string, number>());
  const lastMenuSig = useRef('');
  const lastSettingsSig = useRef('');
  const lastPushedOrders = useRef(new Map<string, number>());
  const lastPushedKots = useRef(new Map<string, number>());

  const applyWelcome = (snap: WelcomeSnapshot) => {
    const storeNow = stateRef.current;
    store.syncApplyMenu(snap.categories, snap.items);
    store.syncApplySettings(snap.billing, snap.profile, snap.auth);
    store.syncApplyOrders(snap.orders);
    store.syncApplyKots(snap.kots);
    store.syncApplyCounter(snap.invoiceCounter);
    for (const o of mergeOrders(storeNow.orders, snap.orders)) {
      lastPushedOrders.current.set(o.id, o.updatedAt ?? o.createdAt);
    }
    for (const k of mergeKots(storeNow.kots, snap.kots)) {
      lastPushedKots.current.set(k.id, k.updatedAt ?? k.createdAt);
    }
    const toPush = diffOrdersToPush(storeNow.orders, snap.orders);
    if (toPush.length > 0) clientRef.current?.pushOrders(toPush);
    const kotsToPush = diffKotsToPush(storeNow.kots, snap.kots);
    if (kotsToPush.length > 0) clientRef.current?.pushKots(kotsToPush);
  };

  if (hubRef.current === null) {
    hubRef.current = new SyncHub({
      getSnapshot: () => ({
        categories: stateRef.current.categories,
        items: stateRef.current.items,
        billing: stateRef.current.billing,
        profile: stateRef.current.profile,
        auth: stateRef.current.auth,
        orders: stateRef.current.orders,
        kots: stateRef.current.kots,
        invoiceCounter: stateRef.current.invoiceCounter,
      }),
      onOrders: (orders, originDeviceId) => {
        const hub = hubRef.current;
        if (!hub) return;
        const { corrections, counter } = store.syncApplyOrders(orders);
        if (corrections.length > 0) {
          const origin = hub.clientList.find((c) => c.deviceId === originDeviceId);
          if (origin) {
            void hub.sendTo(origin.connectionId, { type: 'counter-correction', invoiceCounter: counter });
          }
        }
      },
      onKots: (kots) => {
        store.syncApplyKots(kots);
      },
      onClientListChange: (clients) => store.syncSetState({ hubClients: clients }),
      onError: (msg) => store.notify(msg, 'err'),
    });
    clientRef.current = new SyncClient({
      onWelcome: (snap) => applyWelcome(snap),
      onOrders: (orders) => {
        for (const o of orders) lastPushedOrders.current.set(o.id, o.updatedAt ?? o.createdAt);
        store.syncApplyOrders(orders);
      },
      onKots: (kots) => {
        for (const k of kots) lastPushedKots.current.set(k.id, k.updatedAt ?? k.createdAt);
        store.syncApplyKots(kots);
      },
      onMenu: (categories, items) => store.syncApplyMenu(categories, items),
      onSettings: (billing, profile, auth) => store.syncApplySettings(billing, profile, auth),
      onCounter: (counter) => store.syncApplyCounter(counter),
      onStatus: (clientState, clientError) => store.syncSetState({ clientState, clientError: clientError ?? '' }),
    });
  }

  useEffect(() => {
    const hub = hubRef.current;
    if (!hub) return;
    const { hubRequested, hubPort, hubPairingCode } = store.sync;
    let cancelled = false;
    if (hubRequested) {
      const settle = hub.isRunning ? hub.stop() : Promise.resolve();
      settle
        .then(() => hub.start(hubPort, hubPairingCode))
        .then(({ addresses }) => {
          if (cancelled) {
            void hub.stop();
            return;
          }
          const s = stateRef.current;
          for (const o of s.orders) lastBroadcastOrders.current.set(o.id, o.updatedAt ?? o.createdAt);
          for (const k of s.kots) lastBroadcastKots.current.set(k.id, k.updatedAt ?? k.createdAt);
          lastMenuSig.current = JSON.stringify([s.categories, s.items]);
          lastSettingsSig.current = JSON.stringify([s.billing, s.profile, s.auth]);
          store.syncSetState({ hubRunning: true, hubAddresses: addresses });
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          store.syncSetState({ hubRequested: false, hubRunning: false, hubAddresses: [], hubClients: [] });
          store.notify(e instanceof Error ? e.message : 'Could not start sync hub', 'err');
        });
    } else if (hub.isRunning) {
      void hub.stop().then(() => {
        if (!cancelled) store.syncSetState({ hubRunning: false, hubAddresses: [], hubClients: [] });
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.sync.hubRequested, store.sync.hubNonce]);

  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;
    const { clientRequested } = store.sync;
    if (clientRequested) {
      client.connect(store.sync.clientAddress, store.sync.clientPairingCode, {
        id: getDeviceId(),
        name: getDeviceName(),
        role: store.user?.role ?? 'waiter',
      });
    } else {
      client.disconnect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.sync.clientRequested, store.sync.clientNonce]);

  useEffect(() => {
    const hub = hubRef.current;
    if (!hub?.isRunning) return;
    const changed = store.state.orders.filter(
      (o) => (lastBroadcastOrders.current.get(o.id) ?? 0) < (o.updatedAt ?? o.createdAt)
    );
    if (changed.length > 0) {
      for (const o of changed) lastBroadcastOrders.current.set(o.id, o.updatedAt ?? o.createdAt);
      void hub.broadcast({ type: 'orders-update', orders: changed });
    }
  }, [store.state.orders, store.sync.hubRunning]);

  useEffect(() => {
    const hub = hubRef.current;
    if (!hub?.isRunning) return;
    const changed = store.state.kots.filter(
      (k) => (lastBroadcastKots.current.get(k.id) ?? 0) < (k.updatedAt ?? k.createdAt)
    );
    if (changed.length > 0) {
      for (const k of changed) lastBroadcastKots.current.set(k.id, k.updatedAt ?? k.createdAt);
      void hub.broadcast({ type: 'kots-update', kots: changed });
    }
  }, [store.state.kots, store.sync.hubRunning]);

  useEffect(() => {
    const hub = hubRef.current;
    if (!hub?.isRunning) return;
    const sig = JSON.stringify([store.state.categories, store.state.items]);
    if (sig !== lastMenuSig.current) {
      lastMenuSig.current = sig;
      void hub.broadcast({ type: 'menu-update', categories: store.state.categories, items: store.state.items });
    }
  }, [store.state.categories, store.state.items, store.sync.hubRunning]);

  useEffect(() => {
    const hub = hubRef.current;
    if (!hub?.isRunning) return;
    const sig = JSON.stringify([store.state.billing, store.state.profile, store.state.auth]);
    if (sig !== lastSettingsSig.current) {
      lastSettingsSig.current = sig;
      void hub.broadcast({
        type: 'settings-update',
        billing: store.state.billing,
        profile: store.state.profile,
        auth: store.state.auth,
      });
    }
  }, [store.state.billing, store.state.profile, store.state.auth, store.sync.hubRunning]);

  useEffect(() => {
    const client = clientRef.current;
    if (!client || store.sync.clientState !== 'connected') return;
    const changed = store.state.orders.filter(
      (o) => (lastPushedOrders.current.get(o.id) ?? 0) < (o.updatedAt ?? o.createdAt)
    );
    if (changed.length > 0) {
      for (const o of changed) lastPushedOrders.current.set(o.id, o.updatedAt ?? o.createdAt);
      client.pushOrders(changed);
    }
  }, [store.state.orders, store.sync.clientState]);

  useEffect(() => {
    const client = clientRef.current;
    if (!client || store.sync.clientState !== 'connected') return;
    const changed = store.state.kots.filter(
      (k) => (lastPushedKots.current.get(k.id) ?? 0) < (k.updatedAt ?? k.createdAt)
    );
    if (changed.length > 0) {
      for (const k of changed) lastPushedKots.current.set(k.id, k.updatedAt ?? k.createdAt);
      client.pushKots(changed);
    }
  }, [store.state.kots, store.sync.clientState]);

  useEffect(() => {
    const hub = hubRef.current;
    const client = clientRef.current;
    return () => {
      void hub?.stop();
      client?.disconnect();
    };
  }, []);

  return null;
}
