# 道の駅チェックイン（ネイティブ版・実験）

Web版「道の駅チェックイン」を、Expo（React Native）で作り直す実験プロジェクト。
最小版：駅リスト（全1,234駅）＋チェックイン＋訪問駅数のカウント。

## 試し方（iPhone）

1. App Storeで「Expo Go」を入れる
2. Snackでこのリポジトリを開く：
   https://snack.expo.dev/github.com/hystericdolls-hue/michinoeki-checkin-native
3. 表示されるQRコードを Expo Go で読み取ると、自分のiPhoneで動く

## 使い方

- 駅をタップ → 今日の日付でチェックイン（もう一度タップで今日の分を取り消し）
- 記録は端末内（AsyncStorage）に保存
- 検索は駅名・よみ・都道府県に対応

Web版： https://hystericdolls-hue.github.io/michinoeki-checkin/
