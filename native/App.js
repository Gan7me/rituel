/* Rituel — coquille native (Expo).
   Un seul écran : la web app hébergée, en plein écran, avec ce que le web ne sait pas faire seul sur iOS :
   notification locale à la fin du repos même téléphone verrouillé, push du coach, retour haptique,
   écran maintenu allumé pendant la séance. Le pont web ↔ natif passe par postMessage (JSON). */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Platform, StyleSheet, View, Linking, AppState, useColorScheme, ActivityIndicator, Text, Pressable } from 'react-native';
import { WebView } from 'react-native-webview';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import * as Device from 'expo-device';
import * as KeepAwake from 'expo-keep-awake';
import * as SplashScreen from 'expo-splash-screen';
import Constants from 'expo-constants';
import { SafeAreaProvider } from 'react-native-safe-area-context';
// Apple Santé (HealthKit) : lecture du poids, écriture des séances comme entraînements de force. Module optionnel : sans lui, le web n'affiche pas l'option.
let HK = null; try { HK = require('@kingstinct/react-native-healthkit'); } catch (e) { HK = null; }
async function hkAvailable() { try { return !!HK && Platform.OS === 'ios' && (await HK.isHealthDataAvailable()); } catch (e) { return false; } }
async function hkAuthorize() {
  await HK.requestAuthorization(['HKQuantityTypeIdentifierBodyMass', 'HKWorkoutTypeIdentifier'], ['HKQuantityTypeIdentifierBodyMass', 'HKWorkoutTypeIdentifier', 'HKQuantityTypeIdentifierActiveEnergyBurned']);
}
async function hkReadWeight(days) {
  const from = new Date(Date.now() - (days || 90) * 86400000);
  const samples = await HK.queryQuantitySamples('HKQuantityTypeIdentifierBodyMass', { from, unit: 'kg', ascending: false, limit: 200 });
  return (samples || []).map(s => ({ date: new Date(s.startDate).toISOString().slice(0, 10), kg: Math.round(s.quantity * 10) / 10, at: new Date(s.startDate).getTime() }));
}
async function hkWriteWorkout(w) {
  const start = new Date(w.start), end = new Date(w.end);
  const totals = w.kcal ? { energyBurned: w.kcal, energyBurnedUnit: 'kcal' } : {};
  await HK.saveWorkoutSample('HKWorkoutActivityTypeTraditionalStrengthTraining', [], start, end, totals, { HKMetadataKeyWorkoutBrandName: 'Rituel', title: w.title || 'Séance Rituel' });
}
// Abonnements (App Store / Google Play) via RevenueCat. Sans clé configurée, tout reste inactif et le web garde son écran « me prévenir ».
let Purchases = null; try { Purchases = require('react-native-purchases').default; } catch (e) { Purchases = null; }
const RC_KEYS = (Constants.expoConfig && Constants.expoConfig.extra && Constants.expoConfig.extra.revenuecat) || {};
const RC_KEY = Platform.OS === 'ios' ? RC_KEYS.ios : RC_KEYS.android;
let rcReady = false;
async function rcInit(uid) {
  if (!Purchases || !RC_KEY) return false;
  try { if (!rcReady) { Purchases.configure({ apiKey: RC_KEY, appUserID: uid || null }); rcReady = true; } else if (uid) { await Purchases.logIn(uid); } return true; } catch (e) { return false; }
}
function pkgInfo(p) { const pr = p.product || {}; return { id: p.identifier, type: p.packageType, title: pr.title, price: pr.priceString, period: pr.subscriptionPeriod || '', intro: pr.introPrice ? pr.introPrice.priceString : null, priceAmount: pr.price, currency: pr.currencyCode }; }
function isPremium(info) { const e = info && info.entitlements && info.entitlements.active; return !!(e && (e.premium || Object.keys(e).length)); }

const WEB_URL = (Constants.expoConfig && Constants.expoConfig.extra && Constants.expoConfig.extra.webUrl) || 'https://rituel-6b365.web.app';
const HOST = new URL(WEB_URL).host;
SplashScreen.preventAutoHideAsync().catch(() => {});

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

async function registerPush() {
  if (!Device.isDevice) return null;
  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (status !== 'granted') { const r = await Notifications.requestPermissionsAsync(); status = r.status; }
  if (status !== 'granted') return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('rituel', { name: 'Rituel', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 200, 100, 200], lightColor: '#D8382B' });
  }
  const projectId = Constants.expoConfig && Constants.expoConfig.extra && Constants.expoConfig.extra.eas && Constants.expoConfig.extra.eas.projectId;
  try { const t = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined); return t.data; } catch (e) { return null; }
}

function Shell() {
  const web = useRef(null);
  const scheme = useColorScheme();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const restNotif = useRef(null);
  const bg = scheme === 'dark' ? '#0B0D10' : '#F4F5F7';

  const send = useCallback((msg) => { try { web.current && web.current.postMessage(JSON.stringify(msg)); } catch (e) {} }, []);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(() => { send({ type: 'notificationOpened' }); });
    const app = AppState.addEventListener('change', (s) => { if (s === 'active') send({ type: 'resume' }); });
    return () => { sub.remove(); app.remove(); };
  }, [send]);

  const onMessage = useCallback(async (e) => {
    let m; try { m = JSON.parse(e.nativeEvent.data); } catch (x) { return; }
    switch (m.type) {
      case 'ready': {
        setReady(true); SplashScreen.hideAsync().catch(() => {});
        const token = await registerPush(); if (token) send({ type: 'pushToken', token, platform: Platform.OS });
        break;
      }
      case 'haptic': {
        const k = m.kind === 'success' ? Haptics.NotificationFeedbackType.Success : null;
        if (k) Haptics.notificationAsync(k).catch(() => {}); else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        break;
      }
      case 'restTimer': {
        // Notification locale à la fin du repos : sonne même si le téléphone est verrouillé.
        if (restNotif.current) { Notifications.cancelScheduledNotificationAsync(restNotif.current).catch(() => {}); restNotif.current = null; }
        const sec = Math.max(1, Math.round(Number(m.seconds) || 0));
        try {
          restNotif.current = await Notifications.scheduleNotificationAsync({
            content: { title: m.title || 'Repos terminé', body: m.body || 'Série suivante', sound: true, ...(Platform.OS === 'android' ? { channelId: 'rituel' } : {}) },
            trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: sec, repeats: false },
          });
        } catch (x) {}
        break;
      }
      case 'cancelTimer': {
        if (restNotif.current) { Notifications.cancelScheduledNotificationAsync(restNotif.current).catch(() => {}); restNotif.current = null; }
        break;
      }
      case 'keepAwake': {
        if (m.on) KeepAwake.activateKeepAwakeAsync('seance').catch(() => {}); else KeepAwake.deactivateKeepAwake('seance').catch(() => {});
        break;
      }
      case 'open': { if (m.url) Linking.openURL(m.url).catch(() => {}); break; }
      case 'health': {
        const avail = await hkAvailable();
        if (!avail) { send({ type: 'healthResult', action: m.action, ok: false, available: false }); break; }
        try {
          if (m.action === 'status') send({ type: 'healthResult', action: 'status', ok: true, available: true });
          else if (m.action === 'authorize') { await hkAuthorize(); send({ type: 'healthResult', action: 'authorize', ok: true, available: true }); }
          else if (m.action === 'readWeight') { const samples = await hkReadWeight(m.days); send({ type: 'healthResult', action: 'readWeight', ok: true, available: true, samples }); }
          else if (m.action === 'writeWorkout') { await hkWriteWorkout(m.workout || {}); send({ type: 'healthResult', action: 'writeWorkout', ok: true, available: true }); }
        } catch (e) { send({ type: 'healthResult', action: m.action, ok: false, available: true, error: String(e && e.message || e) }); }
        break;
      }
      case 'user': { // le web signale l'utilisateur connecté : on relie l'abonnement à son identifiant Firebase
        const ok = await rcInit(m.uid);
        if (ok) { try { const info = await Purchases.getCustomerInfo(); send({ type: 'entitlement', premium: isPremium(info) }); } catch (e) {} }
        send({ type: 'billingReady', available: ok });
        break;
      }
      case 'getOfferings': {
        if (!(await rcInit(m.uid))) { send({ type: 'offerings', packages: [] }); break; }
        try { const o = await Purchases.getOfferings(); const cur = o && o.current; send({ type: 'offerings', packages: cur ? cur.availablePackages.map(pkgInfo) : [] }); }
        catch (e) { send({ type: 'offerings', packages: [], error: String(e && e.message || e) }); }
        break;
      }
      case 'purchase': {
        if (!(await rcInit(m.uid))) { send({ type: 'purchaseResult', ok: false, error: 'indisponible' }); break; }
        try { const o = await Purchases.getOfferings(); const pkg = o && o.current && o.current.availablePackages.find(p => p.identifier === m.packageId); if (!pkg) throw new Error('offre introuvable');
          const r = await Purchases.purchasePackage(pkg); send({ type: 'purchaseResult', ok: true, premium: isPremium(r.customerInfo) }); }
        catch (e) { send({ type: 'purchaseResult', ok: false, cancelled: !!(e && e.userCancelled), error: String(e && e.message || e) }); }
        break;
      }
      case 'restore': {
        if (!(await rcInit(m.uid))) { send({ type: 'purchaseResult', ok: false, error: 'indisponible' }); break; }
        try { const info = await Purchases.restorePurchases(); send({ type: 'purchaseResult', ok: true, restored: true, premium: isPremium(info) }); }
        catch (e) { send({ type: 'purchaseResult', ok: false, error: String(e && e.message || e) }); }
        break;
      }
      default: break;
    }
  }, [send]);

  // Seules les navigations de premier niveau vers un autre site sortent vers Safari ; les iframes et les domaines
  // techniques (Firebase Auth, Google APIs) restent dans la WebView, sinon la connexion ouvrait une page web.
  const ALLOWED = /(^|\.)(rituel-6b365\.web\.app|rituel-6b365\.firebaseapp\.com|firebaseapp\.com|googleapis\.com|gstatic\.com|google\.com|firebase\.com)$/i;
  const onShouldStart = useCallback((req) => {
    try {
      if (req.isTopFrame === false) return true;
      const u = new URL(req.url);
      if (u.protocol === 'about:' || u.host === HOST || ALLOWED.test(u.host)) return true;
      Linking.openURL(req.url).catch(() => {}); return false;
    } catch (e) { return true; }
  }, []);

  const injected = `window.__RITUEL_NATIVE__={platform:'${Platform.OS}',version:'${Constants.expoConfig ? Constants.expoConfig.version : ''}'}; true;`;

  return (
      <View style={[styles.root, { backgroundColor: bg }]}>
        {/* Bord à bord : la page web gère elle-même les zones système (safe-area-inset-top / bottom, viewport-fit=cover),
            comme une app native moderne. Plus de bande en bas sous l'indicateur d'accueil. */}
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} translucent backgroundColor="transparent" />
        {failed ? (
          <View style={[styles.center, { backgroundColor: bg }]}>
            <Text style={[styles.err, { color: scheme === 'dark' ? '#F2F4F6' : '#0F1216' }]}>Rituel n'arrive pas à se charger.{'\n'}Ouvre l'app une première fois avec du réseau, ensuite elle fonctionne hors ligne.</Text>
            <Pressable onPress={() => { setFailed(false); web.current && web.current.reload(); }} style={styles.btn}><Text style={styles.btnT}>Réessayer</Text></Pressable>
          </View>
        ) : null}
        <WebView
          ref={web}
          source={{ uri: WEB_URL }}
          style={[styles.web, { backgroundColor: bg, opacity: failed ? 0 : 1 }]}
          onMessage={onMessage}
          onShouldStartLoadWithRequest={onShouldStart}
          onError={() => { setFailed(true); SplashScreen.hideAsync().catch(() => {}); }}
          onLoadEnd={() => { setTimeout(() => { setReady(true); SplashScreen.hideAsync().catch(() => {}); }, 400); }}
          injectedJavaScriptBeforeContentLoaded={injected}
          allowsBackForwardNavigationGestures={false}
          allowsInlineMediaPlayback
          scalesPageToFit={false}
          setBuiltInZoomControls={false}
          mediaPlaybackRequiresUserAction={false}
          bounces={false}
          overScrollMode="never"
          setSupportMultipleWindows={false}
          pullToRefreshEnabled={false}
          domStorageEnabled
          javaScriptEnabled
          sharedCookiesEnabled
          cacheEnabled
          applicationNameForUserAgent="RituelApp"
          limitsNavigationsToAppBoundDomains
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          startInLoadingState
          renderLoading={() => <View style={[styles.center, { backgroundColor: bg }]}><ActivityIndicator color="#D8382B" /></View>}
        />
      </View>
  );
}

export default function App() {
  return (<SafeAreaProvider><Shell /></SafeAreaProvider>);
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  web: { flex: 1 },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 2, padding: 24 },
  err: { fontSize: 16, textAlign: 'center', marginBottom: 16, lineHeight: 22 },
  btn: { backgroundColor: '#D8382B', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 999 },
  btnT: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
