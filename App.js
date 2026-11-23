import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Modal,
  Alert,
  Share,
  Image,
  Linking,
  useColorScheme,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import stationsData from './stations.js';

const STATIONS = stationsData.stations;
const STORAGE_KEY = 'michinoeki-native-v2';
const OLD_STORAGE_KEY = 'michinoeki-native-v1';
const THEME_KEY = 'michinoeki-native-theme';

const PREFS = [];
const PREF_TOTAL = {};
for (const s of STATIONS) {
  if (!PREFS.includes(s.pref)) PREFS.push(s.pref);
  PREF_TOTAL[s.pref] = (PREF_TOTAL[s.pref] || 0) + 1;
}

function stationKey(name, pref) {
  return pref + '|' + name;
}

function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const then = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - then) / 86400000);
}

function makeEntry(name, pref, date, memo) {
  return {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    name,
    pref,
    date,
    memo: memo || '',
    photo: '',
    lat: null,
    lng: null,
  };
}

// 写真の保存先URLを返す（Snack版では選んだ写真の場所をそのまま使う）
async function persistPhoto(tempUri, entryId) {
  return tempUri;
}

// 現在地を取得（許可がない・取れない場合は null）
async function fetchPosition() {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise((resolve) => setTimeout(() => resolve(null), 6000)),
    ]);
    if (!pos || !pos.coords) return null;
    return {
      lat: Math.round(pos.coords.latitude * 100000) / 100000,
      lng: Math.round(pos.coords.longitude * 100000) / 100000,
    };
  } catch (e) {
    return null;
  }
}

// 旧バージョン（マップ形式）から新形式（entries配列）へ変換
function convertOldRecords(records) {
  const entries = [];
  for (const key of Object.keys(records || {})) {
    const [pref, name] = key.split('|');
    const dates = Array.isArray(records[key]) ? records[key] : [];
    for (const date of dates) {
      entries.push({ id: 'old-' + key + '-' + date, name, pref, date, memo: '', photo: '', lat: null, lng: null });
    }
  }
  return entries;
}

// バックアップJSON（Web版互換）を entries 配列に変換。失敗したら null
// 日付不明の記録（date なし）は date:'' として取り込む
function parseBackup(text) {
  try {
    const d = JSON.parse(text);
    if (d && Array.isArray(d.entries)) {
      return d.entries
        .filter((e) => e && e.name && e.pref)
        .map((e) => ({
          id: e.id || 'imp-' + e.pref + '-' + e.name + '-' + (e.date || 'unknown'),
          name: e.name,
          pref: e.pref,
          date: e.date || '',
          memo: e.memo || '',
          photo:
            typeof e.photo === 'string' && e.photo.indexOf('file://') === 0
              ? e.photo
              : '',
          lat: typeof e.lat === 'number' ? e.lat : null,
          lng: typeof e.lng === 'number' ? e.lng : null,
        }));
    }
    if (Array.isArray(d)) return parseBackup(JSON.stringify({ entries: d }));
    if (d && typeof d === 'object') return convertOldRecords(d);
  } catch (e) {
    return null;
  }
  return null;
}

// 都道府県ごとの訪問済み駅数
function visitedByPref(entries) {
  const map = {};
  for (const e of entries) {
    if (!map[e.pref]) map[e.pref] = new Set();
    map[e.pref].add(e.name);
  }
  return map;
}

// 完全制覇した都道府県の数（その県の全駅を訪問）
function countConquered(entries) {
  const byPref = visitedByPref(entries);
  let n = 0;
  for (const p of PREFS) {
    if (byPref[p] && PREF_TOTAL[p] && byPref[p].size >= PREF_TOTAL[p]) n += 1;
  }
  return n;
}

// 都道府県別の進み具合（訪問のある県だけ、進み具合の高い順）
function prefProgress(entries) {
  const byPref = visitedByPref(entries);
  return PREFS.filter((p) => byPref[p])
    .map((p) => ({ pref: p, got: byPref[p].size, total: PREF_TOTAL[p] || 0 }))
    .sort((a, b) => b.got / b.total - a.got / a.total || b.got - a.got);
}

export default function App() {
  const systemScheme = useColorScheme();
  const [entries, setEntries] = useState([]);
  const [query, setQuery] = useState('');
  const [prefFilter, setPrefFilter] = useState('すべて');
  const [loaded, setLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prefModalOpen, setPrefModalOpen] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [checkinTarget, setCheckinTarget] = useState(null);
  const [draftPhoto, setDraftPhoto] = useState(null);
  const [draftMemo, setDraftMemo] = useState('');
  const [viewEntry, setViewEntry] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [theme, setTheme] = useState(null); // 'light' | 'dark' | null(システム)

  const dark = theme ? theme === 'dark' : systemScheme === 'dark';
  const C = dark ? DARK : LIGHT;

  useEffect(() => {
    (async () => {
      try {
        const savedTheme = await AsyncStorage.getItem(THEME_KEY);
        if (savedTheme === 'light' || savedTheme === 'dark') setTheme(savedTheme);
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setEntries(parsed);
        } else {
          const oldRaw = await AsyncStorage.getItem(OLD_STORAGE_KEY);
          if (oldRaw) {
            const converted = convertOldRecords(JSON.parse(oldRaw));
            setEntries(converted);
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(converted));
          }
        }
      } catch (e) {
        // 読み込み失敗時は空で開始
      }
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries)).catch(() => {});
  }, [entries, loaded]);

  const today = todayStr();

  const stationStats = useMemo(() => {
    const map = {};
    for (const e of entries) {
      const k = stationKey(e.name, e.pref);
      if (!map[k])
        map[k] = { count: 0, last: '', hasToday: false, hasUnknown: false, latest: null };
      map[k].count += 1;
      if (!map[k].latest || e.date >= (map[k].latest.date || '')) map[k].latest = e;
      if (e.date) {
        if (e.date > map[k].last) map[k].last = e.date;
        if (e.date === today) map[k].hasToday = true;
      } else {
        map[k].hasUnknown = true;
      }
    }
    return map;
  }, [entries, today]);

  const visitedCount = Object.keys(stationStats).length;
  const conquered = useMemo(() => countConquered(entries), [entries]);
  const progress = useMemo(() => prefProgress(entries), [entries]);

  const lastDate = useMemo(() => {
    let last = '';
    for (const e of entries) if (e.date && e.date > last) last = e.date;
    return last;
  }, [entries]);
  const since = daysSince(lastDate);
  const lastLabel = !lastDate ? '—' : since === 0 ? '今日' : since + '日前';

  // 各記録が「その駅の何回目の訪問か」
  const rankMap = useMemo(() => {
    const map = {};
    const counts = {};
    const asc = [...entries].sort((a, b) => {
      const da = a.date || '9999-99-99';
      const db = b.date || '9999-99-99';
      return da < db ? -1 : da > db ? 1 : 0;
    });
    for (const e of asc) {
      const k = stationKey(e.name, e.pref);
      counts[k] = (counts[k] || 0) + 1;
      map[e.id] = counts[k];
    }
    return map;
  }, [entries]);

  // 履歴一覧（日付ありは新しい順、日付不明は最後）
  const historyList = useMemo(() => {
    return [...entries].sort((a, b) => {
      if (a.date && b.date) return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
      if (a.date) return -1;
      if (b.date) return 1;
      return 0;
    });
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim();
    return STATIONS.filter((s) => {
      if (prefFilter !== 'すべて' && s.pref !== prefFilter) return false;
      if (!q) return true;
      return s.name.includes(q) || s.yomi.includes(q) || s.pref.includes(q);
    });
  }, [query, prefFilter]);

  function openCheckin(station) {
    const st = stationStats[stationKey(station.name, station.pref)];
    if (st && st.hasToday) {
      Alert.alert(
        'チェックインを取り消しますか？',
        station.name + ' の今日のチェックインを取り消します。',
        [
          { text: 'やめる', style: 'cancel' },
          {
            text: '取り消す',
            style: 'destructive',
            onPress: () => {
              setEntries((prev) =>
                prev.filter(
                  (e) =>
                    !(e.name === station.name && e.pref === station.pref && e.date === today)
                )
              );
            },
          },
        ]
      );
    } else {
      setDraftPhoto(null);
      setDraftMemo('');
      setCheckinTarget(station);
    }
  }

  async function pickPhoto(fromCamera) {
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          '許可が必要です',
          fromCamera ? 'カメラの許可が必要です。' : '写真へのアクセス許可が必要です。'
        );
        return;
      }
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
      if (!result.canceled && result.assets && result.assets[0]) {
        setDraftPhoto(result.assets[0].uri);
      }
    } catch (e) {
      Alert.alert('写真を開けませんでした');
    }
  }

  async function saveCheckin() {
    if (!checkinTarget) return;
    const entry = makeEntry(checkinTarget.name, checkinTarget.pref, today, draftMemo.trim());
    if (draftPhoto) entry.photo = await persistPhoto(draftPhoto, entry.id);
    const pos = await fetchPosition();
    if (pos) {
      entry.lat = pos.lat;
      entry.lng = pos.lng;
    }
    setEntries((prev) => [...prev, entry]);
    setCheckinTarget(null);
    setDraftPhoto(null);
    setDraftMemo('');
    setViewEntry(entry);
  }

  async function shareEntry(e) {
    const text =
      '道の駅「' +
      e.name +
      '」にチェックイン！（' +
      e.pref +
      '）' +
      (e.date ? ' ' + e.date : '') +
      (e.memo ? '\n' + e.memo : '') +
      '\n#道の駅';
    try {
      await Share.share(e.photo ? { message: text, url: e.photo } : { message: text });
    } catch (err) {
      // 共有がキャンセルされた場合は何もしない
    }
  }

  function openMap(e) {
    const q = encodeURIComponent(e.name + ' ' + e.pref);
    Linking.openURL('https://www.google.com/maps/search/?api=1&query=' + q).catch(() => {});
  }

  function deleteEntry(entry) {
    Alert.alert(
      'この記録を消しますか？',
      entry.name + '（' + (entry.date || '日付不明') + '）の記録を消します。',
      [
        { text: 'やめる', style: 'cancel' },
        {
          text: '消す',
          style: 'destructive',
          onPress: () => {
            setEntries((prev) => prev.filter((e) => e.id !== entry.id));
          },
        },
      ]
    );
  }

  async function exportBackup() {
    const data = JSON.stringify(
      { app: 'michinoeki-checkin', version: 2, entries },
      null,
      2
    );
    try {
      await Share.share({ message: data });
    } catch (e) {
      Alert.alert('書き出しに失敗しました');
    }
  }

  function importBackup() {
    const parsed = parseBackup(importText);
    if (!parsed) {
      Alert.alert('読み込めませんでした', 'バックアップの文章が正しく貼れているか確認してください。');
      return;
    }
    Alert.alert(
      '読み込みますか？',
      '今の記録（' + entries.length + '件）を、読み込む記録（' + parsed.length + '件）で置き換えます。',
      [
        { text: 'やめる', style: 'cancel' },
        {
          text: '置き換える',
          style: 'destructive',
          onPress: () => {
            setEntries(parsed);
            setImportText('');
            setSettingsOpen(false);
          },
        },
      ]
    );
  }

  function toggleTheme() {
    const next = dark ? 'light' : 'dark';
    setTheme(next);
    AsyncStorage.setItem(THEME_KEY, next).catch(() => {});
  }

  const styles = useMemo(() => makeStyles(C), [C]);

  function renderProgress() {
    if (progress.length === 0) return null;
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>都道府県別の進み具合</Text>
        {progress.map((r) => {
          const full = r.total > 0 && r.got >= r.total;
          const pct = r.total ? Math.min(100, Math.round((r.got / r.total) * 100)) : 0;
          return (
            <View key={r.pref} style={styles.prow}>
              <View style={styles.ptop}>
                <Text style={styles.prowName}>
                  {r.pref}
                  {full ? ' 🏆' : ''}
                </Text>
                <Text style={styles.prowCount}>
                  {r.got} / {r.total}駅{full ? ' 完全制覇！' : ''}
                </Text>
              </View>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    { width: pct + '%', backgroundColor: full ? C.barFull : C.barFill },
                  ]}
                />
              </View>
            </View>
          );
        })}
      </View>
    );
  }

  function renderItem({ item }) {
    const st = stationStats[stationKey(item.name, item.pref)];
    const visited = !!st;
    const latest = st ? st.latest : null;
    return (
      <TouchableOpacity
        style={styles.stationCard}
        onPress={() => openCheckin(item)}
        activeOpacity={0.7}
      >
        {latest && latest.photo ? (
          <TouchableOpacity onPress={() => setViewEntry(latest)} activeOpacity={0.8}>
            <Image source={{ uri: latest.photo }} style={styles.thumb} />
          </TouchableOpacity>
        ) : null}
        <View style={styles.rowText}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{item.name}</Text>
          </View>
          <View style={styles.badgeRow}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{item.pref}</Text>
            </View>
            {visited && st.count > 1 ? (
              <View style={styles.badgeGold}>
                <Text style={styles.badgeGoldText}>通算{st.count}回</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.sub} numberOfLines={1}>
            {visited
              ? (st.last ? '最終訪問 ' + st.last : '日付不明の記録') +
                (latest && latest.memo ? ' ・ ' + latest.memo : '')
              : 'まだ行ってない'}
          </Text>
        </View>
        {st && st.hasToday ? (
          <View style={styles.btnDone}>
            <Text style={styles.btnDoneText}>✓ 今日</Text>
          </View>
        ) : (
          <View style={styles.btnCheckin}>
            <Text style={styles.btnCheckinText}>チェックイン</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.title}>道の駅チェックイン</Text>
          <View style={styles.headerBtns}>
            <TouchableOpacity style={styles.subBtn} onPress={() => setHistoryOpen(true)}>
              <Text style={styles.subBtnText}>📖 履歴</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.subBtn} onPress={() => setSettingsOpen(true)}>
              <Text style={styles.subBtnText}>⚙ 設定</Text>
            </TouchableOpacity>
          </View>
        </View>
        <Text style={styles.tagline}>
          立ち寄った道の駅を記録して、制覇を目指そう。全国{STATIONS.length}駅収録。
        </Text>
        <View style={styles.statsCard}>
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>訪問駅数</Text>
              <Text style={styles.statNum}>
                {visitedCount}
                <Text style={styles.statUnit}> / {STATIONS.length}</Text>
              </Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>訪問回数</Text>
              <Text style={styles.statNum}>
                {entries.length}
                <Text style={styles.statUnit}> 回</Text>
              </Text>
            </View>
          </View>
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>完全制覇した都道府県</Text>
              <Text style={styles.statNum}>
                {conquered}
                <Text style={styles.statUnit}> / {PREFS.length}</Text>
              </Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>前回の訪問から</Text>
              <Text style={styles.statNum}>{lastLabel}</Text>
            </View>
          </View>
        </View>
        {progress.length > 0 ? (
          <TouchableOpacity
            style={styles.progressToggle}
            onPress={() => setProgressOpen(!progressOpen)}
          >
            <Text style={styles.progressToggleText}>
              都道府県別の進み具合 {progressOpen ? '▴ 閉じる' : '▸ 開く'}
            </Text>
          </TouchableOpacity>
        ) : null}
        {progressOpen ? renderProgress() : null}
        <TextInput
          style={styles.search}
          placeholder="駅名・よみ・都道府県で検索"
          placeholderTextColor={C.muted}
          value={query}
          onChangeText={setQuery}
        />
        <TouchableOpacity style={styles.filterBtn} onPress={() => setPrefModalOpen(true)}>
          <Text style={styles.filterBtnText}>都道府県で絞り込む：{prefFilter} ▾</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(item) => stationKey(item.name, item.pref)}
        renderItem={renderItem}
        ListEmptyComponent={
          <Text style={styles.empty}>条件に合う駅がありません</Text>
        }
        contentContainerStyle={styles.listContent}
      />
      <Modal visible={!!checkinTarget} animationType="slide" onRequestClose={() => setCheckinTarget(null)}>
        <SafeAreaView style={styles.container}>
          <ScrollView contentContainerStyle={styles.modalBody}>
            <Text style={styles.modalTitle}>チェックイン</Text>
            {checkinTarget ? (
              <View style={styles.card}>
                <Text style={styles.ciName}>{checkinTarget.name}</Text>
                <Text style={styles.sub}>
                  {checkinTarget.pref} ・ 日付：今日（{today}）
                </Text>
                <Text style={styles.note}>
                  チェックインすると、今いる場所（GPS）も一緒に記録します。
                </Text>
                {draftPhoto ? (
                  <View>
                    <Image source={{ uri: draftPhoto }} style={styles.photoPreview} />
                    <View style={styles.photoBtns}>
                      <TouchableOpacity style={styles.subBtn} onPress={() => pickPhoto(false)}>
                        <Text style={styles.subBtnText}>写真を変える</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.subBtn} onPress={() => setDraftPhoto(null)}>
                        <Text style={styles.subBtnText}>写真を消す</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View style={styles.photoBtns}>
                    <TouchableOpacity style={styles.subBtn} onPress={() => pickPhoto(true)}>
                      <Text style={styles.subBtnText}>📷 写真を撮る</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.subBtn} onPress={() => pickPhoto(false)}>
                      <Text style={styles.subBtnText}>🖼 アルバムから選ぶ</Text>
                    </TouchableOpacity>
                  </View>
                )}
                <Text style={styles.label}>メモ（任意）</Text>
                <TextInput
                  style={styles.memoInput}
                  placeholder="ひとことメモ"
                  placeholderTextColor={C.muted}
                  value={draftMemo}
                  onChangeText={setDraftMemo}
                  multiline
                />
                <TouchableOpacity style={styles.primaryBtn} onPress={saveCheckin}>
                  <Text style={styles.primaryBtnText}>チェックインする</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setCheckinTarget(null)}>
                  <Text style={styles.cancelText}>やめる</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </Modal>
      <Modal visible={historyOpen} animationType="slide" onRequestClose={() => setHistoryOpen(false)}>
        <SafeAreaView style={styles.container}>
          <View style={styles.modalBody}>
            <Text style={styles.modalTitle}>訪問履歴（{entries.length}件）</Text>
          </View>
          <FlatList
            data={historyList}
            keyExtractor={(e) => e.id}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={<Text style={styles.empty}>まだ記録がありません</Text>}
            renderItem={({ item }) => (
              <View style={styles.stationCard}>
                {item.photo ? (
                  <TouchableOpacity onPress={() => setViewEntry(item)} activeOpacity={0.8}>
                    <Image source={{ uri: item.photo }} style={styles.thumb} />
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={styles.rowText}
                  onPress={() => setViewEntry(item)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.name}>{item.name}</Text>
                  <View style={styles.badgeRow}>
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{item.pref}</Text>
                    </View>
                    {item.lat != null ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>📍位置あり</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.sub}>
                    {(item.date || '日付不明') +
                      ' ・ ' +
                      (rankMap[item.id] || 1) +
                      '回目の訪問'}
                  </Text>
                  {item.memo ? (
                    <Text style={styles.sub} numberOfLines={1}>
                      {item.memo}
                    </Text>
                  ) : null}
                </TouchableOpacity>
                <TouchableOpacity style={styles.btnCheckin} onPress={() => deleteEntry(item)}>
                  <Text style={styles.btnCheckinText}>削除</Text>
                </TouchableOpacity>
              </View>
            )}
          />
          <View style={styles.modalBody}>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => setHistoryOpen(false)}>
              <Text style={styles.primaryBtnText}>閉じる</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
      <Modal visible={prefModalOpen} animationType="slide" onRequestClose={() => setPrefModalOpen(false)}>
        <SafeAreaView style={styles.container}>
          <View style={styles.modalBody}>
            <Text style={styles.modalTitle}>都道府県を選ぶ</Text>
          </View>
          <FlatList
            data={['すべて', ...PREFS]}
            keyExtractor={(p) => p}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.prefRow}
                onPress={() => {
                  setPrefFilter(item);
                  setPrefModalOpen(false);
                }}
              >
                <Text
                  style={[
                    styles.prefRowText,
                    prefFilter === item && styles.prefRowTextActive,
                  ]}
                >
                  {item}
                </Text>
                {prefFilter === item ? <Text style={styles.prefCheck}>✓</Text> : null}
              </TouchableOpacity>
            )}
          />
          <View style={styles.modalBody}>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => setPrefModalOpen(false)}>
              <Text style={styles.primaryBtnText}>閉じる</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
      <Modal visible={settingsOpen} animationType="slide" onRequestClose={() => setSettingsOpen(false)}>
        <SafeAreaView style={styles.container}>
          <ScrollView contentContainerStyle={styles.modalBody}>
            <Text style={styles.modalTitle}>設定・バックアップ</Text>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>バックアップ</Text>
              <Text style={styles.note}>
                記録はこの端末の中にだけ保存されます。機種変更などで消えないよう、ときどき書き出して保管してください。Web版のバックアップも読み込めます。
              </Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={exportBackup}>
                <Text style={styles.primaryBtnText}>⬇️ バックアップを書き出す</Text>
              </TouchableOpacity>
              <Text style={styles.label}>バックアップを読み込む（下に貼り付け）</Text>
              <TextInput
                style={styles.importBox}
                placeholder="ここにバックアップの文章を貼り付け"
                placeholderTextColor={C.muted}
                value={importText}
                onChangeText={setImportText}
                multiline
              />
              <TouchableOpacity style={styles.subBtnWide} onPress={importBackup}>
                <Text style={styles.subBtnText}>⬆️ 読み込む（今の記録と置き換え）</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>表示</Text>
              <TouchableOpacity style={styles.subBtnWide} onPress={toggleTheme}>
                <Text style={styles.subBtnText}>
                  {dark ? '☀️ ライトモードにする' : '🌙 ダークモードにする'}
                </Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => setSettingsOpen(false)}>
              <Text style={styles.primaryBtnText}>閉じる</Text>
            </TouchableOpacity>
            <Text style={styles.note}>
              駅データは国土交通省「道の駅」一覧（2026年9月4日現在・全1,234駅）をもとに作成しています。制作：Happy Monster Select
            </Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>
      <Modal visible={!!viewEntry} animationType="fade" onRequestClose={() => setViewEntry(null)}>
        <SafeAreaView style={styles.container}>
          <ScrollView contentContainerStyle={styles.modalBody}>
            {viewEntry ? (
              <View>
                <Text style={styles.modalTitle}>{viewEntry.name}</Text>
                <Text style={styles.sub}>
                  {viewEntry.pref} ・ {viewEntry.date || '日付不明'}
                </Text>
                {viewEntry.photo ? (
                  <Image source={{ uri: viewEntry.photo }} style={styles.photoLarge} />
                ) : null}
                {viewEntry.memo ? <Text style={styles.viewMemo}>{viewEntry.memo}</Text> : null}
                <TouchableOpacity style={styles.primaryBtn} onPress={() => shareEntry(viewEntry)}>
                  <Text style={styles.primaryBtnText}>📤 共有する</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.subBtnWide} onPress={() => openMap(viewEntry)}>
                  <Text style={styles.subBtnText}>📍 地図で見る（Googleマップ）</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.subBtnWide} onPress={() => setViewEntry(null)}>
                  <Text style={styles.subBtnText}>閉じる</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const LIGHT = {
  page: '#fbfdff',
  card: '#ffffff',
  border: '#e2f0fa',
  text: '#3d5266',
  muted: '#8496a8',
  statBg: '#eef7fe',
  statNum: '#0284c7',
  primary: '#0ea5e9',
  subBg: '#e6f4fd',
  subText: '#0369a1',
  badgeBg: '#eef7fe',
  badgeText: '#0284c7',
  goldBg: '#fff3cf',
  goldText: '#9a6b00',
  barTrack: '#eaf4fb',
  barFill: '#38bdf8',
  barFull: '#e6a817',
  inputBg: '#ffffff',
  chipBg: '#e6f4fd',
};

const DARK = {
  page: '#0b1826',
  card: '#122636',
  border: '#1e3a4f',
  text: '#eaf4fb',
  muted: '#93a9bc',
  statBg: '#173349',
  statNum: '#7dd3fc',
  primary: '#0ea5e9',
  subBg: '#1e3a4f',
  subText: '#bae6fd',
  badgeBg: '#173349',
  badgeText: '#7dd3fc',
  goldBg: '#4a3a10',
  goldText: '#ffd968',
  barTrack: '#0b1826',
  barFill: '#38bdf8',
  barFull: '#e6a817',
  inputBg: '#122636',
  chipBg: '#173349',
};

function makeStyles(C) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: C.page },
    header: { paddingHorizontal: 16, paddingTop: 12 },
    headerTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    title: { fontSize: 24, fontWeight: 'bold', color: C.text, flexShrink: 1 },
    headerBtns: { flexDirection: 'row', gap: 8 },
    tagline: { fontSize: 13, color: C.muted, marginTop: 4 },
    subBtn: {
      backgroundColor: C.subBg,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    subBtnWide: {
      backgroundColor: C.subBg,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginTop: 12,
      alignItems: 'center',
    },
    subBtnText: { fontSize: 14, fontWeight: '700', color: C.subText },
    statsCard: {
      backgroundColor: C.card,
      borderWidth: 1,
      borderColor: C.border,
      borderRadius: 19,
      padding: 12,
      marginTop: 14,
    },
    statsRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
    stat: {
      flex: 1,
      backgroundColor: C.statBg,
      borderRadius: 12,
      padding: 12,
    },
    statLabel: { fontSize: 12, color: C.muted },
    statNum: { fontSize: 22, fontWeight: 'bold', color: C.statNum, marginTop: 5 },
    statUnit: { fontSize: 13, fontWeight: '600' },
    search: {
      marginTop: 14,
      borderWidth: 1,
      borderColor: C.border,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 11,
      fontSize: 15,
      color: C.text,
      backgroundColor: C.inputBg,
    },
    filterBtn: {
      marginTop: 12,
      backgroundColor: C.subBg,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
    },
    filterBtnText: { fontSize: 14, fontWeight: '700', color: C.subText },
    progressToggle: { marginTop: 12, paddingVertical: 4 },
    progressToggleText: { fontSize: 14, fontWeight: '700', color: C.statNum },
    prefRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
    },
    thumb: { width: 46, height: 46, borderRadius: 10, marginRight: 12 },
    ciName: { fontSize: 19, fontWeight: 'bold', color: C.text },
    photoPreview: { width: '100%', height: 220, borderRadius: 12, marginTop: 12 },
    photoLarge: { width: '100%', height: 300, borderRadius: 12, marginTop: 12 },
    photoBtns: { flexDirection: 'row', gap: 10, marginTop: 12, flexWrap: 'wrap' },
    memoInput: {
      borderWidth: 1,
      borderColor: C.border,
      borderRadius: 12,
      backgroundColor: C.inputBg,
      color: C.text,
      minHeight: 64,
      padding: 12,
      fontSize: 15,
      textAlignVertical: 'top',
    },
    cancelBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 6 },
    cancelText: { fontSize: 15, color: C.muted, fontWeight: '600' },
    viewMemo: { fontSize: 15, color: C.text, lineHeight: 22, marginTop: 12 },
    prefRowText: { fontSize: 16, color: C.text },
    prefRowTextActive: { fontWeight: 'bold', color: C.statNum },
    prefCheck: { fontSize: 16, color: C.statNum, fontWeight: 'bold' },
    listContent: { paddingHorizontal: 16, paddingBottom: 24 },
    card: {
      backgroundColor: C.card,
      borderWidth: 1,
      borderColor: C.border,
      borderRadius: 19,
      padding: 18,
      marginTop: 15,
    },
    cardTitle: { fontSize: 16, fontWeight: 'bold', color: C.text, marginBottom: 6 },
    prow: {
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: C.barTrack,
    },
    ptop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    prowName: { fontSize: 15, fontWeight: 'bold', color: C.text },
    prowCount: { fontSize: 14, color: C.muted },
    barTrack: {
      height: 8,
      backgroundColor: C.barTrack,
      borderRadius: 99,
      marginTop: 7,
      overflow: 'hidden',
    },
    barFill: { height: '100%', borderRadius: 99 },
    stationCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: C.card,
      borderWidth: 1,
      borderColor: C.border,
      borderRadius: 19,
      padding: 16,
      marginTop: 12,
    },
    rowText: { flex: 1 },
    nameRow: { flexDirection: 'row', alignItems: 'center' },
    name: { fontSize: 16, fontWeight: '700', color: C.text, flexShrink: 1 },
    badgeRow: { flexDirection: 'row', marginTop: 6 },
    badge: {
      backgroundColor: C.badgeBg,
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 2,
      marginRight: 6,
    },
    badgeText: { fontSize: 12, fontWeight: '700', color: C.badgeText },
    badgeGold: {
      backgroundColor: C.goldBg,
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 2,
    },
    badgeGoldText: { fontSize: 12, fontWeight: '700', color: C.goldText },
    sub: { fontSize: 12, color: C.muted, marginTop: 6 },
    btnCheckin: {
      backgroundColor: C.subBg,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginLeft: 10,
    },
    btnCheckinText: { fontSize: 13, fontWeight: '700', color: C.subText },
    btnDone: {
      backgroundColor: C.primary,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginLeft: 10,
    },
    btnDoneText: { fontSize: 13, fontWeight: '700', color: '#ffffff' },
    empty: { textAlign: 'center', color: C.muted, marginTop: 32, fontSize: 14 },
    modalBody: { padding: 16, paddingBottom: 32 },
    modalTitle: { fontSize: 22, fontWeight: 'bold', color: C.text, marginTop: 8 },
    note: { fontSize: 13, color: C.muted, lineHeight: 19, marginVertical: 8 },
    label: { fontSize: 14, fontWeight: '700', color: C.text, marginTop: 16, marginBottom: 6 },
    importBox: {
      borderWidth: 1,
      borderColor: C.border,
      borderRadius: 12,
      backgroundColor: C.inputBg,
      color: C.text,
      minHeight: 110,
      padding: 12,
      fontSize: 12,
      textAlignVertical: 'top',
    },
    primaryBtn: {
      backgroundColor: C.primary,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 16,
      marginTop: 14,
      alignItems: 'center',
    },
    primaryBtnText: { fontSize: 15, fontWeight: '700', color: '#ffffff' },
  });
}
