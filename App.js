import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import stationsData from './stations.json';

const STATIONS = stationsData.stations;
const STORAGE_KEY = 'michinoeki-native-v1';

function stationKey(s) {
  return s.pref + '|' + s.name;
}

function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

export default function App() {
  const [visits, setVisits] = useState({});
  const [query, setQuery] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) setVisits(JSON.parse(raw));
      } catch (e) {
        // 読み込みに失敗したら空で始める
      }
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(visits)).catch(() => {});
  }, [visits, loaded]);

  const visitedCount = useMemo(
    () => Object.values(visits).filter((v) => v && v.length > 0).length,
    [visits]
  );

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return STATIONS;
    return STATIONS.filter(
      (s) => s.name.includes(q) || s.yomi.includes(q) || s.pref.includes(q)
    );
  }, [query]);

  const toggleCheckin = (s) => {
    const key = stationKey(s);
    const today = todayStr();
    setVisits((prev) => {
      const list = prev[key] ? [...prev[key]] : [];
      const idx = list.indexOf(today);
      if (idx >= 0) {
        list.splice(idx, 1);
      } else {
        list.push(today);
        list.sort();
      }
      const next = { ...prev };
      if (list.length > 0) next[key] = list;
      else delete next[key];
      return next;
    });
  };

  const renderItem = ({ item }) => {
    const key = stationKey(item);
    const list = visits[key] || [];
    const visited = list.length > 0;
    const checkedToday = list.includes(todayStr());
    const lastDate = visited ? list[list.length - 1] : null;
    return (
      <TouchableOpacity
        style={[styles.row, visited && styles.rowVisited]}
        onPress={() => toggleCheckin(item)}
        activeOpacity={0.7}
      >
        <View style={styles.rowMain}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.sub}>
            {item.pref}
            {visited ? ' ・ ' + list.length + '回訪問 ・ 最終 ' + lastDate : ''}
          </Text>
        </View>
        <Text style={[styles.badge, checkedToday && styles.badgeOn]}>
          {checkedToday ? '✓ 今日' : visited ? '✓' : 'チェックイン'}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>道の駅チェックイン</Text>
        <Text style={styles.count}>
          訪問駅数 {visitedCount} / {STATIONS.length}
        </Text>
        <TextInput
          style={styles.search}
          placeholder="駅名・よみ・都道府県で検索"
          value={query}
          onChangeText={setQuery}
        />
        <Text style={styles.hint}>駅をタップすると今日の日付でチェックイン（もう一度タップで取り消し）</Text>
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(item) => stationKey(item)}
        renderItem={renderItem}
        initialNumToRender={20}
        windowSize={10}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { padding: 16, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: 'bold' },
  count: { fontSize: 16, marginTop: 4, color: '#333' },
  search: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 12,
    fontSize: 16,
  },
  hint: { fontSize: 12, color: '#888', marginTop: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  rowVisited: { backgroundColor: '#f0f8f0' },
  rowMain: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600' },
  sub: { fontSize: 12, color: '#777', marginTop: 2 },
  badge: {
    fontSize: 12,
    color: '#2e7d32',
    borderWidth: 1,
    borderColor: '#2e7d32',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  badgeOn: { backgroundColor: '#2e7d32', color: '#fff' },
});
