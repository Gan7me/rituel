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
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

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
  const insets = useSafeAreaInsets();
  const web = useRef(null);
  const scheme = useColorScheme();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const restNotif = useRef(null);
  const bg = scheme === 'dark' ? '#0B0D10' : '#F4F5F7';
  const surface = scheme === 'dark' ? '#15181D' : '#FFFFFF';

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
      default: break;
    }
  }, [send]);

  const onShouldStart = useCallback((req) => {
    try { const u = new URL(req.url); if (u.host === HOST || u.protocol === 'about:') return true; Linking.openURL(req.url).catch(() => {}); return false; } catch (e) { return true; }
  }, []);

  const injected = `window.__RITUEL_NATIVE__={platform:'${Platform.OS}',version:'${Constants.expoConfig ? Constants.expoConfig.version : ''}'}; true;`;

  return (
      <View style={[styles.root, { backgroundColor: bg, paddingTop: insets.top }]}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} backgroundColor={bg} />
        {failed ? (
          <View style={[styles.center, { backgroundColor: bg }]}>
            <Text style={[styles.err, { color: scheme === 'dark' ? '#F2F4F6' : '#0F1216' }]}>Rituel n'arrive pas à se charger.{'\n'}Vérifie le réseau et réessaie.</Text>
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
          startInLoadingState
          renderLoading={() => <View style={[styles.center, { backgroundColor: bg }]}><ActivityIndicator color="#D8382B" /></View>}
        />
        <View style={{ height: insets.bottom, backgroundColor: surface }} />
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
