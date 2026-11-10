# tsukushi-stream-calendar

春日部つくしの YouTube 配信予定を Google カレンダーに自動同期する、非公式の Google Apps Script（GAS）です。

**このリポジトリと共有カレンダーは、ファン個人が制作・運営しています。春日部つくしさんご本人および公式の運営とは関係ありません。**

Google アカウントでスクリプトを実行すると、専用カレンダーを作成し、1 時間ごとに配信予定を同期します。

## カレンダーを追加する

配信予定を見るだけなら、[非公式の共有カレンダーを Google カレンダーに追加](https://calendar.google.com/calendar/u/0?cid=MGY2NGJlZDc1OTMwZWViYmRjZWMwNzExZWFjZDUxZTkwOWYxY2M1NjkyNTE0MzBjMWE1M2VmYThhNTcyNWNmZEBncm91cC5jYWxlbmRhci5nb29nbGUuY29t)してください。
スクリプトの設定や実行は不要です。

自動同期のタイミングによって、変更の反映が遅れることがあります。
最新の配信予定は [公式 YouTube チャンネル](https://www.youtube.com/channel/UCHccxX2p_9DB_HPnXSb2omw)や [X](https://x.com/kasukaBe_nyoki)で確認してください。

## 同期する内容

- 今後 30 日以内に開始予定の予約配信を登録します。
- イベント名に動画タイトル、説明欄に YouTube の動画 URL を設定します。
- 登録済みの配信はタイトルや予定日時の変更を反映し、実際の開始・終了日時を取得できた場合はそちらを優先します。
- 終了日時が不明な場合は、開始から 60 分間の予定として登録します。
- 新規イベントには開始 15 分前のポップアップ通知を設定します。
- タイトルが `【情報】` で始まる動画は除外し、登録済みのイベントがあれば削除します。

新しい配信枠はチャンネルのアップロード一覧の最新 50 件から探します。
それに加えて、終了日時が過去 30 日以内、または未来にある登録済みイベントの動画も確認します。
YouTube API から取得できない動画については、既存イベントをそのまま残します。

## 導入方法

自分の Google アカウントで同期を運用する場合は、以下の手順で設定してください。
Google カレンダーと YouTube を利用できる Google アカウントを用意してください。

1. [Google Apps Script](https://script.google.com/) で新しいプロジェクトを作成します。
2. 初期ファイルの内容を [main.gs](main.gs) に置き換えます。
3. 「プロジェクトの設定」で、`appsscript.json` マニフェスト ファイルをエディタで表示する設定を有効にします。
4. エディタに戻り、`appsscript.json` の内容をこのリポジトリの [appsscript.json](appsscript.json) に置き換えて保存します。
5. 実行する関数として `main` を選び、実行します。初回は表示されるアクセス権限を確認し、許可します。
6. 実行ログに「同期完了」が表示されることを確認します。
7. Google カレンダーで「春日部つくし 配信予定」を確認します。対象の予約配信がなければ、カレンダーは空のままです。

初回実行でカレンダーと 1 時間ごとの実行トリガーを作成します。
以降はトリガーを作成したアカウントで自動実行するため、エディタを開いておく必要はありません。

同名の所有カレンダーが既にある場合は、そのカレンダーを使います。
複数ある場合は誤ったカレンダーへの同期を防ぐため、エラーで停止します。

マニフェストには YouTube Data API v3 と Calendar API v3 の高度なサービスを設定済みです。
標準の Google Cloud プロジェクトを自分で紐づけている場合は、Cloud 側でも両方の API を有効にしてください。
Apps Script が自動作成するデフォルトの Cloud プロジェクトでは、この追加操作は不要です。
詳しくは [高度な Google サービスの設定](https://developers.google.com/apps-script/guides/services/advanced?hl=ja)を参照してください。

## 設定

[main.gs](main.gs) 冒頭の `CONFIG` で変更できます。

| 項目 | 初期値 | 用途 |
| --- | --- | --- |
| `channelId` | `UCHccxX2p_9DB_HPnXSb2omw` | 同期元の YouTube チャンネル ID |
| `calendarName` | `春日部つくし 配信予定` | 作成・検索するカレンダー名 |
| `daysAhead` | `30` | 新規登録する配信予定の範囲。現在から何日先までを対象にするか |
| `eventLookbackDays` | `30` | 登録済みイベントの追跡範囲。終了日時が現在から何日前までのものを取得するか |
| `fallbackDurationMinutes` | `60` | 終了日時が不明な場合の仮の配信時間（分） |
| `reminderMinutes` | `15` | 新規イベントの通知を開始何分前に設定するか |
| `excludedPrefix` | `【情報】` | 同期対象から除外するタイトルの先頭文字列 |

`calendarName` を変えると、変更後の名前でカレンダーを探し、なければ新しく作成します。
元のカレンダーやイベントは移動しません。
`reminderMinutes` は新規作成時だけ適用し、既存イベントの通知設定は変更しません。

## 運用

手動で同期したい場合も `main` を実行します。
実行が重なった場合は、後から開始した処理がロックの取得を試み、10 秒以内に取得できなければスキップします。

同期結果は実行ログに作成・更新・削除・変更なしの件数を出力します。
自動実行でエラーが出た場合は、Apps Script の「実行数」から該当する実行を確認してください。

`main` の実行トリガーが複数ある場合は警告を出します。
「トリガー」画面で重複を確認し、不要なものを削除してください。
既存トリガーの実行間隔は自動で変更しません。

自動同期を止めるには、「トリガー」画面で `main` のトリガーを削除します。
その後 `main` を手動実行すると、トリガーを再作成して同期を再開します。

## 春日部つくしの公式リンク

- [公式ホームページ](https://tsukushinyoki10.wixsite.com/tsukushiofficial)
- [YouTube](https://www.youtube.com/channel/UCHccxX2p_9DB_HPnXSb2omw)
- [X](https://x.com/kasukaBe_nyoki)
- [FANBOX（支援サイト）](https://kasukabe.fanbox.cc/)
- [BOOTH（グッズ）](https://kasukabe294.booth.pm/)

## ライセンス

[MIT License](LICENSE)
