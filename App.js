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
  useColorScheme,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import stationsData from './stations.js';

const STATIONS = stationsData.stations;
const STORAGE_KEY = 'michinoeki-native-v2';
const OLD_STORAGE_KEY = 'michinoeki-native-v1';
const THEME_KEY = 'michinoeki-native-theme';

const PREFS = [];
for (const s of STATIONS) {
  if (!PREFS.includes(s.pref)) PREFS.push(s.pref);
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

function makeEntry(name, pref, date) {
  return {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    name,
    pref,
    date,
    memo: '',
  };
}

// 旧バージョン（マップ形式）から新形式（entries配列）へ変換
function convertOldRecords(records) {
  const entries = [];
  for (const key of Object.keys(records || {})) {
    const [pref, name] = key.split('|');
    const dates = Array.isArray(records[key]) ? records[key] : [];
    for (const date of dates) {
      entries.push({ id: 'old-' + key + '-' + date, name, pref, date, memo: '' });
    }
  }
  return entries;
}

// バックアップJSON（Web版互換）を entries 配列に変換。失敗したら null
function parseBackup(text) {
  try {
    const d = JSON.parse(text);
    if (d && Array.isArray(d.entries)) {
      return d.entries
        .filter((e) => e && e.name && e.pref && e.date)
        .map((e) => ({
          id: e.id || 'imp-' + e.pref + '-' + e.name + '-' + e.date,
          name: e.name,
          pref: e.pref,
          date: e.date,
          memo: e.memo || '',
        }));
    }
    if (Array.isArray(d)) return parseBackup(JSON.stringify({ entries: d }));
    if (d && typeof d === 'object') return convertOldRecords(d);
  } catch (e) {
    return null;
  }
  return null;
}

export default function App() {
  const systemScheme = useColorScheme();
  const [entries, setEntries] = useState([]);
  const [query, setQuery] = useState('');
  const [prefFilter, setPrefFilter] = useState('すべて');
  const [loaded, setLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
      if (!map[k]) map[k] = { count: 0, last: '', hasToday: false };
      map[k].count += 1;
      if (e.date > map[k].last) map[k].last = e.date;
      if (e.date === today) map[k].hasToday = true;
    }
    return map;
  }, [entries, today]);

  const visitedCount = Object.keys(stationStats).length;
  const conqueredPrefs = useMemo(() => {
    const set = new Set();
    for (const e of entries) set.add(e.pref);
    return set.size;
  }, [entries]);

  const lastDate = useMemo(() => {
    let last = '';
    for (const e of entries) if (e.date > last) last = e.date;
    return last;
  }, [entries]);
  const since = daysSince(lastDate);

  const filtered = useMemo(() => {
    const q = query.trim();
    return STATIONS.filter((s) => {
      if (prefFilter !== 'すべて' && s.pref !== prefFilter) return false;
      if (!q) return true;
      return s.name.includes(q) || s.yomi.includes(q) || s.pref.includes(q);
    });
  }, [query, prefFilter]);

  function toggleStation(station) {
    const k = stationKey(station.name, station.pref);
    const st = stationStats[k];
    if (st && st.hasToday) {
      setEntries((prev) =>
        prev.filter(
          (e) => !(e.name === station.name && e.pref === station.pref && e.date === today)
        )
      );
    } else {
      setEntries((prev) => [...prev, makeEntry(station.name, station.pref, today)]);
    }
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

  function renderItem({ item }) {
    const st = stationStats[stationKey(item.name, item.pref)];
    const visited = !!st;
    return (
      <TouchableOpacity
        style={[styles.row, visited && styles.rowVisited]}
        onPress={() => toggleStation(item)}
        activeOpacity={0.7}
      >
        <View style={styles.rowText}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.sub}>
            {item.pref}
            {visited ? ' ・ ' + st.count + '回訪問 ・ 最終 ' + st.last : ''}
          </Text>
        </View>
        {st && st.hasToday ? (
          <View style={styles.badgeDone}>
            <Text style={styles.badgeDoneText}>✓ 今日</Text>
          </View>
        ) : (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>チェックイン</Text>
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
          <TouchableOpacity style={styles.gearBtn} onPress={() => setSettingsOpen(true)}>
            <Text style={styles.gearText}>⚙ 設定</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.count}>
          訪問駅数 {visitedCount} / {STATIONS.length}
        </Text>
        <Text style={styles.stats}>
          都道府県 {conqueredPrefs} / {PREFS.length} 制覇
          {lastDate
            ? ' ・ 前回の訪問 ' + lastDate + (since !== null ? '（' + since + '日前）' : '')
            : ''}
        </Text>
        <TextInput
          style={styles.search}
          placeholder="駅名・よみ・都道府県で検索"
          placeholderTextColor={C.muted}
          value={query}
          onChangeText={setQuery}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chips}
          contentContainerStyle={styles.chipsInner}
        >
          {['すべて', ...PREFS].map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.chip, prefFilter === p && styles.chipActive]}
              onPress={() => setPrefFilter(p)}
            >
              <Text style={[styles.chipText, prefFilter === p && styles.chipTextActive]}>
                {p}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <Text style={styles.hint}>
          駅をタップすると今日の日付でチェックイン（もう一度タップで取り消し）
        </Text>
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(item) => stationKey(item.name, item.pref)}
        renderItem={renderItem}
        ListEmptyComponent={
          <Text style={styles.empty}>条件に合う駅がありません</Text>
        }
      />
      <Modal visible={settingsOpen} animationType="slide" onRequestClose={() => setSettingsOpen(false)}>
        <SafeAreaView style={styles.container}>
          <View style={styles.modalBody}>
            <Text style={styles.modalTitle}>設定・バックアップ</Text>
            <Text style={styles.note}>
              記録はこの端末の中にだけ保存されます。機種変更などで消えないよう、ときどき書き出して保管してください。Web版のバックアップも読み込めます。
            </Text>
            <TouchableOpacity style={styles.actionBtn} onPress={exportBackup}>
              <Text style={styles.actionText}>⬇️ バックアップを書き出す</Text>
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
            <TouchableOpacity style={styles.actionBtn} onPress={importBackup}>
              <Text style={styles.actionText}>⬆️ 読み込む（今の記録と置き換え）</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={toggleTheme}>
              <Text style={styles.actionText}>
                {dark ? '☀️ ライトモードにする' : '🌙 ダークモードにする'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.closeBtn]}
              onPress={() => setSettingsOpen(false)}
            >
              <Text style={styles.actionText}>閉じる</Text>
            </TouchableOpacity>
            <Text style={styles.note}>
              駅データは国土交通省「道の駅」一覧（2026年9月4日現在・全1,234駅）をもとに作成しています。制作：Happy Monster Select
            </Text>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const LIGHT = {
  bg: '#ffffff',
  text: '#111111',
  muted: '#777777',
  border: '#e3e3e3',
  inputBg: '#ffffff',
  visitedBg: '#eef7ee',
  chipBg: '#f0f0f0',
  chipText: '#333333',
  chipActiveBg: '#2e7d32',
  chipActiveText: '#ffffff',
  badgeBorder: '#2e7d32',
  badgeText: '#2e7d32',
  btnBg: '#f0f0f0',
};

const DARK = {
  bg: '#121212',
  text: '#f0f0f0',
  muted: '#999999',
  border: '#333333',
  inputBg: '#1e1e1e',
  visitedBg: '#1d2b1d',
  chipBg: '#262626',
  chipText: '#dddddd',
  chipActiveBg: '#2e7d32',
  chipActiveText: '#ffffff',
  badgeBorder: '#66bb6a',
  badgeText: '#66bb6a',
  btnBg: '#262626',
};

function makeStyles(C) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: C.bg },
    header: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 8,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
    },
    headerTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    title: { fontSize: 22, fontWeight: 'bold', color: C.text },
    gearBtn: {
      borderWidth: 1,
      borderColor: C.border,
      borderRadius: 16,
      paddingHorizontal: 10,
      paddingVertical: 4,
      backgroundColor: C.chipBg,
    },
    gearText: { fontSize: 13, color: C.text },
    count: { fontSize: 16, marginTop: 4, color: C.text },
    stats: { fontSize: 13, marginTop: 2, color: C.muted },
    search: {
      marginTop: 10,
      borderWidth: 1,
      borderColor: C.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontSize: 15,
      color: C.text,
      backgroundColor: C.inputBg,
    },
    chips: { marginTop: 10 },
    chipsInner: { paddingRight: 8 },
    chip: {
      backgroundColor: C.chipBg,
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: 6,
      marginRight: 8,
    },
    chipActive: { backgroundColor: C.chipActiveBg },
    chipText: { fontSize: 13, color: C.chipText },
    chipTextActive: { color: C.chipActiveText, fontWeight: 'bold' },
    hint: { fontSize: 12, color: C.muted, marginTop: 8 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
    },
    rowVisited: { backgroundColor: C.visitedBg },
    rowText: { flex: 1 },
    name: { fontSize: 16, fontWeight: '600', color: C.text },
    sub: { fontSize: 12, color: C.muted, marginTop: 2 },
    badge: {
      borderWidth: 1,
      borderColor: C.badgeBorder,
      borderRadius: 14,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    badgeText: { fontSize: 12, color: C.badgeText },
    badgeDone: {
      backgroundColor: '#2e7d32',
      borderRadius: 14,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    badgeDoneText: { fontSize: 12, color: '#ffffff', fontWeight: 'bold' },
    empty: { textAlign: 'center', color: C.muted, marginTop: 32, fontSize: 14 },
    modalBody: { flex: 1, padding: 20 },
    modalTitle: { fontSize: 20, fontWeight: 'bold', color: C.text, marginBottom: 8 },
    note: { fontSize: 13, color: C.muted, lineHeight: 19, marginVertical: 8 },
    label: { fontSize: 14, fontWeight: '600', color: C.text, marginTop: 16, marginBottom: 6 },
    importBox: {
      borderWidth: 1,
      borderColor: C.border,
      borderRadius: 8,
      backgroundColor: C.inputBg,
      color: C.text,
      minHeight: 110,
      padding: 10,
      fontSize: 12,
      textAlignVertical: 'top',
    },
    actionBtn: {
      backgroundColor: C.btnBg,
      borderRadius: 10,
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginTop: 12,
      alignItems: 'center',
    },
    closeBtn: { marginTop: 24 },
    actionText: { fontSize: 15, color: C.text, fontWeight: '600' },
  });
}
