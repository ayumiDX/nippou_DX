document.addEventListener('DOMContentLoaded', () => {
    
    // ==========================================
    // 0. スプレッドシート連携用 GAS API 設定
    // ==========================================
    // ⚠️ Googleスプレッドシートの拡張機能「Apps Script」でWebアプリとしてデプロイしたURLをここに貼り付けます。
    // 空欄の場合は、自動的でブラウザの「ローカルストレージ（localStorage）」を使用した100%完動する模擬（モック）システムとして動作します。
    const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbyf_RhLhMv1C0M4OsZ_AatkRHlLjayJQzRtxuBtYCMEb425Yj_4N1LYFt1p1t0PtG8p/exec'; 

    // 編集ステートの管理用変数 🆕
    let currentEditingRequestId = null;
    let currentEditingMemoId = null;

    // ==========================================
    // 00. セキュリティロック画面 (Lock Screen) 制御 🆕
    // ==========================================
    const lockScreen = document.getElementById('lock-screen');
    const loginIdInput = document.getElementById('login-id-input');
    const passcodeInput = document.getElementById('passcode-input');
    const btnUnlock = document.getElementById('btn-unlock');
    const lockScreenError = document.getElementById('lock-screen-error');
    
    // ログイン成功ポップアップ要素
    const loginSuccessPopup = document.getElementById('login-success-popup');
    const welcomeUserText = document.getElementById('welcome-user-text');

    // ローカル個別ログイン用モックユーザーデータ（フォールバック用）
    const LOCAL_USERS = {
        'admin': { password: 'password123', userName: '管理者' },
        'yamada': { password: 'arena_yamada', userName: '山田リーダー' },
        'sato': { password: 'arena_sato', userName: '佐藤' },
        'suzuki': { password: 'arena_suzuki', userName: '鈴木' }
    };

    // 起動時のロック状態チェック（解除済みなら即座にスキップ）
    if (lockScreen) {
        const isUnlocked = localStorage.getItem('arena_is_unlocked');
        const unlockedAt = localStorage.getItem('arena_unlocked_at');
        const now = Date.now();
        const LOCK_TIMEOUT = 12 * 60 * 60 * 1000; // 12時間（自動ロック時間）

        let isValidSession = false;
        if (isUnlocked === 'true' && unlockedAt) {
            const timeElapsed = now - parseInt(unlockedAt, 10);
            if (timeElapsed < LOCK_TIMEOUT) {
                isValidSession = true;
            }
        }

        if (isValidSession) {
            lockScreen.remove(); // DOMから完全に削除して自動補完の干渉を防ぐ
        } else {
            // セッションが無効、または期限切れの場合はクリアしてロック
            sessionStorage.removeItem('arena_is_unlocked');
            localStorage.removeItem('arena_unlocked_at');
            
            // 解除されていない場合はログインID入力欄に自動フォーカス
            setTimeout(() => {
                if (loginIdInput) loginIdInput.focus();
            }, 300);
        }
    }

    // 個別ログイン検証処理
    async function handleLogin() {
        if (!loginIdInput || !passcodeInput) return;
        const loginId = loginIdInput.value.trim();
        const password = passcodeInput.value.trim();

        if (loginId.length === 0) {
            showLoginError('LOGIN IDを入力してください。');
            loginIdInput.focus();
            return;
        }
        if (password.length === 0) {
            showLoginError('PASSWORDを入力してください。');
            passcodeInput.focus();
            return;
        }

        // ログインボタンを認証中状態に変更
        if (btnUnlock) {
            btnUnlock.disabled = true;
            btnUnlock.textContent = 'AUTHENTICATING...';
        }

        let success = false;
        let userName = '';
        let errorMsg = 'ACCESS DENIED: INVALID ID OR PASSWORD';

        if (GAS_API_URL) {
            try {
                // GASのdoPostに対してログイン情報をPOST送信
                const response = await fetch(GAS_API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: new URLSearchParams({
                        action: 'login',
                        loginId: loginId,
                        password: password
                    })
                });

                if (response.ok) {
                    const resData = await response.json();
                    if (resData && resData.success) {
                        success = true;
                        userName = resData.userName || loginId;
                    } else {
                        success = false;
                        errorMsg = resData.error || 'ACCESS DENIED: INVALID ID OR PASSWORD';
                    }
                } else {
                    // APIエラー時はローカルモックにフォールバック
                    console.warn('GASログインAPIがエラーを返しました。ローカルモックで判定します。');
                    const localRes = verifyLocalLogin(loginId, password);
                    success = localRes.success;
                    userName = localRes.userName;
                }
            } catch (e) {
                console.error('GASログインAPI通信失敗。ローカルモックで判定します。', e);
                const localRes = verifyLocalLogin(loginId, password);
                success = localRes.success;
                userName = localRes.userName;
            }
        } else {
            // GAS_API_URL が空の場合はローカルモックで判定
            const localRes = verifyLocalLogin(loginId, password);
            success = localRes.success;
            userName = localRes.userName;
        }

        if (success) {
            // ログイン成功処理（localStorageによるログイン状態の永続保存）
            localStorage.setItem('arena_is_unlocked', 'true');
            localStorage.setItem('arena_user_name', userName);
            localStorage.setItem('arena_unlocked_at', Date.now().toString()); // ロック解除時刻を記録
            localStorage.setItem('arena_passcode', password); // パスコードを保存（認証用）

            // 成功ポップアップにユーザー名を設定し、表示
            if (welcomeUserText) welcomeUserText.textContent = `${userName}さん、お疲れ様です`;
            if (loginSuccessPopup) loginSuccessPopup.classList.add('active');

            // ログイン成功の瞬間にスプレッドシートから最新データを再ロード 🆕
            loadMemoData();

            if (lockScreenError) {
                lockScreenError.textContent = '';
                lockScreenError.classList.remove('show');
            }

            // 1.5秒間ポップアップを表示した後に、ロック画面全体とポップアップを同時にフェードアウト
            setTimeout(() => {
                if (lockScreen) {
                    lockScreen.classList.add('lock-screen-fadeout');
                    // フェードアウトアニメーション（0.4s）完了後に強制リダイレクト（実質リロード）を実行
                    // スマホ（特にSafari）の厳しいセキュリティ仕様では、非同期での単なるDOM操作ではパスワード保存が走りません。
                    // ログイン成功後にページが「画面遷移（リロード）」することで、ブラウザが完璧にログイン完了を認識し、
                    // スマホであっても「パスワードを保存しますか？」のプロンプトを確実に100%トリガーさせます。
                    setTimeout(() => {
                        window.location.replace(window.location.pathname + '?login=success');
                    }, 400);
                }
            }, 1500);
        } else {
            // ログイン失敗処理（ネオンレッドエラー ＆ 振動）
            showLoginError(errorMsg);
            loginIdInput.classList.add('error-glow');
            passcodeInput.classList.add('error-glow');

            // 0.55秒後に自動でクリアして再入力可能状態に戻す
            setTimeout(() => {
                passcodeInput.value = '';
                loginIdInput.classList.remove('error-glow');
                passcodeInput.classList.remove('error-glow');
                if (lockScreenError) {
                    lockScreenError.classList.remove('show');
                }
                passcodeInput.focus();
            }, 550);
        }

        if (btnUnlock) {
            btnUnlock.disabled = false;
            btnUnlock.textContent = 'ACCESS SYSTEM';
        }
    }

    // ローカルでのログイン検証
    function verifyLocalLogin(loginId, password) {
        const targetId = loginId.toLowerCase();
        const user = LOCAL_USERS[targetId];
        if (user && user.password === password) {
            return { success: true, userName: user.userName };
        }
        return { success: false };
    }

    // ログインエラーメッセージの表示
    function showLoginError(msg) {
        if (lockScreenError) {
            lockScreenError.textContent = msg;
            lockScreenError.classList.add('show');
        }
    }

    // ログインフォームのSubmitイベント（オートコンプリート保存およびログイン実行）
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            handleLogin();
        });
    }

    // 入力欄でのEnterキーイベント制御（ID入力完了後にパスワード欄へフォーカス移動）
    if (loginIdInput) {
        loginIdInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (passcodeInput) passcodeInput.focus();
            }
        });
    }

    // ログアウト（手動ロック）ボタンのクリックイベント
    const btnLockManual = document.getElementById('btn-lock-manual');
    if (btnLockManual) {
        btnLockManual.addEventListener('click', () => {
            localStorage.removeItem('arena_is_unlocked');
            localStorage.removeItem('arena_unlocked_at');
            localStorage.removeItem('arena_user_name');
            location.reload(); // リロードしてログイン画面を強制表示
        });
    }


    // ==========================================
    // テーマ切り替え（ライト/ダークテーマ） 🆕
    // ==========================================
    const btnThemeToggle = document.getElementById('btn-theme-toggle');
    const savedTheme = localStorage.getItem('arena_theme');
    
    // 保存されたテーマがある場合は適用（デフォルトはダーク）
    if (savedTheme === 'light') {
        document.body.classList.add('light-theme');
    }

    if (btnThemeToggle) {
        btnThemeToggle.addEventListener('click', () => {
            const isLight = document.body.classList.toggle('light-theme');
            localStorage.setItem('arena_theme', isLight ? 'light' : 'dark');
        });
    }


    // ==========================================
    // 1. リアルタイムクロック＆日付表示
    // ==========================================
    const statusClock = document.getElementById('status-clock');
    const dateDisplay = document.getElementById('date-display');
    
    const weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

    function updateClock() {
        const now = new Date();
        
        // 時・分・秒の取得
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        
        // 簡易ステータスバー用 (HH:MM)
        if (statusClock) {
            statusClock.textContent = `${hours}:${minutes}`;
        }
        
        // 日付表示 (YYYY.MM.DD [WEEKDAY])
        if (dateDisplay) {
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const date = String(now.getDate()).padStart(2, '0');
            const dayName = weekdays[now.getDay()];
            dateDisplay.textContent = `${year}.${month}.${date} [${dayName}]`;
        }
    }
    
    // 初回実行と1秒毎のループ設定
    updateClock();
    setInterval(updateClock, 1000);


    // ==========================================
    // 2. タブ切り替えロジック
    // ==========================================
    const navHome = document.getElementById('nav-home');
    const navHistory = document.getElementById('nav-history');
    const navLinks = document.getElementById('nav-links');
    const tabHome = document.getElementById('tab-home');
    const tabHistory = document.getElementById('tab-history');
    const tabLinks = document.getElementById('tab-links');
    const appBody = document.querySelector('.app-body');
    const appNavBar = document.getElementById('app-nav-bar');

    function switchTab(target) {
        // 全ボタンのアクティブクラス解除
        if (navHome) navHome.classList.remove('active');
        if (navHistory) navHistory.classList.remove('active');
        if (navLinks) navLinks.classList.remove('active');

        // 全タブコンテンツの非表示とアクティブクラス解除
        if (tabHome) { tabHome.style.display = 'none'; tabHome.classList.remove('active'); }
        if (tabHistory) { tabHistory.style.display = 'none'; tabHistory.classList.remove('active'); }
        if (tabLinks) { tabLinks.style.display = 'none'; tabLinks.classList.remove('active'); }

        if (target === 'home') {
            if (navHome) navHome.classList.add('active');
            if (tabHome) {
                tabHome.style.display = 'block';
                setTimeout(() => tabHome.classList.add('active'), 50);
            }
        } else if (target === 'history') {
            if (navHistory) navHistory.classList.add('active');
            if (tabHistory) {
                tabHistory.style.display = 'block';
                setTimeout(() => tabHistory.classList.add('active'), 50);
            }
            // 履歴タブを開いた際は初期全件検索を実行
            loadHistoryData();
        } else if (target === 'links') {
            if (navLinks) navLinks.classList.add('active');
            if (tabLinks) {
                tabLinks.style.display = 'block';
                setTimeout(() => tabLinks.classList.add('active'), 50);
            }
        }
        
        // スクロール位置を一番上へ
        if (appBody) appBody.scrollTop = 0;
    }

    if (navHome) navHome.addEventListener('click', () => switchTab('home'));
    if (navHistory) navHistory.addEventListener('click', () => switchTab('history'));
    if (navLinks) navLinks.addEventListener('click', () => switchTab('links'));


    // ==========================================
    // 3. データ連携＆ローカルモックデータベース機能（初期データ拡張）
    // ==========================================
    const memoTextarea = document.getElementById('memo-textarea');
    const memoTitleDisplay = document.getElementById('memo-title-display');
    const memoSaveStatus = document.getElementById('memo-save-status');
    const memoTime = document.getElementById('memo-time');

    // 編集モーダルの入力要素
    const memoEditOverlay = document.getElementById('memo-edit-overlay');
    const editMemoBtn = document.getElementById('edit-memo-btn');
    const memoEditClose = document.getElementById('memo-edit-close');
    const memoEditCancel = document.getElementById('memo-edit-cancel');
    const memoEditSave = document.getElementById('memo-edit-save');
    const inputMemoDetail = document.getElementById('input-memo-detail');
    const memoPinnedTextarea = document.getElementById('memo-pinned-textarea');
    const inputMemoPinned = document.getElementById('input-memo-pinned');

    // 獲得会員数編集用の要素
    const memberEditOverlay = document.getElementById('member-edit-overlay');
    const editMemberBtn = document.getElementById('edit-member-btn');
    const memberEditClose = document.getElementById('member-edit-close');
    const memberEditCancel = document.getElementById('member-edit-cancel');
    const memberEditSave = document.getElementById('member-edit-save');
    const inputMemberCurrent = document.getElementById('input-member-current');
    const btnMemberMinus = document.getElementById('btn-member-minus');
    const btnMemberPlus = document.getElementById('btn-member-plus');

    // モック用の初期データ（LocalStorageに保存・管理）
    const defaultHome = {
        '月間会員目標数': 100,
        '現在の会員数': 45,
        'lotteryCount': 0,
        'walkInCount': 0
    };

    const defaultMemoList = [
        {
            '登録日時': '2026/05/24 18:00',
            '内容': '拾得物（スマートキー）が3番通路付近でありました。台帳記入の上、事務所金庫に保管済みです。\n今週のシフト変更希望は明日25日の午前中までに提出完了するようにお願いします。',
            '区分': '通常'
        },
        {
            '登録日時': '2026/05/24 18:30',
            '内容': '新台「CRネオサイバー」の稼働に伴う新台開放手順書が事務所デスクに配布されています。出勤スタッフは試打ち前に必ず目を通してください。',
            '区分': '📌 重要'
        }
    ];

    const defaultRequests = [
        {
            id: 1,
            timestamp: '2026/05/24 10:15',
            sender: '主任',
            content: '景品カウンター奥の棚整理をお願いします。',
            assignee: '早番',
            deadline: '12:00まで',
            status: '未'
        },
        {
            id: 2,
            timestamp: '2026/05/24 15:30',
            sender: '山下リーダー',
            content: '新台POPの貼り替え作業が残っています。島端のチェックも併せてお願いします。',
            assignee: '遅番',
            deadline: '本日中',
            status: '未'
        }
    ];

    // 故障トラブル モック初期データ
    const defaultTroubles = [
        {
            id: 1,
            timestamp: '2026/05/24 19:45',
            location: '503番台 (CRネオサイバー)',
            title: '液晶ブラックアウト',
            detail: '遊技中に突然画面が暗転。音声は出力されているが映像が全く映らない状態。電源再起動を試みるが復旧せず。',
            status: '未対応',
            history: ''
        },
        {
            id: 2,
            timestamp: '2026/05/25 00:15',
            location: '3番通路スロット両替機',
            title: 'セレクター硬貨詰まり',
            detail: '100円硬貨の投入口に異物が挟まっている模様。現在、返却レバーも動作しないため使用中止札を貼付。',
            status: '対応中',
            history: '佐藤が対応パーツ手配中'
        }
    ];

    // 曜日清掃・作業 モック初期データ
    const defaultCleanings = [
        { id: 2, day: '月', shift: '早番', category: '清掃', task: 'スロット島端の念入りモップ掛け及び除菌作業', executor: '', status: '未' },
        { id: 3, day: '月', shift: '遅番', category: '作業', task: '景品カウンター奥ストックヤードの段ボール片付け・整理', executor: '', status: '未' },
        { id: 4, day: '火', shift: '早番', category: '清掃', task: '屋外駐輪場のゴミ拾い及び雑草抜き、灰皿清掃', executor: '', status: '未' },
        { id: 5, day: '水', shift: '早番', category: '清掃', task: '喫煙ブースの念入りフィルター換気扇清掃及び消臭', executor: '', status: '未' },
        { id: 6, day: '木', shift: '遅番', category: '清掃', task: 'トイレ天井換気扇・ダクト周りの埃除去と除菌作業', executor: '', status: '未' },
        { id: 7, day: '金', shift: '早番', category: '作業', task: '休憩コーナーの漫画ラック整理・拭き掃除', executor: '', status: '未' },
        { id: 8, day: '土', shift: '遅番', category: '清掃', task: '全島スマートユニット投入口のアルコール清掃', executor: '', status: '未' },
        { id: 9, day: '日', shift: '早番', category: '作業', task: '自動販売機周りの空き缶回収BOXの洗浄・水洗い', executor: '', status: '未' }
    ];

    // LocalStorage初期化用ヘルパー
    function initLocalStorage() {
        try {
            if (!localStorage.getItem('arena_home')) {
                localStorage.setItem('arena_home', JSON.stringify(defaultHome));
            }
            if (!localStorage.getItem('arena_memo_list')) {
                localStorage.setItem('arena_memo_list', JSON.stringify(defaultMemoList));
            }
            if (!localStorage.getItem('arena_requests')) {
                localStorage.setItem('arena_requests', JSON.stringify(defaultRequests));
            }
            if (!localStorage.getItem('arena_troubles')) {
                localStorage.setItem('arena_troubles', JSON.stringify(defaultTroubles));
            }
            if (!localStorage.getItem('arena_cleanings')) {
                localStorage.setItem('arena_cleanings', JSON.stringify(defaultCleanings));
            }
        } catch (e) {
            console.warn('ローカルストレージの初期化に失敗しました（file:// 等での制限）', e);
        }
    }
    initLocalStorage();

    // 伝達事項のデータ取得
    async function loadMemoData() {
        if (memoSaveStatus) {
            memoSaveStatus.textContent = GAS_API_URL ? 'スプレッドシートと同期中...' : 'ローカルデータベース稼働中';
            memoSaveStatus.style.color = GAS_API_URL ? 'var(--neon-blue)' : 'var(--theme-emerald)';
        }

        if (GAS_API_URL) {
            try {
                console.log('GAS APIデータ取得開始 URL:', GAS_API_URL);
                const response = await fetch(`${GAS_API_URL}?action=getHome`);
                if (!response.ok) throw new Error('通信エラー');
                const data = await response.json();
                console.log('GAS APIデータ取得成功 レスポンス:', data);
                
                if (data && data.length > 0) {
                    const homeData = data[0];
                    const detail = homeData.detail || '';
                    const pinnedDetail = homeData.pinnedDetail || '';
                    const timestamp = homeData.timestamp || '----/--/-- --:--';
                    
                    if (memoTitleDisplay) memoTitleDisplay.textContent = '伝達事項'; // タイトルは『伝達事項』で固定
                    if (memoPinnedTextarea) memoPinnedTextarea.value = pinnedDetail;
                    if (memoTextarea) memoTextarea.value = detail;
                    if (memoTime) memoTime.textContent = `最終更新: ${timestamp}`;

                    // 本番GASから取得した会員データで進捗メーターを同時に更新！（CORSエラーを完全に回避）
                    const targetVal = Number(homeData['月間会員目標数']) || Number(homeData.targetMembers) || 100;
                    const currentVal = Number(homeData['現在の会員数']) || Number(homeData.currentMembers) || 0;
                    updateProgressUI(currentVal, targetVal);

                    // 🌟【抽選・飛び込み人数データの表示】
                    // data[0].lotteryCount と data[0].walkInCount を確実に取得してパースする
                    let lottery = 0;
                    let walkIn = 0;

                    if (homeData.lotteryCount !== undefined && homeData.lotteryCount !== null) {
                        lottery = parseInt(homeData.lotteryCount, 10);
                        if (isNaN(lottery)) lottery = 0;
                    }
                    if (homeData.walkInCount !== undefined && homeData.walkInCount !== null) {
                        walkIn = parseInt(homeData.walkInCount, 10);
                        if (isNaN(walkIn)) walkIn = 0;
                    }
                    
                    console.log('パースされた人数 - 抽選:', lottery, '飛び込み:', walkIn);
                    
                    if (document.getElementById('lottery-count-display')) {
                        document.getElementById('lottery-count-display').textContent = lottery;
                    }
                    if (document.getElementById('walk-in-count-display')) {
                        document.getElementById('walk-in-count-display').textContent = walkIn;
                    }

                    // ローカルストレージにも同期保存してキャッシュを最新化
                    saveTrafficLocal(lottery, walkIn);

                    // GASから動的スタッフ名リストが返ってきていればグローバルに保持
                    if (homeData.staffList && Array.isArray(homeData.staffList)) {
                        window.globalStaffList = homeData.staffList;
                        console.log('スプレッドシートから動的スタッフリストを読込:', window.globalStaffList);
                    }
                }
            } catch (e) {
                console.error('伝達事項のスプレッドシート取得に失敗しました。ローカルストレージを使用します。', e);
                loadMemoLocal();
            }
        } else {
            loadMemoLocal();
        }
    }

    function loadMemoLocal() {
        try {
            const dataStr = localStorage.getItem('arena_memo_list');
            const homeStr = localStorage.getItem('arena_home');
            let currentVal = 45;
            let targetVal = 100;
            let lotteryCount = 0;
            let walkInCount = 0;
            
            // 会員獲得メーター用に新キー arena_home から値を取得、なければ旧キー arena_memo からフォールバック
            if (homeStr) {
                const homeObj = JSON.parse(homeStr);
                if (homeObj['現在の会員数'] !== undefined) currentVal = Number(homeObj['現在の会員数']);
                if (homeObj['月間会員目標数'] !== undefined) targetVal = Number(homeObj['月間会員目標数']);
                if (homeObj['lotteryCount'] !== undefined) lotteryCount = Number(homeObj['lotteryCount']);
                if (homeObj['walkInCount'] !== undefined) walkInCount = Number(homeObj['walkInCount']);
            } else {
                const oldMemoStr = localStorage.getItem('arena_memo');
                if (oldMemoStr) {
                    const oldMemo = JSON.parse(oldMemoStr);
                    if (oldMemo.currentMembers !== undefined) currentVal = Number(oldMemo.currentMembers);
                    if (oldMemo.targetMembers !== undefined) targetVal = Number(oldMemo.targetMembers);
                }
            }
            
            if (dataStr) {
                const list = JSON.parse(dataStr);
                let pinnedDetail = '';
                let detailList = [];
                let lastTimestamp = '';
                
                // 最新レコード（後ろ）からループしてデータを仕分ける（日本語キー・英語キー両対応）
                for (let i = list.length - 1; i >= 0; i--) {
                    const item = list[i];
                    const regTime = item['登録日時'] || item['日時'] || item.timestamp;
                    const content = (item['内容'] || item.content || '').trim();
                    const category = (item['区分'] || item['重要度'] || item.category || '').trim();
                    
                    // LINEからの「📌 重要」も、アプリからの「重要」も拾う設定
                    const isImportant = category.includes('重要');
                    
                    if (isImportant && !pinnedDetail && content) {
                        pinnedDetail = content;
                        if (!lastTimestamp && regTime) {
                            lastTimestamp = regTime;
                        }
                    }
                    
                    if (!isImportant && content) {
                        if (detailList.length < 5) { // 最新5件までリスト表示
                            detailList.push(content);
                        }
                        if (!lastTimestamp && regTime) {
                            lastTimestamp = regTime;
                        }
                    }
                }
                
                if (memoTitleDisplay) memoTitleDisplay.textContent = '伝達事項'; // タイトルは『伝達事項』で固定
                if (memoPinnedTextarea) memoPinnedTextarea.value = pinnedDetail || '【重要なお知らせ】\n現在、重要なピン留め連絡はありません。';
                if (memoTextarea) memoTextarea.value = detailList.length > 0 ? detailList.join('\n\n') : '【通常の伝達事項】\n現在、通常の伝達事項はありません。';
                if (memoTime) memoTime.textContent = `最終更新: ${lastTimestamp || '----/--/-- --:--'}`;
            } else {
                if (memoPinnedTextarea) memoPinnedTextarea.value = '【重要なお知らせ】\n現在、重要なピン留め連絡はありません。';
                if (memoTextarea) memoTextarea.value = '【通常の伝達事項】\n現在、通常の伝達事項はありません。';
            }
            // ローカル動作時、または連携失敗時は保存された値でメーターを安全に更新
            updateProgressUI(currentVal, targetVal);

            // 🌟【抽選・飛び込み人数データの表示】
            if (document.getElementById('lottery-count-display')) {
                document.getElementById('lottery-count-display').textContent = lotteryCount;
            }
            if (document.getElementById('walk-in-count-display')) {
                document.getElementById('walk-in-count-display').textContent = walkInCount;
            }
        } catch (e) {
            console.warn('ローカルストレージの読み込みに失敗しました。', e);
            updateProgressUI(45, 100);
        }
    }

    // 伝達事項の編集モーダルの開閉
    if (editMemoBtn) {
        editMemoBtn.addEventListener('click', () => {
            currentEditingMemoId = null; // 新規なのでIDをクリア
            if (inputMemoDetail) inputMemoDetail.value = ''; // 新規履歴追加なので空にする
            if (inputMemoPinned) inputMemoPinned.checked = false; // デフォルトは通常
            
            // モーダルの表示を「新規」用に更新
            const modalTitle = memoEditOverlay ? memoEditOverlay.querySelector('.modal-header h3') : null;
            if (modalTitle) modalTitle.textContent = '新規伝達事項の追加';
            if (memoEditSave) memoEditSave.textContent = '保存する';
            
            if (memoEditOverlay) memoEditOverlay.classList.add('active');
        });
    }

    function closeMemoModal() {
        if (memoEditOverlay) memoEditOverlay.classList.remove('active');
    }

    if (memoEditClose) memoEditClose.addEventListener('click', closeMemoModal);
    if (memoEditCancel) memoEditCancel.addEventListener('click', closeMemoModal);

    // 伝達事項の保存・更新処理
    if (memoEditSave) {
        memoEditSave.addEventListener('click', async () => {
            const detail = inputMemoDetail.value.trim();
            const isPinned = inputMemoPinned ? inputMemoPinned.checked : false;
            const category = isPinned ? '重要' : '通常';
            
            if (!detail) {
                alert('詳細内容を入力してください。');
                return;
            }

            const isEdit = (currentEditingMemoId !== null);
            memoEditSave.textContent = isEdit ? '更新中...' : '保存中...';
            memoEditSave.disabled = true;

            const now = new Date();
            const formattedTime = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

            if (GAS_API_URL) {
                try {
                    const actionName = isEdit ? 'editMemo' : 'updateHome';
                    const postParams = {
                        action: actionName,
                        detail: detail,
                        category: category,
                        passcode: localStorage.getItem('arena_passcode') || ''
                    };
                    if (isEdit) {
                        postParams.id = currentEditingMemoId;
                    } else {
                        postParams.timestamp = formattedTime;
                    }

                    const response = await fetch(GAS_API_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded'
                        },
                        body: new URLSearchParams(postParams)
                    });
                    if (response.ok) {
                        const result = await response.json();
                        if (result.status === 'error' || result.success === false) {
                            alert(`認証エラー: ${result.message || result.error || 'アクセス権限がありません。'}`);
                            memoEditSave.textContent = isEdit ? '更新する' : '保存する';
                            memoEditSave.disabled = false;
                            return;
                        }
                    } else {
                        throw new Error('通信エラーが発生しました。');
                    }
                    if (isEdit) {
                        editMemoLocal(currentEditingMemoId, detail, category);
                    } else {
                        saveMemoLocalEx(detail, category, formattedTime);
                    }
                } catch (e) {
                    console.error('スプレッドシート上書き保存に失敗しました。ローカルのみで保存します。', e);
                    if (isEdit) {
                        editMemoLocal(currentEditingMemoId, detail, category);
                    } else {
                        saveMemoLocalEx(detail, category, formattedTime);
                    }
                }
            } else {
                if (isEdit) {
                    editMemoLocal(currentEditingMemoId, detail, category);
                } else {
                    saveMemoLocalEx(detail, category, formattedTime);
                }
            }

            // 保存完了後、UIを即時反映（最新データをロード）
            if (GAS_API_URL) {
                await loadMemoData();
            } else {
                loadMemoLocal();
            }
            
            if (memoSaveStatus) {
                memoSaveStatus.textContent = GAS_API_URL ? 'スプレッドシート同期済' : 'ローカルに保存されました';
                memoSaveStatus.style.color = 'var(--theme-emerald)';
            }

            memoEditSave.textContent = '保存する';
            memoEditSave.disabled = false;
            closeMemoModal();
        });
    }

    function saveMemoLocalEx(content, category, timestamp) {
        try {
            const dataStr = localStorage.getItem('arena_memo_list');
            let list = [];
            if (dataStr) {
                list = JSON.parse(dataStr);
            }
            list.push({
                '登録日時': timestamp,
                '内容': content,
                '区分': category
            });
            localStorage.setItem('arena_memo_list', JSON.stringify(list));
        } catch (e) {
            console.error('ローカルストレージへの履歴保存に失敗しました。', e);
        }
    }

    function editMemoLocal(id, content, category) {
        try {
            const dataStr = localStorage.getItem('arena_memo_list');
            if (dataStr) {
                let list = JSON.parse(dataStr);
                const idx = parseInt(id) - 2;
                if (idx >= 0 && idx < list.length) {
                    list[idx]['内容'] = content;
                    list[idx]['区分'] = category;
                    localStorage.setItem('arena_memo_list', JSON.stringify(list));
                }
            }
        } catch (e) {
            console.error('ローカルストレージの履歴更新に失敗しました。', e);
        }
    }

    loadMemoData();

    // ==========================================
    // 3.1. セル・カセット清掃画面（スライドインSPAサブビュー） 🆕
    // ==========================================
    const btnTriggerCleaningCanvas = document.getElementById('btn-trigger-cleaning-canvas');
    const navCleaningCanvas = document.getElementById('nav-cleaning-canvas');
    const viewCleaningCanvas = document.getElementById('view-cleaning-canvas');
    const cleaningCanvasBackBtn = document.getElementById('cleaning-canvas-back-btn');
    const btnCleaningScrollA = document.getElementById('btn-cleaning-scroll-a');
    const btnCleaningScrollB = document.getElementById('btn-cleaning-scroll-b');
    const btnCleaningReset = document.getElementById('btn-cleaning-reset');
    const cleaningCanvasScrollContainer = document.getElementById('cleaning-canvas-scroll-container');

    const layoutData = [
        // 1行目: 1A(1〜20) / 1B(21〜40) の上列台
        { type: 'machines', aRange: [1, 20], bRange: [21, 40], aDir: 'normal', bDir: 'normal' },
        // 2行目: 通路 (1A 46スロ / 1B 46スロ)
        { type: 'aisle', aText: '1A (46スロ)', bText: '1B (46スロ)', aRate: 'rate-slot', bRate: 'rate-slot' },
        // 3行目: 1A(80〜61) / 1B(60〜41) の下列台
        { type: 'machines', aRange: [61, 80], bRange: [41, 60], aDir: 'reverse', bDir: 'reverse' },
        // 4行目: 2A(81〜100) / 2B(101〜120) の下列台
        { type: 'machines', aRange: [81, 100], bRange: [101, 120], aDir: 'normal', bDir: 'normal' },
        // 5行目: 通路 (2A 46スロ / 2B 180スロ)
        { type: 'aisle', aText: '2A (46スロ)', bText: '2B (180スロ)', aRate: 'rate-slot', bRate: 'rate-slot' },
        // 6行目: 2A(160〜141) / 2B(140〜121) の上列台
        { type: 'machines', aRange: [141, 160], bRange: [121, 140], aDir: 'reverse', bDir: 'reverse' },
        // 7行目: 3A(161〜180) / 3B(181〜200) の上列台
        { type: 'machines', aRange: [161, 180], bRange: [181, 200], aDir: 'normal', bDir: 'normal' },
        // 8行目: 通路 (3A 4円 / 3B 4円)
        { type: 'aisle', aText: '3A (4円)', bText: '3B (4円)', aRate: 'rate-p4', bRate: 'rate-p4' },
        // 9行目: 3A(240〜221) / 3B(220〜201) の下列台
        { type: 'machines', aRange: [221, 240], bRange: [201, 220], aDir: 'reverse', bDir: 'reverse' },
        // 10行目: 4A(241〜260) / 4B(261〜280) の下列台
        { type: 'machines', aRange: [241, 260], bRange: [261, 280], aDir: 'normal', bDir: 'normal' },
        // 11行目: 通路 (4A 4円 / 4B 4円)
        { type: 'aisle', aText: '4A (4円)', bText: '4B (4円)', aRate: 'rate-p4', bRate: 'rate-p4' },
        // 12行目: 4A(320〜301) / 4B(300〜281) の上列台
        { type: 'machines', aRange: [301, 320], bRange: [281, 300], aDir: 'reverse', bDir: 'reverse' },
        // 13行目: 5A(321〜340) / 5B(341〜360) の上列台
        { type: 'machines', aRange: [321, 340], bRange: [341, 360], aDir: 'normal', bDir: 'normal' },
        // 14行目: 通路 (5A 1円 / 5B 4円)
        { type: 'aisle', aText: '5A (1円)', bText: '5B (4円)', aRate: 'rate-p1', bRate: 'rate-p4' },
        // 15行目: 5A(400〜381) / 5B(380〜361) の下列台
        { type: 'machines', aRange: [381, 400], bRange: [361, 380], aDir: 'reverse', bDir: 'reverse' },
        // 16行目: 6A(401〜420) / 6B(421〜440) の上列台
        { type: 'machines', aRange: [401, 420], bRange: [421, 440], aDir: 'normal', bDir: 'normal' },
        // 17行目: 通路 (6A 1円 / 6B 0.5円)
        { type: 'aisle', aText: '6A (1円)', bText: '6B (0.5円)', aRate: 'rate-p1', bRate: 'rate-p05' }
    ];

    let globalCassetteCleanings = [];
    let currentHighlightedMachineId = null; // 現在ジャンプハイライト中の台番号

    function loadCassetteCleaningsLocal() {
        try {
            const dataStr = localStorage.getItem('arena_cassette_cleanings');
            if (dataStr) {
                globalCassetteCleanings = JSON.parse(dataStr);
                return;
            }
        } catch (e) {
            console.warn('ローカル清掃キャッシュ読み込み失敗:', e);
        }
        // キャッシュがない場合は初期化（全440台未清掃）
        globalCassetteCleanings = [];
        for (let i = 1; i <= 440; i++) {
            globalCassetteCleanings.push({
                machineId: i,
                status: '未',
                executor: '',
                timestamp: ''
            });
        }
    }

    async function fetchCassetteCleanings() {
        loadCassetteCleaningsLocal();
        // まずキャッシュで描画
        renderStoreLayout();
        updateCleaningProgressUI();

        if (GAS_API_URL) {
            try {
                const response = await fetch(`${GAS_API_URL}?action=getCassetteCleanings`);
                if (response.ok) {
                    const data = await response.json();
                    if (Array.isArray(data) && data.length > 0) {
                        globalCassetteCleanings = data;
                        localStorage.setItem('arena_cassette_cleanings', JSON.stringify(data));
                        renderStoreLayout();
                        updateCleaningProgressUI();
                    }
                }
            } catch (e) {
                console.error('GASから清掃データ取得失敗。キャッシュを使用します。', e);
            }
        }
    }

    function openCleaningCanvasView() {
        // アクティブなナビゲーションのクラス付け替え
        if (navHome) navHome.classList.remove('active');
        if (navHistory) navHistory.classList.remove('active');
        if (navLinks) navLinks.classList.remove('active');
        if (navCleaningCanvas) navCleaningCanvas.classList.add('active');

        if (viewCleaningCanvas) {
            viewCleaningCanvas.classList.add('active');
            if (appNavBar) appNavBar.style.display = 'none';
        }

        // 日付入力欄に本日の日付を初期値として設定（空の場合のみ）
        const dateInput = document.getElementById('cleaning-date-input');
        if (dateInput && !dateInput.value) {
            const today = new Date();
            const yyyy = today.getFullYear();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');
            dateInput.value = `${yyyy}-${mm}-${dd}`;
        }

        fetchCassetteCleanings();
    }

    function closeCleaningCanvasView() {
        if (viewCleaningCanvas) {
            viewCleaningCanvas.classList.remove('active');
            if (appNavBar) appNavBar.style.display = 'flex';
        }
        if (navCleaningCanvas) navCleaningCanvas.classList.remove('active');
        if (navHome) navHome.classList.add('active');

        // ハイライト状態をクリア
        currentHighlightedMachineId = null;

        // ハイライトを消去する
        document.querySelectorAll('.layout-machine.highlight-bounce').forEach(c => {
            c.classList.remove('highlight-bounce');
        });
    }

    if (btnTriggerCleaningCanvas) {
        btnTriggerCleaningCanvas.addEventListener('click', (e) => {
            e.stopPropagation();
            openCleaningCanvasView();
        });
    }

    if (navCleaningCanvas) {
        navCleaningCanvas.addEventListener('click', (e) => {
            e.stopPropagation();
            openCleaningCanvasView();
        });
    }

    if (cleaningCanvasBackBtn) {
        cleaningCanvasBackBtn.addEventListener('click', () => {
            closeCleaningCanvasView();
        });
    }

    if (btnCleaningScrollA && cleaningCanvasScrollContainer) {
        btnCleaningScrollA.addEventListener('click', () => {
            cleaningCanvasScrollContainer.scrollTo({
                left: 0,
                behavior: 'smooth'
            });
        });
    }

    if (btnCleaningScrollB && cleaningCanvasScrollContainer) {
        btnCleaningScrollB.addEventListener('click', () => {
            const scrollWidth = cleaningCanvasScrollContainer.scrollWidth;
            cleaningCanvasScrollContainer.scrollTo({
                left: scrollWidth,
                behavior: 'smooth'
            });
        });
    }

    if (btnCleaningReset) {
        btnCleaningReset.addEventListener('click', async () => {
            const confirmed = confirm('【重要】セル・カセット清掃データをすべて「未清掃」にリセットしますか？\n（一周終了時のみ実行してください）');
            if (!confirmed) return;

            btnCleaningReset.disabled = true;
            btnCleaningReset.textContent = 'リセット中...';

            globalCassetteCleanings = globalCassetteCleanings.map(item => {
                return { ...item, status: '未', executor: '', timestamp: '' };
            });
            localStorage.setItem('arena_cassette_cleanings', JSON.stringify(globalCassetteCleanings));
            renderStoreLayout();
            updateCleaningProgressUI();

            if (GAS_API_URL) {
                try {
                    const response = await fetch(GAS_API_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded'
                        },
                        body: new URLSearchParams({
                            action: 'resetCassetteCleanings',
                            passcode: localStorage.getItem('arena_passcode') || ''
                        })
                    });

                    if (response.ok) {
                        const resData = await response.json();
                        if (resData.status === 'error' || resData.success === false) {
                            alert(`エラー: ${resData.message || 'サーバー側でのリセットに失敗しました。'}`);
                        } else {
                            alert('全台の清掃データをリセットしました。');
                        }
                    } else {
                        throw new Error('通信エラー');
                    }
                } catch (e) {
                    console.error('GASリセット失敗。', e);
                    alert('通信エラーのため、サーバーのリセットに失敗しました。ローカルキャッシュはリセットされました。');
                }
            } else {
                alert('ローカルの清掃データをリセットしました。');
            }

            btnCleaningReset.disabled = false;
            btnCleaningReset.textContent = '全台リセット';
        });
    }

    function getRateClass(num) {
        if (num >= 1 && num <= 160) return 'rate-slot';
        if ((num >= 161 && num <= 320) || (num >= 341 && num <= 380)) return 'rate-p4'; // 5Bは4円パチンコ
        if ((num >= 321 && num <= 340) || (num >= 381 && num <= 420)) return 'rate-p1'; // 5A, 6Aは1円パチンコ
        if (num >= 421 && num <= 440) return 'rate-p05';
        return '';
    }

    function renderStoreLayout() {
        const canvas = document.getElementById('cleaning-canvas-grid-canvas');
        if (!canvas) return;
        canvas.innerHTML = '';

        layoutData.forEach(row => {
            if (row.type === 'machines') {
                const islandRow = document.createElement('div');
                islandRow.className = 'layout-row-machines';

                let aMachines = [];
                for (let i = row.aRange[0]; i <= row.aRange[1]; i++) {
                    aMachines.push(i);
                }
                if (row.aDir === 'reverse') {
                    aMachines.reverse();
                }

                let bMachines = [];
                for (let i = row.bRange[0]; i <= row.bRange[1]; i++) {
                    bMachines.push(i);
                }
                if (row.bDir === 'reverse') {
                    bMachines.reverse();
                }

                const aGroup = document.createElement('div');
                aGroup.className = 'layout-side-group';
                aMachines.forEach(num => {
                    aGroup.appendChild(createMachineCell(num));
                });
                islandRow.appendChild(aGroup);

                const bGroup = document.createElement('div');
                bGroup.className = 'layout-side-group';
                bMachines.forEach(num => {
                    bGroup.appendChild(createMachineCell(num));
                });
                islandRow.appendChild(bGroup);

                canvas.appendChild(islandRow);
            } else if (row.type === 'aisle') {
                const aisleRow = document.createElement('div');
                aisleRow.className = 'layout-row-aisle';

                const aAisle = document.createElement('div');
                aAisle.className = `layout-aisle-space ${row.aRate}`;
                aAisle.textContent = row.aText;

                const bAisle = document.createElement('div');
                bAisle.className = `layout-aisle-space ${row.bRate}`;
                bAisle.textContent = row.bText;

                aisleRow.appendChild(aAisle);
                aisleRow.appendChild(bAisle);

                canvas.appendChild(aisleRow);
            }
        });

        updateLayoutTroubles();
    }

    function createMachineCell(num) {
        const cell = document.createElement('div');
        cell.className = `layout-machine ${getRateClass(num)}`;
        cell.id = `layout-mach-${num}`;
        cell.setAttribute('data-machine-id', num);

        // メモリ上のデータから「済」であればクラスを適用
        const cleanInfo = globalCassetteCleanings.find(item => item.machineId === num);
        let dateLabel = '';
        if (cleanInfo && cleanInfo.status === '済') {
            cell.classList.add('cleaned');
            cell.setAttribute('title', `清掃済: ${cleanInfo.executor || 'スタッフ'} (${cleanInfo.timestamp || ''})`);

            // タイムスタンプから月/日を抽出する (例: "2026/06/19 12:30" -> "6/19")
            if (cleanInfo.timestamp) {
                const parts = cleanInfo.timestamp.split(' ')[0].split('/');
                if (parts.length === 3) {
                    dateLabel = `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
                }
            }
        }

        if (dateLabel) {
            cell.innerHTML = `<span class="machine-num">${num}</span><span class="machine-date">${dateLabel}</span>`;
        } else {
            cell.innerHTML = `<span class="machine-num">${num}</span>`;
        }

        // 現在ハイライト対象の台であればクラスを適用
        if (currentHighlightedMachineId === num) {
            cell.classList.add('highlight-bounce');
        }

        cell.addEventListener('click', () => {
            handleMachineClick(num);
        });

        return cell;
    }

    async function handleMachineClick(num) {
        // ハイライト状態をクリア
        currentHighlightedMachineId = null;
        document.querySelectorAll('.layout-machine.highlight-bounce').forEach(c => {
            c.classList.remove('highlight-bounce');
        });

        const cell = document.getElementById(`layout-mach-${num}`);
        if (!cell) return;

        const isCleaned = cell.classList.contains('cleaned');
        const newStatus = isCleaned ? '未' : '済';
        
        const executor = localStorage.getItem('arena_user_name') || 'スタッフ';
        const now = new Date();

        // 選択された日付を読み込み、現在時刻と結合する
        const dateInput = document.getElementById('cleaning-date-input');
        let dateStr = '';
        if (dateInput && dateInput.value) {
            // YYYY-MM-DD -> YYYY/MM/DD
            dateStr = dateInput.value.replace(/-/g, '/');
        } else {
            dateStr = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')}`;
        }
        const timestamp = `${dateStr} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

        // 1. ローカルを即時反映
        globalCassetteCleanings = globalCassetteCleanings.map(item => {
            if (item.machineId === num) {
                return { ...item, status: newStatus, executor: executor, timestamp: timestamp };
            }
            return item;
        });
        localStorage.setItem('arena_cassette_cleanings', JSON.stringify(globalCassetteCleanings));
        
        if (newStatus === '済') {
            cell.classList.add('cleaned');
            cell.setAttribute('title', `清掃済: ${executor} (${timestamp})`);

            // タイムスタンプから月/日を抽出して表示
            const parts = timestamp.split(' ')[0].split('/');
            const dateLabel = parts.length === 3 ? `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}` : '';
            cell.innerHTML = `<span class="machine-num">${num}</span><span class="machine-date">${dateLabel}</span>`;
        } else {
            cell.classList.remove('cleaned');
            cell.removeAttribute('title');
            
            // 未清掃に戻した時は日付を消去し、台番号のみに戻す
            cell.innerHTML = `<span class="machine-num">${num}</span>`;
        }
        updateCleaningProgressUI();

        // 2. GASへ非同期でPOST
        if (GAS_API_URL) {
            try {
                const response = await fetch(GAS_API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: new URLSearchParams({
                        action: 'updateCassetteCleaning',
                        machineId: num,
                        status: newStatus,
                        executor: executor,
                        timestamp: timestamp,
                        passcode: localStorage.getItem('arena_passcode') || ''
                    })
                });
                
                if (response.ok) {
                    const resData = await response.json();
                    if (resData.status === 'error' || resData.success === false) {
                        alert(`エラー: ${resData.message || 'サーバー同期失敗。元の状態に戻します。'}`);
                        rollbackStatus(num, isCleaned ? '済' : '未');
                    }
                } else {
                    throw new Error('通信エラー');
                }
            } catch (err) {
                console.error('GAS清掃更新失敗:', err);
            }
        }
    }

    function rollbackStatus(num, oldStatus) {
        globalCassetteCleanings = globalCassetteCleanings.map(item => {
            if (item.machineId === num) {
                return { ...item, status: oldStatus };
            }
            return item;
        });
        localStorage.setItem('arena_cassette_cleanings', JSON.stringify(globalCassetteCleanings));
        const cell = document.getElementById(`layout-mach-${num}`);
        if (cell) {
            if (oldStatus === '済') {
                cell.classList.add('cleaned');
            } else {
                cell.classList.remove('cleaned');
            }
        }
        updateCleaningProgressUI();
    }

    function updateCleaningProgressUI() {
        const badge = document.getElementById('cleaning-canvas-progress-badge');
        if (!badge) return;
        
        const total = 440;
        const cleanedCount = globalCassetteCleanings.filter(item => item.status === '済').length;
        badge.textContent = `済 ${cleanedCount}/${total}台`;
    }

    function updateLayoutTroubles() {
        try {
            const dataStr = localStorage.getItem('arena_troubles');
            if (!dataStr) return;
            const troubles = JSON.parse(dataStr);
            
            const machines = document.querySelectorAll('.layout-machine');
            machines.forEach(m => m.classList.remove('has-trouble'));
            
            troubles.forEach(trb => {
                if (trb.status === '未対応' || !trb.status) {
                    const location = trb.location || '';
                    const match = location.match(/\d+/);
                    if (match) {
                        const machineId = parseInt(match[0], 10);
                        const cell = document.getElementById(`layout-mach-${machineId}`);
                        if (cell) {
                            cell.classList.add('has-trouble');
                            const currentTitle = cell.getAttribute('title') || '';
                            cell.setAttribute('title', (currentTitle ? currentTitle + ' | ' : '') + `故障中: ${trb.title}`);
                        }
                    }
                }
            });
        } catch (e) {
            console.error('故障台レイアウト連動エラー:', e);
        }
    }

    function scrollToMachine(num) {
        // ハイライト対象の台番号を状態として記憶
        currentHighlightedMachineId = num;

        // 他にハイライトされている台があればクリア
        document.querySelectorAll('.layout-machine.highlight-bounce').forEach(c => {
            c.classList.remove('highlight-bounce');
        });

        const cell = document.getElementById(`layout-mach-${num}`);
        const container = document.getElementById('cleaning-canvas-scroll-container');
        if (!cell || !container) return;

        // 横スクロール位置の調整（セルの位置が中央に来るようにする）
        const containerRect = container.getBoundingClientRect();
        const cellRect = cell.getBoundingClientRect();
        const scrollLeft = container.scrollLeft + (cellRect.left - containerRect.left) - (containerRect.width / 2) + (cellRect.width / 2);
        
        container.scrollTo({
            left: Math.max(0, scrollLeft),
            behavior: 'smooth'
        });

        // 視覚的ハイライト表示（ずっと光らせるため setTimeout は削除）
        cell.classList.add('highlight-bounce');
    }


    // ==========================================
    // 4. お願いごと一覧画面（スライドインSPAサブビュー）
    // ==========================================
    const btnTriggerRequests = document.getElementById('btn-trigger-requests');
    const viewRequests = document.getElementById('view-requests');
    const requestsBackBtn = document.getElementById('requests-back-btn');
    const requestsListContainer = document.getElementById('requests-list-container');
    const requestsListLoader = document.getElementById('requests-list-loader');
    const requestsListEmpty = document.getElementById('requests-list-empty');
    const requestsCountBadge = document.getElementById('requests-count-badge');

    // お願いごと一覧を開く
    if (btnTriggerRequests) {
        btnTriggerRequests.addEventListener('click', (e) => {
            e.stopPropagation();
            
            if (viewRequests) {
                viewRequests.classList.add('active');
                if (appNavBar) appNavBar.style.display = 'none';
            }
            loadRequestsList();
        });
    }

    // お願いごと一覧から戻る
    if (requestsBackBtn) {
        requestsBackBtn.addEventListener('click', () => {
            if (viewRequests) {
                viewRequests.classList.remove('active');
                if (appNavBar) appNavBar.style.display = 'flex';
            }
        });
    }

    // データ読み込み（未完了「未」のみ）
    async function loadRequestsList() {
        if (requestsListLoader) requestsListLoader.style.display = 'flex';
        if (requestsListEmpty) requestsListEmpty.style.display = 'none';
        if (requestsListContainer) requestsListContainer.innerHTML = '';
        if (requestsCountBadge) requestsCountBadge.textContent = '0件';

        let requests = [];

        if (GAS_API_URL) {
            try {
                const response = await fetch(`${GAS_API_URL}?action=getRequests`);
                if (!response.ok) throw new Error('通信エラー');
                requests = await response.json();
            } catch (e) {
                console.error('お願いごとシート取得失敗。ローカルデータ読み込み。', e);
                requests = loadRequestsLocal();
            }
        } else {
            requests = loadRequestsLocal();
        }

        if (requestsListLoader) requestsListLoader.style.display = 'none';

        if (!requests || requests.length === 0) {
            if (requestsListEmpty) requestsListEmpty.style.display = 'flex';
        } else {
            if (requestsCountBadge) requestsCountBadge.textContent = `${requests.length}件`;
            
            requests.forEach(req => {
                const card = createRequestCard(req);
                if (requestsListContainer) requestsListContainer.appendChild(card);
            });
        }
    }

    function loadRequestsLocal() {
        try {
            const dataStr = localStorage.getItem('arena_requests');
            if (dataStr) {
                const list = JSON.parse(dataStr);
                return list.filter(item => item.status === '未' || !item.status);
            }
        } catch (e) {
            console.warn('ローカルお願いごと読み込み失敗。', e);
        }
        return [];
    }

    // お願いごとカード生成
    function createRequestCard(req) {
        const card = document.createElement('div');
        card.className = 'request-card';
        card.id = `req-card-${req.id}`;
        const rowId = req.id; 

        card.innerHTML = `
            <div class="request-card-header">
                <span class="req-sender-badge">${escapeHtml(req.sender)}</span>
                <span class="req-time-stamp">${req.timestamp || '----/--/-- --:--'}</span>
            </div>
            <div class="request-card-body">
                ${escapeHtml(req.content).replace(/\n/g, '<br>')}
            </div>
            <div class="request-card-footer">
                <div class="req-assignee-box">
                    <span>担当:</span>
                    <strong>${escapeHtml(req.assignee || '全員')}</strong>
                </div>
                <div class="req-deadline-box">
                    <span>期限:</span>
                    <strong>${escapeHtml(req.deadline || 'なし')}</strong>
                </div>
            </div>
            <button class="btn-edit-request" data-id="${rowId}" title="編集する">
                <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
            </button>
            <button class="btn-complete-check" data-id="${rowId}" title="完了にする">
                <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
            </button>
        `;

        const editBtn = card.querySelector('.btn-edit-request');
        if (editBtn) {
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                currentEditingRequestId = req.id;

                if (reqSender) reqSender.value = req.sender || '';
                if (reqContent) reqContent.value = req.content || '';
                if (reqAssignee) reqAssignee.value = req.assignee || '全員';
                if (reqDeadline) reqDeadline.value = req.deadline || '';

                const modalTitle = document.getElementById('request-modal-title');
                if (modalTitle) modalTitle.textContent = 'お願いごとの編集';
                if (requestAddSubmit) requestAddSubmit.textContent = '更新する';

                if (requestAddOverlay) requestAddOverlay.classList.add('active');
            });
        }

        const completeBtn = card.querySelector('.btn-complete-check');
        completeBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            card.classList.add('fade-out-done');

            if (GAS_API_URL) {
                try {
                    const response = await fetch(GAS_API_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded'
                        },
                        body: new URLSearchParams({
                            action: 'updateRequestStatus',
                            id: rowId,
                            status: '済',
                            passcode: localStorage.getItem('arena_passcode') || ''
                        })
                    });
                    if (response.ok) {
                        const result = await response.json();
                        if (result.status === 'error' || result.success === false) {
                            alert(`認証エラー: ${result.message || result.error || 'アクセス権限がありません。'}`);
                            card.classList.remove('fade-out-done');
                            return;
                        }
                    } else {
                        throw new Error('通信エラーが発生しました。');
                    }
                    updateRequestStatusLocal(rowId, '済');
                } catch (err) {
                    console.error('スプレッドシート完了更新失敗。', err);
                    updateRequestStatusLocal(rowId, '済');
                }
            } else {
                updateRequestStatusLocal(rowId, '済');
            }

            setTimeout(() => {
                card.remove();
                const currentCount = parseInt(requestsCountBadge.textContent) || 0;
                if (currentCount > 1) {
                    requestsCountBadge.textContent = `${currentCount - 1}件`;
                } else {
                    requestsCountBadge.textContent = '0件';
                    if (requestsListEmpty) requestsListEmpty.style.display = 'flex';
                }
            }, 400);
        });

        return card;
    }

    function updateRequestStatusLocal(id, newStatus) {
        try {
            const dataStr = localStorage.getItem('arena_requests');
            if (dataStr) {
                const list = JSON.parse(dataStr);
                const updatedList = list.map(item => {
                    if (item.id === parseInt(id)) {
                        return { ...item, status: newStatus };
                    }
                    return item;
                });
                localStorage.setItem('arena_requests', JSON.stringify(updatedList));
            }
        } catch (e) {
            console.error('ローカルお願いごとのステータス更新失敗。', e);
        }
    }


    // ==========================================
    // 5. お願いごと新規追加機能 (FAB + フォームモーダル)
    // ==========================================
    const fabAddRequest = document.getElementById('fab-add-request');
    const requestAddOverlay = document.getElementById('request-add-overlay');
    const requestAddClose = document.getElementById('request-add-close');
    const requestAddCancel = document.getElementById('request-add-cancel');
    const requestAddSubmit = document.getElementById('request-add-submit');

    const reqSender = document.getElementById('req-sender');
    const reqContent = document.getElementById('req-content');
    const reqAssignee = document.getElementById('req-assignee');
    const reqDeadline = document.getElementById('req-deadline');

    if (fabAddRequest) {
        fabAddRequest.addEventListener('click', () => {
            currentEditingRequestId = null; // 新規なのでIDをクリア
            if (reqSender) reqSender.value = '';
            if (reqContent) reqContent.value = '';
            if (reqAssignee) reqAssignee.value = '全員';
            if (reqDeadline) reqDeadline.value = '';
            
            const modalTitle = document.getElementById('request-modal-title');
            if (modalTitle) modalTitle.textContent = '新規お願いごと登録';
            if (requestAddSubmit) requestAddSubmit.textContent = '送信する';

            if (requestAddOverlay) requestAddOverlay.classList.add('active');
        });
    }

    function closeAddRequestModal() {
        if (requestAddOverlay) requestAddOverlay.classList.remove('active');
    }

    if (requestAddClose) requestAddClose.addEventListener('click', closeAddRequestModal);
    if (requestAddCancel) requestAddCancel.addEventListener('click', closeAddRequestModal);

    if (requestAddSubmit) {
        requestAddSubmit.addEventListener('click', async () => {
            const sender = reqSender.value.trim();
            const content = reqContent.value.trim();
            const assignee = reqAssignee.value.trim();
            const deadline = reqDeadline.value.trim();

            if (!sender || !content) {
                alert('「依頼者」と「お願い内容」は必須入力項目です。');
                return;
            }

            const isEdit = (currentEditingRequestId !== null);
            requestAddSubmit.textContent = isEdit ? '更新中...' : '送信中...';
            requestAddSubmit.disabled = true;

            const now = new Date();
            const formattedTime = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

            if (GAS_API_URL) {
                try {
                    const actionName = isEdit ? 'editRequest' : 'addRequest';
                    const postParams = {
                        action: actionName,
                        sender: sender,
                        content: content,
                        assignee: assignee || '全員',
                        deadline: deadline || 'なし',
                        passcode: localStorage.getItem('arena_passcode') || ''
                    };
                    if (isEdit) {
                        postParams.id = currentEditingRequestId;
                    } else {
                        postParams.timestamp = formattedTime;
                        postParams.status = '未';
                    }

                    const response = await fetch(GAS_API_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded'
                        },
                        body: new URLSearchParams(postParams)
                    });
                    if (response.ok) {
                        const result = await response.json();
                        if (result.status === 'error' || result.success === false) {
                            alert(`認証エラー: ${result.message || result.error || 'アクセス権限がありません。'}`);
                            requestAddSubmit.textContent = isEdit ? '更新する' : '送信する';
                            requestAddSubmit.disabled = false;
                            return;
                        }
                    } else {
                        throw new Error('通信エラーが発生しました。');
                    }
                    if (isEdit) {
                        editRequestLocal(currentEditingRequestId, sender, content, assignee, deadline);
                    } else {
                        addRequestLocal(sender, content, assignee, deadline, formattedTime);
                    }
                } catch (e) {
                    console.error('スプレッドシートへの保存に失敗しました。ローカル保存します。', e);
                    if (isEdit) {
                        editRequestLocal(currentEditingRequestId, sender, content, assignee, deadline);
                    } else {
                        addRequestLocal(sender, content, assignee, deadline, formattedTime);
                    }
                }
            } else {
                if (isEdit) {
                    editRequestLocal(currentEditingRequestId, sender, content, assignee, deadline);
                } else {
                    addRequestLocal(sender, content, assignee, deadline, formattedTime);
                }
            }

            requestAddSubmit.textContent = '送信する';
            requestAddSubmit.disabled = false;
            closeAddRequestModal();
            loadRequestsList();
        });
    }

    function addRequestLocal(sender, content, assignee, deadline, timestamp) {
        try {
            const dataStr = localStorage.getItem('arena_requests');
            let list = dataStr ? JSON.parse(dataStr) : [];
            const maxId = list.reduce((max, item) => item.id > max ? item.id : max, 0);
            
            const newRequest = {
                id: maxId + 1,
                timestamp: timestamp,
                sender: sender,
                content: content,
                assignee: assignee || '全員',
                deadline: deadline || 'なし',
                status: '未'
            };

            list.push(newRequest);
            localStorage.setItem('arena_requests', JSON.stringify(list));
        } catch (e) {
            console.error('ローカルお願いごと追加失敗。', e);
        }
    }

    function editRequestLocal(id, sender, content, assignee, deadline) {
        try {
            const dataStr = localStorage.getItem('arena_requests');
            if (dataStr) {
                let list = JSON.parse(dataStr);
                const updatedList = list.map(item => {
                    if (item.id === parseInt(id)) {
                        return { 
                            ...item, 
                            sender: sender, 
                            content: content, 
                            assignee: assignee || '全員', 
                            deadline: deadline || 'なし' 
                        };
                    }
                    return item;
                });
                localStorage.setItem('arena_requests', JSON.stringify(updatedList));
            }
        } catch (e) {
            console.error('ローカルお願いごとの更新に失敗しました。', e);
        }
    }

    // ==========================================
    // 5.6 曜日清掃・作業 新規追加・編集機能 (FAB + フォームモーダル) 🆕
    // ==========================================
    const fabAddWeeklyCleaning = document.getElementById('fab-add-weekly-cleaning');
    const weeklyCleaningAddOverlay = document.getElementById('weekly-cleaning-add-overlay');
    const weeklyCleaningAddClose = document.getElementById('weekly-cleaning-add-close');
    const weeklyCleaningAddCancel = document.getElementById('weekly-cleaning-add-cancel');
    const weeklyCleaningAddSave = document.getElementById('weekly-cleaning-add-save');

    const cleaningDaySelect = document.getElementById('cleaning-day-select');
    const cleaningShiftSelect = document.getElementById('cleaning-shift-select');
    const cleaningCategoryInput = document.getElementById('cleaning-category-input');
    const cleaningTaskInput = document.getElementById('cleaning-task-input');

    let currentEditingCleaningId = null;

    if (fabAddWeeklyCleaning) {
        fabAddWeeklyCleaning.addEventListener('click', () => {
            currentEditingCleaningId = null; // 新規なのでIDをクリア
            
            // 現在選択されている曜日を初期値にする
            if (cleaningDaySelect) cleaningDaySelect.value = currentSelectedDay || '月';
            if (cleaningShiftSelect) cleaningShiftSelect.value = '早番';
            if (cleaningCategoryInput) cleaningCategoryInput.value = '';
            if (cleaningTaskInput) cleaningTaskInput.value = '';

            const modalTitle = document.getElementById('weekly-cleaning-modal-title');
            if (modalTitle) modalTitle.textContent = '曜日タスクの登録';
            if (weeklyCleaningAddSave) weeklyCleaningAddSave.textContent = '保存する';

            if (weeklyCleaningAddOverlay) weeklyCleaningAddOverlay.classList.add('active');
        });
    }

    function closeWeeklyCleaningModal() {
        if (weeklyCleaningAddOverlay) weeklyCleaningAddOverlay.classList.remove('active');
    }

    if (weeklyCleaningAddClose) weeklyCleaningAddClose.addEventListener('click', closeWeeklyCleaningModal);
    if (weeklyCleaningAddCancel) weeklyCleaningAddCancel.addEventListener('click', closeWeeklyCleaningModal);

    if (weeklyCleaningAddSave) {
        weeklyCleaningAddSave.addEventListener('click', async () => {
            const day = cleaningDaySelect.value;
            const shift = cleaningShiftSelect.value;
            const category = cleaningCategoryInput.value.trim();
            const task = cleaningTaskInput.value.trim();

            if (!task) {
                alert('「作業・清掃内容」は必須入力項目です。');
                return;
            }

            const isEdit = (currentEditingCleaningId !== null);
            const actionName = isEdit ? 'editWeeklyCleaning' : 'addWeeklyCleaning';

            if (GAS_API_URL) {
                try {
                    const postParams = {
                        action: actionName,
                        day: day,
                        shift: shift,
                        category: category,
                        task: task,
                        passcode: localStorage.getItem('arena_passcode') || ''
                    };
                    if (isEdit) {
                        postParams.id = currentEditingCleaningId;
                    }

                    const response = await fetch(GAS_API_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded'
                        },
                        body: new URLSearchParams(postParams)
                    });

                    if (response.ok) {
                        const result = await response.json();
                        if (result.status === 'error' || result.success === false) {
                            alert(`保存エラー: ${result.message || result.error || 'アクセス権限がありません。'}`);
                            return;
                        }
                    } else {
                        throw new Error('通信エラーが発生しました。');
                    }

                    // ローカルキャッシュの更新
                    if (isEdit) {
                        editWeeklyCleaningLocal(currentEditingCleaningId, day, shift, category, task);
                    }
                    
                } catch (err) {
                    console.error('曜日タスクの保存失敗。', err);
                    alert('エラーが発生したため、ローカルでのみ仮更新します。');
                    if (isEdit) {
                        editWeeklyCleaningLocal(currentEditingCleaningId, day, shift, category, task);
                    }
                }
            } else {
                // オフラインモック時の動作
                if (isEdit) {
                    editWeeklyCleaningLocal(currentEditingCleaningId, day, shift, category, task);
                } else {
                    const mockList = loadCleaningsLocal();
                    const newId = mockList.length > 0 ? Math.max(...mockList.map(item => item.id || 0)) + 1 : 2;
                    mockList.push({
                        id: newId,
                        day: day,
                        shift: shift,
                        category: category,
                        task: task,
                        status: '未',
                        executor: ''
                    });
                    localStorage.setItem('arena_cleanings', JSON.stringify(mockList));
                }
            }

            // モーダルを閉じて、現在の選択曜日のリストを再描画
            closeWeeklyCleaningModal();
            loadCleaningsList(currentSelectedDay);
        });
    }

    // ローカルストレージデータの編集更新用ヘルパー
    function editWeeklyCleaningLocal(id, day, shift, category, task) {
        try {
            const dataStr = localStorage.getItem('arena_cleanings');
            if (dataStr) {
                const list = JSON.parse(dataStr);
                const updatedList = list.map(item => {
                    if (item.id === parseInt(id)) {
                        return { ...item, day: day, shift: shift, category: category, task: task };
                    }
                    return item;
                });
                localStorage.setItem('arena_cleanings', JSON.stringify(updatedList));
            }
        } catch (e) {
            console.error('ローカル曜日作業データ更新失敗。', e);
        }
    }

    // ==========================================
    // 【SPAサブビュー】故障報告・トラブル一覧 ＆ 新規登録・編集機能 🆕
    // ==========================================
    const btnTriggerTroubles = document.getElementById('btn-trigger-troubles');
    const viewTroubles = document.getElementById('view-troubles');
    const troublesBackBtn = document.getElementById('troubles-back-btn');
    const troublesListContainer = document.getElementById('troubles-list-container');
    const troublesListLoader = document.getElementById('troubles-list-loader');
    const troublesListEmpty = document.getElementById('troubles-list-empty');
    const troublesCountBadge = document.getElementById('troubles-count-badge');

    // 登録用モーダル要素
    const fabAddTrouble = document.getElementById('fab-add-trouble');
    const troubleAddOverlay = document.getElementById('trouble-add-overlay');
    const troubleAddClose = document.getElementById('trouble-add-close');
    const troubleAddCancel = document.getElementById('trouble-add-cancel');
    const troubleAddSubmit = document.getElementById('trouble-add-submit');

    // 新規入力項目
    const trbLocation = document.getElementById('trb-location');
    const trbTitle = document.getElementById('trb-title');
    const trbDetail = document.getElementById('trb-detail');

    // 編集モーダル用の要素 🆕
    const troubleEditOverlay = document.getElementById('trouble-edit-overlay');
    const troubleEditClose = document.getElementById('trouble-edit-close');
    const troubleEditCancel = document.getElementById('trouble-edit-cancel');
    const troubleEditSave = document.getElementById('trouble-edit-save');

    // 編集画面内表示パーツ 🆕
    const viewTrbLocation = document.getElementById('view-trb-location');
    const viewTrbTitle = document.getElementById('view-trb-title');
    const viewTrbTime = document.getElementById('view-trb-time');
    const viewTrbDetail = document.getElementById('view-trb-detail');
    const editTrbStatus = document.getElementById('edit-trb-status');
    const editTrbHistory = document.getElementById('edit-trb-history');

    // 現在編集中のトラブルID（スプレッドシートの行番号ID） 🆕
    let currentEditingTroubleId = null;

    // 故障報告一覧を開く
    if (btnTriggerTroubles) {
        btnTriggerTroubles.addEventListener('click', (e) => {
            e.stopPropagation();
            
            if (viewTroubles) {
                viewTroubles.classList.add('active');
                if (appNavBar) appNavBar.style.display = 'none';
            }
            loadTroublesList();
        });
    }

    // 故障報告一覧から戻る
    if (troublesBackBtn) {
        troublesBackBtn.addEventListener('click', () => {
            if (viewTroubles) {
                viewTroubles.classList.remove('active');
                if (appNavBar) appNavBar.style.display = 'flex';
            }
        });
    }

    // 一覧の読み込み
    async function loadTroublesList() {
        if (troublesListLoader) troublesListLoader.style.display = 'flex';
        if (troublesListEmpty) troublesListEmpty.style.display = 'none';
        if (troublesListContainer) troublesListContainer.innerHTML = '';
        if (troublesCountBadge) troublesCountBadge.textContent = '0件';

        let list = [];

        if (GAS_API_URL) {
            try {
                const response = await fetch(`${GAS_API_URL}?action=getTroubles`);
                if (!response.ok) throw new Error('通信エラー');
                list = await response.json();
            } catch (e) {
                console.error('故障情報スプレッドシート取得失敗。ローカルモック。', e);
                list = loadTroublesLocal();
            }
        } else {
            list = loadTroublesLocal();
        }

        if (troublesListLoader) troublesListLoader.style.display = 'none';

        if (!list || list.length === 0) {
            if (troublesListEmpty) troublesListEmpty.style.display = 'flex';
        } else {
            if (troublesCountBadge) troublesCountBadge.textContent = `${list.length}件`;
            
            list.forEach(trouble => {
                const card = createTroubleCard(trouble);
                if (troublesListContainer) troublesListContainer.appendChild(card);
            });
        }
    }

    function loadTroublesLocal() {
        try {
            const dataStr = localStorage.getItem('arena_troubles');
            if (dataStr) {
                const list = JSON.parse(dataStr);
                return list.filter(item => item.status !== '完了' && item.status !== '済');
            }
        } catch (e) {
            console.warn('ローカル故障情報読み込み失敗。', e);
        }
        return [];
    }

    // 故障・トラブルカード生成（タップで「詳細・編集画面」へ遷移） 🆕
    function createTroubleCard(trb) {
        const card = document.createElement('div');
        card.className = 'trouble-card';
        card.id = `trb-card-${trb.id}`;

        const isProgress = trb.status === '対応中';
        const badgeClass = isProgress ? 'status-progress' : 'status-pending';
        const historyText = trb.history ? escapeHtml(trb.history) : '履歴なし';

        // 場所から台番号（数字）を抽出
        const match = trb.location ? trb.location.match(/\d+/) : null;
        const hasValidMachine = match && parseInt(match[0], 10) >= 1 && parseInt(match[0], 10) <= 440;
        
        // 台番号がある場合は、バッジを「リンク風スタイル（下線）」にして、マップアイコンを追加
        const locationText = hasValidMachine 
            ? `🗺️ ${escapeHtml(trb.location)}` 
            : escapeHtml(trb.location);
        const badgeStyle = hasValidMachine 
            ? 'style="cursor: pointer; text-decoration: underline; color: var(--theme-purple); border-color: var(--theme-purple); background: rgba(186, 85, 211, 0.08);"' 
            : '';

        card.innerHTML = `
            <div class="trouble-card-header">
                <span class="trb-location-badge" ${badgeStyle}>${locationText}</span>
                <span class="trb-time-stamp">${trb.timestamp || '----/--/-- --:--'}</span>
            </div>
            <div class="trouble-card-body">
                <div class="trb-title-text">${escapeHtml(trb.title)}</div>
                <div class="trb-desc-text">${escapeHtml(trb.detail || '').replace(/\n/g, '<br>')}</div>
            </div>
            <div class="trouble-card-footer">
                <div class="trb-status-badge ${badgeClass}">
                    <span>${escapeHtml(trb.status)}</span>
                </div>
                <div class="trb-history-box" title="${historyText}">
                    <span>履歴: ${historyText}</span>
                </div>
            </div>
        `;

        // 場所バッジをタップした際の挙举（台番号ジャンプ）
        if (hasValidMachine) {
            const badge = card.querySelector('.trb-location-badge');
            if (badge) {
                badge.addEventListener('click', (e) => {
                    e.stopPropagation(); // 親要素のカードタップ（編集モーダル）を抑止
                    const machineId = parseInt(match[0], 10);
                    
                    // トラブル一覧画面を閉じる
                    if (viewTroubles) {
                        viewTroubles.classList.remove('active');
                    }
                    
                    // 清掃画面を開く
                    openCleaningCanvasView();
                    
                    // 画面遷移アニメーション完了を待ってから該当台番号にスクロール
                    setTimeout(() => {
                        scrollToMachine(machineId);
                    }, 400);
                });
            }
        }

        // 🆕 カード全体をタップすると「詳細・編集画面（モーダル）」を開く
        card.addEventListener('click', () => {
            openTroubleEditModal(trb);
        });

        return card;
    }

    // 🆕 詳細・編集モーダルを開き、値を流し込む処理
    function openTroubleEditModal(trb) {
        currentEditingTroubleId = trb.id;

        // 上半分：読み取り専用情報のテキスト代入
        if (viewTrbLocation) viewTrbLocation.textContent = trb.location;
        if (viewTrbTitle) viewTrbTitle.textContent = trb.title;
        if (viewTrbTime) viewTrbTime.textContent = trb.timestamp || '----/--/-- --:--';
        if (viewTrbDetail) viewTrbDetail.innerHTML = escapeHtml(trb.detail || '').replace(/\n/g, '<br>');

        // 下半分：編集フォームへの初期値代入
        if (editTrbStatus) {
            // ステータス値をセレクトにマッピング
            editTrbStatus.value = trb.status || '未対応';
        }
        if (editTrbHistory) {
            editTrbHistory.value = trb.history || '';
        }

        // 編集モーダルをアクティブ化
        if (troubleEditOverlay) troubleEditOverlay.classList.add('active');
    }

    function closeTroubleEditModal() {
        if (troubleEditOverlay) troubleEditOverlay.classList.remove('active');
        currentEditingTroubleId = null;
    }

    if (troubleEditClose) troubleEditClose.addEventListener('click', closeTroubleEditModal);
    if (troubleEditCancel) troubleEditCancel.addEventListener('click', closeTroubleEditModal);

    // 🆕 故障・トラブルのステータス・対応履歴の更新保存処理
    if (troubleEditSave) {
        troubleEditSave.addEventListener('click', async () => {
            if (!currentEditingTroubleId) return;

            const status = editTrbStatus.value;
            const history = editTrbHistory.value.trim();

            troubleEditSave.textContent = '更新中...';
            troubleEditSave.disabled = true;

            const rowId = currentEditingTroubleId;

            if (GAS_API_URL) {
                try {
                    const response = await fetch(GAS_API_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded'
                        },
                        body: new URLSearchParams({
                            action: 'updateTroubleStatus', // 新規APIアクション
                            id: rowId,
                            status: status,
                            history: history,
                            passcode: localStorage.getItem('arena_passcode') || ''
                        })
                    });
                    if (response.ok) {
                        const result = await response.json();
                        if (result.status === 'error' || result.success === false) {
                            alert(`認証エラー: ${result.message || result.error || 'アクセス権限がありません。'}`);
                            troubleEditSave.textContent = '更新する';
                            troubleEditSave.disabled = false;
                            return;
                        }
                    } else {
                        throw new Error('通信エラーが発生しました。');
                    }
                    updateTroubleStatusLocal(rowId, status, history);
                } catch (e) {
                    console.error('スプレッドシートのトラブル更新に失敗しました。ローカル保存します。', e);
                    updateTroubleStatusLocal(rowId, status, history);
                }
            } else {
                updateTroubleStatusLocal(rowId, status, history);
            }

            // モーダルを閉じ、要素を復元
            troubleEditSave.textContent = '更新する';
            troubleEditSave.disabled = false;
            closeTroubleEditModal();

            // 🌟 画面の動き：
            // もしステータスを「完了」（または済）に変更して更新した場合、
            // 定義した .fade-out-done クラスを付与し、スムーズな消滅イージングを行った後に
            // loadTroublesList() で再描画します。
            if (status === '完了' || status === '済') {
                const cardEl = document.getElementById(`trb-card-${rowId}`);
                if (cardEl) {
                    cardEl.classList.add('fade-out-done');
                    setTimeout(() => {
                        loadTroublesList(); // アニメーション（400ms）完了後に完全に再描画
                    }, 400);
                } else {
                    loadTroublesList();
                }
            } else {
                loadTroublesList(); // 未対応、対応中の場合はステータス変更のみ反映してリスト再描画
            }
        });
    }

    // ローカル側トラブルのステータス＆対応履歴上書き更新
    function updateTroubleStatusLocal(id, newStatus, newHistory) {
        try {
            const dataStr = localStorage.getItem('arena_troubles');
            if (dataStr) {
                const list = JSON.parse(dataStr);
                const updatedList = list.map(item => {
                    if (item.id === parseInt(id)) {
                        return { ...item, status: newStatus, history: newHistory };
                    }
                    return item;
                });
                localStorage.setItem('arena_troubles', JSON.stringify(updatedList));
            }
        } catch (e) {
            console.error('ローカル故障情報の更新に失敗しました。', e);
        }
    }

    // 故障報告 新規モーダル開閉
    if (fabAddTrouble) {
        fabAddTrouble.addEventListener('click', () => {
            if (trbLocation) trbLocation.value = '';
            if (trbTitle) trbTitle.value = '';
            if (trbDetail) trbDetail.value = '';
            
            if (troubleAddOverlay) troubleAddOverlay.classList.add('active');
        });
    }

    function closeAddTroubleModal() {
        if (troubleAddOverlay) troubleAddOverlay.classList.remove('active');
    }

    if (troubleAddClose) troubleAddClose.addEventListener('click', closeAddTroubleModal);
    if (troubleAddCancel) troubleAddCancel.addEventListener('click', closeAddTroubleModal);

    // 新規故障データの送信処理
    if (troubleAddSubmit) {
        troubleAddSubmit.addEventListener('click', async () => {
            const location = trbLocation.value.trim();
            const title = trbTitle.value.trim();
            const detail = trbDetail.value.trim();

            if (!location || !title) {
                alert('「場所（台番）」と「トラブル内容」は必須入力項目です。');
                return;
            }

            troubleAddSubmit.textContent = '送信中...';
            troubleAddSubmit.disabled = true;

            const now = new Date();
            const formattedTime = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

            if (GAS_API_URL) {
                try {
                    const response = await fetch(GAS_API_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded'
                        },
                        body: new URLSearchParams({
                            action: 'addTrouble',
                            reporter: localStorage.getItem('arena_user_name') || 'スタッフ',
                            location: location,
                            title: title,
                            detail: detail,
                            timestamp: formattedTime,
                            status: '未対応', 
                            history: '',
                            passcode: localStorage.getItem('arena_passcode') || ''
                        })
                    });
                    if (response.ok) {
                        const result = await response.json();
                        if (result.status === 'error' || result.success === false) {
                            alert(`認証エラー: ${result.message || result.error || 'アクセス権限がありません。'}`);
                            troubleAddSubmit.textContent = '送信する';
                            troubleAddSubmit.disabled = false;
                            return;
                        }
                    } else {
                        throw new Error('通信エラーが発生しました。');
                    }
                    addTroubleLocal(location, title, detail, formattedTime);
                } catch (e) {
                    console.error('スプレッドシート故障行挿入失敗。ローカル保存。', e);
                    addTroubleLocal(location, title, detail, formattedTime);
                }
            } else {
                addTroubleLocal(location, title, detail, formattedTime);
            }

            troubleAddSubmit.textContent = '送信する';
            troubleAddSubmit.disabled = false;
            closeAddTroubleModal();
            loadTroublesList();
        });
    }

    function addTroubleLocal(location, title, detail, timestamp) {
        try {
            const dataStr = localStorage.getItem('arena_troubles');
            let list = dataStr ? JSON.parse(dataStr) : [];
            const maxId = list.reduce((max, item) => item.id > max ? item.id : max, 0);
            
            const newTrouble = {
                id: maxId + 1,
                timestamp: timestamp,
                location: location,
                title: title,
                detail: detail,
                status: '未対応',
                history: ''       
            };

            list.push(newTrouble);
            localStorage.setItem('arena_troubles', JSON.stringify(list));
        } catch (e) {
            console.error('ローカル故障情報追加失敗。', e);
        }
    }


    // ==========================================
    // 5.5 【SPAサブビュー】曜日清掃・作業一覧機能 🆕
    // ==========================================
    const btnTriggerCleanings = document.getElementById('btn-trigger-cleanings');
    const viewCleanings = document.getElementById('view-cleanings');
    const cleaningsBackBtn = document.getElementById('cleanings-back-btn');
    const cleaningsListContainer = document.getElementById('cleanings-list-container');
    const cleaningsListLoader = document.getElementById('cleanings-list-loader');
    const cleaningsListEmpty = document.getElementById('cleanings-list-empty');
    const cleaningsCountBadge = document.getElementById('cleanings-count-badge');
    const cleaningTabs = document.querySelectorAll('.cleaning-tab');

    // 現在選択されている曜日（ロード時に自動設定）
    let currentSelectedDay = '';

    // 日本語の曜日マッピング配列
    const dayOfWeekJa = ['日', '月', '火', '水', '木', '金', '土'];

    // 曜日清掃一覧画面を開く
    if (btnTriggerCleanings) {
        btnTriggerCleanings.addEventListener('click', (e) => {
            e.stopPropagation();
            
            if (viewCleanings) {
                viewCleanings.classList.add('active');
                if (appNavBar) appNavBar.style.display = 'none';
            }
            
            // 開いた瞬間に本日の曜日を自動アクティブ化
            const todayIdx = new Date().getDay();
            const todayJa = dayOfWeekJa[todayIdx];
            
            selectCleaningTab(todayJa);
        });
    }

    // 戻るボタン
    if (cleaningsBackBtn) {
        cleaningsBackBtn.addEventListener('click', () => {
            if (viewCleanings) {
                viewCleanings.classList.remove('active');
                if (appNavBar) appNavBar.style.display = 'flex';
            }
        });
    }

    // 曜日タブ切り替えイベントの登録
    cleaningTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const day = tab.getAttribute('data-day');
            selectCleaningTab(day);
        });
    });

    // 指定した曜日タブを選択状態にし、データをロードする
    function selectCleaningTab(day) {
        currentSelectedDay = day;
        
        cleaningTabs.forEach(tab => {
            if (tab.getAttribute('data-day') === day) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });

        loadCleaningsList(day);
    }

    // 指定曜日の作業リストを取得して描画
    async function loadCleaningsList(day) {
        if (cleaningsListLoader) cleaningsListLoader.style.display = 'flex';
        if (cleaningsListEmpty) cleaningsListEmpty.style.display = 'none';
        if (cleaningsListContainer) cleaningsListContainer.innerHTML = '';
        if (cleaningsCountBadge) cleaningsCountBadge.textContent = '済 0/0件';

        let list = [];

        if (GAS_API_URL) {
            try {
                // 🌟 GAS側の仕様に合わせ、曜日清掃シート名を明示的にクエリパラメータに指定
                const fetchUrl = `${GAS_API_URL}?sheetName=${encodeURIComponent('曜日清掃・作業')}`;
                console.log('曜日清掃フェッチ要求URL:', fetchUrl);
                
                const response = await fetch(fetchUrl);
                if (!response.ok) throw new Error('通信エラー');
                list = await response.json();
                console.log('本番GAS 曜日作業取得レスポンス生データ:', list);
                
                // 🌟 レスポンスが配列でない場合の安全対策（エラーまたは空オブジェクト時のローカルフォールバック）
                if (!Array.isArray(list)) {
                    console.warn('GASレスポンスが配列ではありません。古いデプロイまたはシート構成が異なる可能性があるため、ローカルモックに安全にフォールバックします。', list);
                    list = loadCleaningsLocal();
                }
            } catch (e) {
                console.error('曜日作業スプレッドシート取得失敗。ローカルモックを使用します。', e);
                list = loadCleaningsLocal();
            }
        } else {
            list = loadCleaningsLocal();
        }

        if (cleaningsListLoader) cleaningsListLoader.style.display = 'none';

        // 🌟 ID（スプレッドシート行番号）がレスポンスに含まれない場合、
        // フロント側で「配列の順序 + 2」をID（rowId）として自動計算・補完します。
        // これにより、シート側に余分なID列を追加せずとも完璧に指定行の更新が走ります。
        const listWithIds = list.map((item, idx) => {
            const calculatedId = idx + 2; // A1がヘッダーのためデータは2行目開始
            const finalId = item.id || item['ID'] || item['id'] || item['行番号'] || calculatedId;
            return { ...item, id: finalId };
        });

        // 選択された曜日のタスクのみにフィルタリング（日本語「曜日」・英語「day」・表記揺れ両対応）
        const filteredList = listWithIds.filter(item => {
            const itemDay = item['曜日'] || item.day || item['曜'];
            return itemDay === day || (itemDay && itemDay.replace('曜日', '') === day);
        });

        if (!filteredList || filteredList.length === 0) {
            if (cleaningsListEmpty) cleaningsListEmpty.style.display = 'flex';
        } else {
            // 進捗状況の計算
            const totalCount = filteredList.length;
            const doneCount = filteredList.filter(item => {
                const status = item['ステータス'] || item.status || item['状況'];
                return status === '済' || status === '完了';
            }).length;
            if (cleaningsCountBadge) {
                cleaningsCountBadge.textContent = `済 ${doneCount}/${totalCount}件`;
            }

            // 🌟 左右2コラムの骨組みHTMLをコンテナに流し込む！
            if (cleaningsListContainer) {
                cleaningsListContainer.innerHTML = `
                    <div class="cleaning-shifts-layout">
                        <div class="cleaning-shift-column">
                            <div class="shift-column-header header-early">
                                <span class="shift-title-icon">🌅</span> 早番タスク
                            </div>
                            <div class="shift-cleaning-list" id="early-cleanings-list"></div>
                        </div>
                        <div class="cleaning-shift-column">
                            <div class="shift-column-header header-late">
                                <span class="shift-title-icon">🌃</span> 遅番タスク
                            </div>
                            <div class="shift-cleaning-list" id="late-cleanings-list"></div>
                        </div>
                    </div>
                `;
            }

            const earlyListContainer = document.getElementById('early-cleanings-list');
            const lateListContainer = document.getElementById('late-cleanings-list');

            let hasEarly = false;
            let hasLate = false;

            filteredList.forEach(item => {
                const shift = item['対象シフト'] || item.shift || '早番';
                const cleaningEl = createCleaningItemElement(item);
                
                if (shift === '遅番') {
                    if (lateListContainer) {
                        lateListContainer.appendChild(cleaningEl);
                        hasLate = true;
                    }
                } else {
                    // 早番、またはその他はすべて左側（早番）に振り分ける
                    if (earlyListContainer) {
                        earlyListContainer.appendChild(cleaningEl);
                        hasEarly = true;
                    }
                }
            });

            // 片方のコラムが空の場合のメッセージ
            if (!hasEarly && earlyListContainer) {
                earlyListContainer.innerHTML = '<div class="shift-empty-msg">タスクはありません</div>';
            }
            if (!hasLate && lateListContainer) {
                lateListContainer.innerHTML = '<div class="shift-empty-msg">タスクはありません</div>';
            }
        }
    }

    // ローカルストレージから曜日清掃データをロード
    function loadCleaningsLocal() {
        try {
            const dataStr = localStorage.getItem('arena_cleanings');
            if (dataStr) {
                return JSON.parse(dataStr);
            }
        } catch (e) {
            console.warn('ローカル曜日作業データ読み込み失敗。', e);
        }
        return [];
    }

    // 曜日清掃リストアイテム要素を動的生成
    function createCleaningItemElement(item) {
        const itemEl = document.createElement('div');
        
        // ハイブリッド抽出（本番日本語ヘッダー／モック英語／表記揺れ対応）
        const shift = item['対象シフト'] || item.shift || '早番';
        const category = item['カテゴリ'] || item.category || '';
        const task = item['内容'] || item['作業内容'] || item.task || '';
        const executor = item['実施者'] || item['実施者名'] || item['担当者'] || item['担当'] || item.executor || item.assignee || '';
        const status = item['ステータス'] || item.status || item['状況'] || '未';
        const rowId = item.id || item['ID'] || item['id'] || item['行番号'];
        
        const isDone = status === '済' || status === '完了';
        itemEl.className = `cleaning-item ${isDone ? 'done' : ''}`;
        itemEl.id = `cleaning-item-${rowId}`;

        // シフトバッジ用クラス判定
        let shiftClass = '';
        if (shift === '早番') {
            shiftClass = 'shift-early';
        } else if (shift === '遅番') {
            shiftClass = 'shift-late';
        }

        // 実施者プルダウン用の選択肢生成（スプレッドシートからロードしたスタッフを優先し、なければデフォルトに自動フォールバック）
        const defaultStaffList = ['小室', '宇田川', '高佐', '梶', '東', '熊谷', '高橋', '山内', '鈴木', '岩上', '鴨志田'];
        const staffList = (window.globalStaffList && window.globalStaffList.length > 0) ? window.globalStaffList : defaultStaffList;
        let optionsHtml = '<option value="">未選択</option>';
        let hasSelected = false;
        
        staffList.forEach(name => {
            const isSel = (executor === name);
            if (isSel) hasSelected = true;
            optionsHtml += `<option value="${name}" ${isSel ? 'selected' : ''}>${escapeHtml(name)}</option>`;
        });
        
        // 特殊ケース（全員、または選択肢にないスタッフ名）
        if (executor && executor !== '全員' && !hasSelected) {
            optionsHtml += `<option value="${executor}" selected>${escapeHtml(executor)}</option>`;
        } else if (executor === '全員') {
            optionsHtml += `<option value="全員" selected>全員</option>`;
        } else {
            optionsHtml += `<option value="全員">全員</option>`;
        }

        itemEl.innerHTML = `
            <label class="cleaning-checkbox-wrapper">
                <input type="checkbox" class="cleaning-checkbox" data-id="${rowId}" ${isDone ? 'checked' : ''}>
                <span class="custom-checkbox"></span>
            </label>
            <div class="cleaning-item-content">
                <div class="cleaning-meta-header">
                    <span class="cleaning-shift-badge ${shiftClass}">${escapeHtml(shift)}</span>
                    ${category ? `<span class="cleaning-category-badge">${escapeHtml(category)}</span>` : ''}
                </div>
                <div class="cleaning-task-text">${escapeHtml(task)}</div>
                <div class="cleaning-executor-container">
                    <span class="executor-label">実施者:</span>
                    <select class="cyber-select-mini cleaning-executor-select" data-id="${rowId}">
                        ${optionsHtml}
                    </select>
                </div>
            </div>
            <button class="btn-edit-cleaning" data-id="${rowId}" title="編集する">
                <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
            </button>
        `;

        // チェックボックスの状態変更イベント
        const checkbox = itemEl.querySelector('.cleaning-checkbox');
        checkbox.addEventListener('change', async (e) => {
            const checked = e.target.checked;
            const newStatus = checked ? '済' : '未';

            // 即座に画面上のスタイルに反映（グレーアウト・取り消し線のトグル）
            if (checked) {
                itemEl.classList.add('done');
            } else {
                itemEl.classList.remove('done');
            }

            if (GAS_API_URL) {
                try {
                    const response = await fetch(GAS_API_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded'
                        },
                        body: new URLSearchParams({
                            action: 'updateCleaningStatus',
                            id: rowId,
                            status: newStatus,
                            passcode: localStorage.getItem('arena_passcode') || ''
                        })
                    });
                    if (response.ok) {
                        const result = await response.json();
                        if (result.status === 'error' || result.success === false) {
                            alert(`認証エラー: ${result.message || result.error || 'アクセス権限がありません。'}`);
                            // スタイルを元に戻す
                            if (checked) {
                                itemEl.classList.remove('done');
                                checkbox.checked = false;
                            } else {
                                itemEl.classList.add('done');
                                checkbox.checked = true;
                            }
                            updateCleaningBadgeProgress();
                            return;
                        }
                    } else {
                        throw new Error('通信エラーが発生しました。');
                    }
                    updateCleaningStatusLocal(rowId, newStatus);
                } catch (err) {
                    console.error('スプレッドシートの曜日作業更新失敗。', err);
                    updateCleaningStatusLocal(rowId, newStatus);
                }
            } else {
                updateCleaningStatusLocal(rowId, newStatus);
            }

            // カウンタバッジの再計算・リアルタイム更新
            updateCleaningBadgeProgress();
        });

        // 実施者プルダウン変更イベント
        const executorSelect = itemEl.querySelector('.cleaning-executor-select');
        executorSelect.addEventListener('change', async (e) => {
            const selectedVal = e.target.value;

            if (GAS_API_URL) {
                try {
                    const response = await fetch(GAS_API_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded'
                        },
                        body: new URLSearchParams({
                            action: 'updateCleaningExecutor',
                            id: rowId,
                            executor: selectedVal,
                            passcode: localStorage.getItem('arena_passcode') || ''
                        })
                    });
                    if (response.ok) {
                        const result = await response.json();
                        if (result.status === 'error' || result.success === false) {
                            alert(`認証エラー: ${result.message || result.error || 'アクセス権限がありません。'}`);
                            return;
                        }
                    } else {
                        throw new Error('通信エラーが発生しました。');
                    }
                    updateCleaningExecutorLocal(rowId, selectedVal);
                } catch (err) {
                    console.error('スプレッドシートの実施者更新失敗。', err);
                    updateCleaningExecutorLocal(rowId, selectedVal);
                }
            } else {
                updateCleaningExecutorLocal(rowId, selectedVal);
            }
        });

        // 編集ボタン変更イベント
        const editBtn = itemEl.querySelector('.btn-edit-cleaning');
        if (editBtn) {
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                currentEditingCleaningId = rowId;

                if (cleaningDaySelect) cleaningDaySelect.value = item['曜日'] || item.day || item['曜'] || '月';
                if (cleaningShiftSelect) cleaningShiftSelect.value = shift;
                if (cleaningCategoryInput) cleaningCategoryInput.value = category;
                if (cleaningTaskInput) cleaningTaskInput.value = task;

                const modalTitle = document.getElementById('weekly-cleaning-modal-title');
                if (modalTitle) modalTitle.textContent = '曜日タスクの編集';
                if (weeklyCleaningAddSave) weeklyCleaningAddSave.textContent = '更新する';

                if (weeklyCleaningAddOverlay) weeklyCleaningAddOverlay.classList.add('active');
            });
        }

        return itemEl;
    }

    // 画面全体の進捗状況カウンタバッジを更新するヘルパー
    function updateCleaningBadgeProgress() {
        if (!cleaningsListContainer || !cleaningsCountBadge) return;
        const allItems = cleaningsListContainer.querySelectorAll('.cleaning-item');
        const total = allItems.length;
        const done = cleaningsListContainer.querySelectorAll('.cleaning-checkbox:checked').length;
        cleaningsCountBadge.textContent = `済 ${done}/${total}件`;
    }

    // ローカルストレージのステータス更新
    function updateCleaningStatusLocal(id, newStatus) {
        try {
            const dataStr = localStorage.getItem('arena_cleanings');
            if (dataStr) {
                const list = JSON.parse(dataStr);
                const updatedList = list.map(item => {
                    if (item.id === parseInt(id)) {
                        return { ...item, status: newStatus };
                    }
                    return item;
                });
                localStorage.setItem('arena_cleanings', JSON.stringify(updatedList));
            }
        } catch (e) {
            console.error('ローカル曜日作業ステータス更新失敗。', e);
        }
    }

    // ローカルストレージの実施者更新
    function updateCleaningExecutorLocal(id, newExecutor) {
        try {
            const dataStr = localStorage.getItem('arena_cleanings');
            if (dataStr) {
                const list = JSON.parse(dataStr);
                const updatedList = list.map(item => {
                    if (item.id === parseInt(id)) {
                        return { ...item, executor: newExecutor };
                    }
                    return item;
                });
                localStorage.setItem('arena_cleanings', JSON.stringify(updatedList));
            }
        } catch (e) {
            console.error('ローカル曜日作業実施者更新失敗。', e);
        }
    }


    // ==========================================
    // 6. ボタンタップ時のサイバーモダール & URL外部遷移制御（スケジュール対応）
    // ==========================================
    const modalOverlay = document.getElementById('modal-overlay');
    const modalTitle = document.getElementById('modal-title');
    const modalText = document.getElementById('modal-text');
    const modalIcon = document.getElementById('modal-icon');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const modalOkBtn = document.getElementById('modal-ok-btn');
    const systemLoader = document.querySelector('.system-loader');
    const loadingText = document.querySelector('.loading-text');

    const actionButtons = document.querySelectorAll('.action-btn');
    actionButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const actionName = btn.getAttribute('data-action');
            if (actionName === 'お願いごと' || actionName === '故障報告' || actionName === '曜日清掃・作業') return; // スライドインSPA画面に委ねる

            let icon = '📲';
            let content = '';
            let targetUrl = null;

            switch(actionName) {
                // ==========================================
                // 【ホームタブのアクション】
                // ==========================================
                case 'スケジュール':
                    icon = '📅';
                    targetUrl = 'https://docs.google.com/spreadsheets/d/103j9wUgj_eu0bMgvRFoMFw5gy4_vr4b5RHgGEUkxieA/edit?gid=633683311#gid=633683311';
                    content = `<strong>【販促運営スケジュール同期】</strong><br><br>
                               Googleスプレッドシートの月間販促予定スケジュール表へ接続します。<br>
                               現在、新規ブラウザタブで安全なロードを実行中です...<br><br>
                               画面が切り替わらない場合は、以下のボタンを直接タップしてください。<br><br>
                               <a href="${targetUrl}" target="_blank" class="cyber-btn" style="display:inline-block; text-decoration:none; text-align:center; width:100%; box-shadow:0 0 10px rgba(255, 170, 0, 0.3)">👉 スケジュール表を開く</a>`;
                    break;
                case '曜日清掃・作業':
                    icon = '🧹';
                    content = `<strong>【定期クリーンアップチェック】</strong><br><br>
                               本日の清掃項目（日曜日：喫煙ブースの念入りフィルター清掃、外周ゴミ拾い強化）のチェックリストを起動します。<br>
                               ・喫煙所消臭・フィルター：[未実施]<br>
                               ・景品カウンター裏清掃：[未実施]`;
                    break;
                case '拾得台帳':
                    icon = '🎒';
                    targetUrl = 'https://matatabisan5656-maker.github.io/hirotokubutsu-app/';
                    content = `<strong>【落とし物・拾得物管理システム】</strong><br><br>
                               外部の拾得台帳アプリケーションへ接続します。<br>
                               安全な外部ブラウザ（新しいタブ）でリンクを起動しています...<br><br>
                               自動で切り替わらない場合、またはポップアップがブロックされた場合は、以下のボタンを直接タップしてください。<br><br>
                               <a href="${targetUrl}" target="_blank" class="cyber-btn" style="display:inline-block; text-decoration:none; text-align:center; width:100%; box-shadow:0 0 10px rgba(0, 240, 255, 0.3)">👉 拾得物アプリを開く</a>`;
                    break;
                case 'お客様の声':
                    icon = '🗣️';
                    targetUrl = 'https://docs.google.com/spreadsheets/d/1-2EfyhGF8yavfXLN3FhJ0vaXdwKwsINF86plCcT_xTw/edit?gid=685423140#gid=685423140';
                    content = `<strong>【カスタマーボイス・ご意見集計】</strong><br><br>
                               Googleスプレッドシート形式のお客様の声集計データベースを起動します。<br>
                               現在、新規ブラウザタブで安全なロードを実行中です...<br><br>
                               画面が切り替わらない場合は、以下のボタンを直接タップしてください。<br><br>
                               <a href="${targetUrl}" target="_blank" class="cyber-btn" style="display:inline-block; text-decoration:none; text-align:center; width:100%; box-shadow:0 0 10px rgba(255, 0, 127, 0.3)">👉 スプレッドシートを開く</a>`;
                    break;

                // ==========================================
                // 【業務リンク集タブのアクション】
                // ==========================================
                case 'シフト表':
                    icon = '📊';
                    targetUrl = 'https://docs.google.com/spreadsheets/d/1meBsUfFmaIrEbqMcN8AHPQpOEvgAzqHSRp1rWDC16Ac/edit?gid=286856512#gid=286856512';
                    content = `<strong>【シフト表確認ツール】</strong><br><br>
                               Googleスプレッドシートの出勤状況スケジュールへ接続します。<br>
                               現在、新規ブラウザタブを起動しています...<br><br>
                               自動で起動しない場合は、以下のボタンを直接タップしてください。<br><br>
                               <a href="${targetUrl}" target="_blank" class="cyber-btn" style="display:inline-block; text-decoration:none; text-align:center; width:100%; box-shadow:0 0 10px rgba(0, 240, 255, 0.3)">👉 シフト表を開く</a>`;
                    break;
                case 'シフト希望表':
                    icon = '📝';
                    targetUrl = 'https://docs.google.com/spreadsheets/d/1-Il68h8tJQAMHJn8gLOfgttf89BdAOJSgbxqDVbjQJ8/edit?gid=141331456#gid=141331456';
                    content = `<strong>【シフト希望提出システム】</strong><br><br>
                               Googleスプレッドシートのシフト休暇希望フォームへ接続します。<br>
                               提出期限：毎月25日午前中まで。<br>
                               新規ブラウザタブでシステムを起動中...<br><br>
                               自動で起動しない場合は、以下のボタンを直接タップしてください。<br><br>
                               <a href="${targetUrl}" target="_blank" class="cyber-btn" style="display:inline-block; text-decoration:none; text-align:center; width:100%; box-shadow:0 0 10px rgba(0, 114, 255, 0.3)">👉 希望表を開く</a>`;
                    break;
                case '賞味期限アプリ':
                    icon = '🍎';
                    targetUrl = 'https://script.google.com/macros/s/AKfycbwlCFNqYswI7U2ILxEevByXCeUHcYtUX-ui1iY1czoUQyUiT3SEy-PuPFVHd7Hjubuf/exec';
                    content = `<strong>【景品・商品 鮮度管理システム】</strong><br><br>
                               Google Apps Script (GAS)製の賞味期限管理アプリケーションへ接続します。<br>
                               認証情報を安全に引き継ぎ、新規タブで起動中...<br><br>
                               自動で起動しない場合は、以下のボタンを直接タップしてください。<br><br>
                               <a href="${targetUrl}" target="_blank" class="cyber-btn" style="display:inline-block; text-decoration:none; text-align:center; width:100%; box-shadow:0 0 10px rgba(255, 170, 0, 0.3)">👉 賞味期限アプリを開く</a>`;
                    break;
                case '車両申請フォーム':
                    icon = '🚗';
                    targetUrl = 'https://docs.google.com/forms/d/e/1FAIpQLSdSAU6-suOzXylp0stNg63jB02V41Os3pF6wqFS_ymNy2Si0Q/viewform';
                    content = `<strong>【駐車場利用・社用車申請フォーム】</strong><br><br>
                               Googleフォーム形式の駐車場および社用車使用申請書をロードします。<br>
                               新規ブラウザタブで申請書をロード中...<br><br>
                               自動で起動しない場合は、以下のボタンを直接タップしてください。<br><br>
                               <a href="${targetUrl}" target="_blank" class="cyber-btn" style="display:inline-block; text-decoration:none; text-align:center; width:100%; box-shadow:0 0 10px rgba(0, 255, 136, 0.3)">👉 申請フォームを開く</a>`;
                    break;
                case '備品チェック＆稟議':
                    icon = '🖊️';
                    targetUrl = 'https://docs.google.com/spreadsheets/d/1f2EFMwwrdDqgTORTbzVA0Bc_xkTcfqSQC_maMYg6jF8/edit?gid=279979579#gid=279979579';
                    content = `<strong>【店舗消耗品・備品稟議ワークフロー】</strong><br><br>
                               Googleスプレッドシートのインベントリおよび稟議データベースへ接続します。<br>
                               安全な外部ブラウザ（新しいタブ）でリンクを起動しています...<br><br>
                               自動で起動しない場合は、以下のボタンを直接タップしてください。<br><br>
                               <a href="${targetUrl}" target="_blank" class="cyber-btn" style="display:inline-block; text-decoration:none; text-align:center; width:100%; box-shadow:0 0 10px rgba(161, 0, 255, 0.3)">👉 稟議シートを開く</a>`;
                    break;
                case 'AKT清掃':
                    icon = '🚿';
                    content = `<strong>【AKT（島・台設備）特別除菌清掃】</strong><br><br>
                               遊技台間、スマートシステム、上部データランプ付近の特別清掃と除菌実施の報告フォームです。<br>
                               ※このモジュールには現在外部URLが設定されていません。<br><br>
                               ・本日の進捗率：<span style="color:var(--theme-emerald)">85%</span> (残り4島)`;
                    break;
                case '子ども食堂仕分け':
                    icon = '🍱';
                    targetUrl = 'https://docs.google.com/spreadsheets/d/1sYcq_3hD5ntSEfT-SmWTs8f2Aog3hPzwykVLsm9_Lfg/edit?gid=0#gid=0';
                    content = `<strong>【子ども食堂支援・地域貢献仕分け台帳】</strong><br><br>
                               Googleスプレッドシートの地域食材仕分け管理台帳データベースをロードします。<br>
                               新規ブラウザタブで台帳を安全に起動中...<br><br>
                               自動で起動しない場合は、以下のボタンを直接タップしてください。<br><br>
                               <a href="${targetUrl}" target="_blank" class="cyber-btn" style="display:inline-block; text-decoration:none; text-align:center; width:100%; box-shadow:0 0 10px rgba(255, 85, 0, 0.3)">👉 仕分け台帳を開く</a>`;
                    break;
                case 'その他（予備）':
                    icon = '⚙️';
                    content = `<strong>【店舗システムツール・共通規定集】</strong><br><br>
                               店舗規定マニュアル、災害時オペレーションガイド、ポータルバージョン管理を行います。<br>
                               ※このモジュールには現在外部URLが設定されていません。<br><br>
                               ・システムバージョン: v2.5.0-arena<br>
                               ・接続ノード: MAIN-NODE-SHIBUYA`;
                    break;
            }

            if (targetUrl) {
                window.open(targetUrl, '_blank');
            }
            openModal(actionName, content, icon, null);
        });
    });

    // モーダルを開く処理
    function openModal(title, text, icon, targetUrl = null) {
        if (!modalTitle || !modalText || !modalIcon || !modalOverlay) return;

        modalTitle.textContent = title;
        modalText.innerHTML = text;
        modalIcon.textContent = icon;
        
        // ローダーのアニメーション演出
        if (loadingText) loadingText.textContent = 'ARENA SYSTEM CONNECTING...';
        if (systemLoader) systemLoader.style.display = 'flex';
        modalText.style.opacity = '0.3';
        
        modalOverlay.classList.add('active');
        
        // 0.6秒後にロード完了を演出
        setTimeout(() => {
            if (systemLoader) systemLoader.style.display = 'none';
            modalText.style.opacity = '1';
            modalText.style.transition = 'opacity 0.3s ease';
        }, 600);
    }

    // モーダルを閉じる処理
    function closeModal() {
        if (modalOverlay) modalOverlay.classList.remove('active');
    }

    if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
    if (modalOkBtn) modalOkBtn.addEventListener('click', closeModal);
    
    // 背景クリックでも閉じられるように
    if (modalOverlay) {
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                closeModal();
            }
        });
    }


    // ==========================================
    // 7.5 獲得会員数 直接編集ポップアップ機能
    // ==========================================
    if (editMemberBtn) {
        editMemberBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // 現在の獲得数を取得して初期値にセット
            const currentText = memberCurrent ? memberCurrent.textContent : '0';
            const currentVal = parseInt(currentText) || 0;
            if (inputMemberCurrent) inputMemberCurrent.value = currentVal;
            
            if (memberEditOverlay) memberEditOverlay.classList.add('active');
        });
    }

    function closeMemberModal() {
        if (memberEditOverlay) memberEditOverlay.classList.remove('active');
    }

    if (memberEditClose) memberEditClose.addEventListener('click', closeMemberModal);
    if (memberEditCancel) memberEditCancel.addEventListener('click', closeMemberModal);

    // 背景タップでも閉じられるように
    if (memberEditOverlay) {
        memberEditOverlay.addEventListener('click', (e) => {
            if (e.target === memberEditOverlay) {
                closeMemberModal();
            }
        });
    }

    // 会員数「ー」減算ボタン
    if (btnMemberMinus) {
        console.log('[DEBUG] btnMemberMinus を検出。イベントを登録します。');
        btnMemberMinus.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('[DEBUG] btnMemberMinus クリック検知');
            if (inputMemberCurrent) {
                const currentVal = parseInt(inputMemberCurrent.value) || 0;
                const newVal = Math.max(0, currentVal - 1);
                console.log(`[DEBUG] 会員数減少: ${currentVal} -> ${newVal}`);
                inputMemberCurrent.value = newVal;
            }
        });
    }

    // 会員数「＋」加算ボタン
    if (btnMemberPlus) {
        console.log('[DEBUG] btnMemberPlus を検出。イベントを登録します。');
        btnMemberPlus.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('[DEBUG] btnMemberPlus クリック検知');
            if (inputMemberCurrent) {
                const currentVal = parseInt(inputMemberCurrent.value) || 0;
                const newVal = currentVal + 1;
                console.log(`[DEBUG] 会員数増加: ${currentVal} -> ${newVal}`);
                inputMemberCurrent.value = newVal;
            }
        });
    }

    // 会員数の保存処理
    if (memberEditSave) {
        memberEditSave.addEventListener('click', async () => {
            const newCurrentVal = parseInt(inputMemberCurrent.value);
            if (isNaN(newCurrentVal) || newCurrentVal < 0) {
                alert('有効な数値を入力してください。');
                return;
            }

            memberEditSave.textContent = '保存中...';
            memberEditSave.disabled = true;

            const targetText = memberTarget ? memberTarget.textContent : '100';
            const targetVal = parseInt(targetText) || 100;

            if (GAS_API_URL) {
                try {
                    const response = await fetch(GAS_API_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded'
                        },
                        body: new URLSearchParams({
                            action: 'updateMembers',
                            currentMembers: newCurrentVal,
                            passcode: localStorage.getItem('arena_passcode') || ''
                        })
                    });
                    if (response.ok) {
                        const result = await response.json();
                        if (result.status === 'error' || result.success === false) {
                            alert(`認証エラー: ${result.message || result.error || 'アクセス権限がありません。'}`);
                            memberEditSave.textContent = '保存する';
                            memberEditSave.disabled = false;
                            return;
                        }
                    } else {
                        throw new Error('通信エラーが発生しました。');
                    }
                    saveMembersLocal(newCurrentVal, targetVal);
                } catch (e) {
                    console.error('会員数更新のスプレッドシート送信に失敗しました。ローカル保存します。', e);
                    saveMembersLocal(newCurrentVal, targetVal);
                }
            } else {
                saveMembersLocal(newCurrentVal, targetVal);
            }

            // UIを即座に「ギュン」と更新！
            updateProgressUI(newCurrentVal, targetVal);

            memberEditSave.textContent = '保存する';
            memberEditSave.disabled = false;
            closeMemberModal();
        });
    }

    function saveMembersLocal(currentVal, targetVal) {
        try {
            const dataStr = localStorage.getItem('arena_home');
            let data = {};
            if (dataStr) {
                data = JSON.parse(dataStr);
            }
            data['現在の会員数'] = currentVal;
            data['月間会員目標数'] = targetVal;
            localStorage.setItem('arena_home', JSON.stringify(data));
        } catch (e) {
            console.error('ローカルストレージへの会員数保存に失敗しました。', e);
        }
    }

    // ==========================================
    // 7.6 抽選・飛び込み人数 直接編集ポップアップ機能 🆕
    // ==========================================
    const editTrafficBtn = document.getElementById('edit-traffic-btn');
    const trafficEditOverlay = document.getElementById('traffic-edit-overlay');
    const trafficEditClose = document.getElementById('traffic-edit-close');
    const trafficEditCancel = document.getElementById('traffic-edit-cancel');
    const trafficEditSave = document.getElementById('traffic-edit-save');
    const inputLotteryCount = document.getElementById('input-lottery-count');
    const inputWalkInCount = document.getElementById('input-walk-in-count');
    const lotteryCountDisplay = document.getElementById('lottery-count-display');
    const walkInCountDisplay = document.getElementById('walk-in-count-display');
    const btnLotteryMinus = document.getElementById('btn-lottery-minus');
    const btnLotteryPlus = document.getElementById('btn-lottery-plus');
    const btnWalkinMinus = document.getElementById('btn-walkin-minus');
    const btnWalkinPlus = document.getElementById('btn-walkin-plus');

    if (editTrafficBtn) {
        editTrafficBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // 現在の抽選・飛び込み人数を取得して初期値にセット
            const currentLotteryText = lotteryCountDisplay ? lotteryCountDisplay.textContent : '0';
            const currentWalkInText = walkInCountDisplay ? walkInCountDisplay.textContent : '0';
            
            const currentLotteryVal = parseInt(currentLotteryText) || 0;
            const currentWalkInVal = parseInt(currentWalkInText) || 0;
            
            if (inputLotteryCount) inputLotteryCount.value = currentLotteryVal;
            if (inputWalkInCount) inputWalkInCount.value = currentWalkInVal;
            
            if (trafficEditOverlay) trafficEditOverlay.classList.add('active');
        });
    }

    function closeTrafficModal() {
        if (trafficEditOverlay) trafficEditOverlay.classList.remove('active');
    }

    if (trafficEditClose) trafficEditClose.addEventListener('click', closeTrafficModal);
    if (trafficEditCancel) trafficEditCancel.addEventListener('click', closeTrafficModal);

    if (trafficEditOverlay) {
        trafficEditOverlay.addEventListener('click', (e) => {
            if (e.target === trafficEditOverlay) {
                closeTrafficModal();
            }
        });
    }

    // 抽選人数「ー」減算ボタン
    if (btnLotteryMinus) {
        console.log('[DEBUG] btnLotteryMinus を検出。イベントを登録します。');
        btnLotteryMinus.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('[DEBUG] btnLotteryMinus クリック検知');
            if (inputLotteryCount) {
                const currentVal = parseInt(inputLotteryCount.value) || 0;
                const newVal = Math.max(0, currentVal - 1);
                console.log(`[DEBUG] 抽選人数減少: ${currentVal} -> ${newVal}`);
                inputLotteryCount.value = newVal;
            }
        });
    }

    // 抽選人数「＋」加算ボタン
    if (btnLotteryPlus) {
        console.log('[DEBUG] btnLotteryPlus を検出。イベントを登録します。');
        btnLotteryPlus.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('[DEBUG] btnLotteryPlus クリック検知');
            if (inputLotteryCount) {
                const currentVal = parseInt(inputLotteryCount.value) || 0;
                const newVal = currentVal + 1;
                console.log(`[DEBUG] 抽選人数増加: ${currentVal} -> ${newVal}`);
                inputLotteryCount.value = newVal;
            }
        });
    }

    // 飛び込み人数「ー」減算ボタン
    if (btnWalkinMinus) {
        console.log('[DEBUG] btnWalkinMinus を検出。イベントを登録します。');
        btnWalkinMinus.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('[DEBUG] btnWalkinMinus クリック検知');
            if (inputWalkInCount) {
                const currentVal = parseInt(inputWalkInCount.value) || 0;
                const newVal = Math.max(0, currentVal - 1);
                console.log(`[DEBUG] 飛び込み人数減少: ${currentVal} -> ${newVal}`);
                inputWalkInCount.value = newVal;
            }
        });
    }

    // 飛び込み人数「＋」加算ボタン
    if (btnWalkinPlus) {
        console.log('[DEBUG] btnWalkinPlus を検出。イベントを登録します。');
        btnWalkinPlus.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('[DEBUG] btnWalkinPlus クリック検知');
            if (inputWalkInCount) {
                const currentVal = parseInt(inputWalkInCount.value) || 0;
                const newVal = currentVal + 1;
                console.log(`[DEBUG] 飛び込み人数増加: ${currentVal} -> ${newVal}`);
                inputWalkInCount.value = newVal;
            }
        });
    }

    if (trafficEditSave) {
        trafficEditSave.addEventListener('click', async () => {
            const lotteryVal = parseInt(inputLotteryCount ? inputLotteryCount.value : '0') || 0;
            const walkInVal = parseInt(inputWalkInCount ? inputWalkInCount.value : '0') || 0;

            trafficEditSave.textContent = '保存中...';
            trafficEditSave.disabled = true;

            if (GAS_API_URL) {
                try {
                    const response = await fetch(GAS_API_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded'
                        },
                        body: new URLSearchParams({
                            action: 'updateLotteryWalkIn',
                            lotteryCount: lotteryVal,
                            walkInCount: walkInVal,
                            passcode: localStorage.getItem('arena_passcode') || ''
                        })
                    });
                    if (response.ok) {
                        const result = await response.json();
                        if (result.status === 'error' || result.success === false) {
                            alert(`認証エラー: ${result.message || result.error || 'アクセス権限がありません。'}`);
                            trafficEditSave.textContent = '保存する';
                            trafficEditSave.disabled = false;
                            return;
                        }
                    } else {
                        throw new Error('通信エラーが発生しました。');
                    }
                    saveTrafficLocal(lotteryVal, walkInVal);
                } catch (e) {
                    console.error('人数更新のスプレッドシート送信に失敗しました。ローカル保存します。', e);
                    saveTrafficLocal(lotteryVal, walkInVal);
                }
            } else {
                saveTrafficLocal(lotteryVal, walkInVal);
            }

            // UIを即座に更新！
            if (lotteryCountDisplay) lotteryCountDisplay.textContent = lotteryVal;
            if (walkInCountDisplay) walkInCountDisplay.textContent = walkInVal;

            trafficEditSave.textContent = '保存する';
            trafficEditSave.disabled = false;
            closeTrafficModal();
        });
    }

    function saveTrafficLocal(lottery, walkIn) {
        try {
            const dataStr = localStorage.getItem('arena_home');
            let data = {};
            if (dataStr) {
                data = JSON.parse(dataStr);
            }
            data['lotteryCount'] = lottery;
            data['walkInCount'] = walkIn;
            localStorage.setItem('arena_home', JSON.stringify(data));
        } catch (e) {
            console.error('ローカルストレージへの人数保存に失敗しました。', e);
        }
    }

    // ==========================================
    // 7. 会員獲得進捗スプレッドシート連携機能
    // ==========================================
    const memberTarget = document.getElementById('member-target');
    const memberCurrent = document.getElementById('member-current');
    const memberBar = document.getElementById('member-bar');

    function updateProgressUI(current, target) {
        if (!memberBar) return;
        
        const safeCurrent = isNaN(current) ? 45 : current;
        const safeTarget = isNaN(target) || target <= 0 ? 100 : target;
        
        let percent = (safeCurrent / safeTarget) * 100;
        percent = Math.min(Math.max(percent, 0), 100);
        
        if (memberTarget) memberTarget.textContent = safeTarget;
        if (memberCurrent) memberCurrent.textContent = safeCurrent;
        
        setTimeout(() => {
            memberBar.style.width = `${percent}%`;
        }, 150);
    }

    // HTMLエスケープヘルパー
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        const s = String(str);
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ==========================================
    // 8. 伝達履歴検索機能 🆕
    // ==========================================
    const historyStartDate = document.getElementById('history-start-date');
    const historyEndDate = document.getElementById('history-end-date');
    const btnHistorySearch = document.getElementById('btn-history-search');
    const btnHistoryClear = document.getElementById('btn-history-clear');
    const btnHistoryJump = document.getElementById('btn-history-jump');
    const historyListLoader = document.getElementById('history-list-loader');
    const historyListEmpty = document.getElementById('history-list-empty');
    const historyListContainer = document.getElementById('history-list-container');

    // HOME画面の伝達ヘッダーにある虫眼鏡ボタンイベント
    if (btnHistoryJump) {
        btnHistoryJump.addEventListener('click', (e) => {
            e.stopPropagation();
            switchTab('history');
        });
    }

    // 検索ボタンクリックイベント
    if (btnHistorySearch) {
        btnHistorySearch.addEventListener('click', () => {
            const start = historyStartDate ? historyStartDate.value : '';
            const end = historyEndDate ? historyEndDate.value : '';
            loadHistoryData(start, end);
        });
    }

    // クリアボタンクリックイベント
    if (btnHistoryClear) {
        btnHistoryClear.addEventListener('click', () => {
            if (historyStartDate) historyStartDate.value = '';
            if (historyEndDate) historyEndDate.value = '';
            loadHistoryData('', ''); // 全件表示で再読み込み
        });
    }

    // 日付データを安全に Date オブジェクトに変換するヘルパー関数
    function parseSafeDate(dateVal) {
        if (!dateVal) return null;
        if (dateVal instanceof Date) return dateVal;
        
        // ISO 8601 形式 (例: 2026-05-28T00:28:33.000Z) のパース
        if (typeof dateVal === 'string' && dateVal.includes('T') && dateVal.includes('Z')) {
            const d = new Date(dateVal);
            if (!isNaN(d.getTime())) return d;
        }
        
        const dateStr = String(dateVal).trim();
        
        // "yyyy/MM/dd HH:mm:ss" または "yyyy-MM-dd HH:mm" などのパターンを抽出
        const match = dateStr.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?\s*(\d{1,2})[::時](\d{1,2})(?:[::分](\d{1,2}))?秒?$/);
        if (match) {
            const year = parseInt(match[1], 10);
            const month = parseInt(match[2], 10) - 1; // 月は 0-indexed
            const day = parseInt(match[3], 10);
            const hour = parseInt(match[4], 10);
            const minute = parseInt(match[5], 10);
            const second = match[6] ? parseInt(match[6], 10) : 0;
            
            const d = new Date(year, month, day, hour, minute, second);
            if (!isNaN(d.getTime())) return d;
        }
        
        // フォールバック: 通常のパース
        const d = new Date(dateVal);
        if (!isNaN(d.getTime())) return d;
        
        return null;
    }

    // 日付を安全に "yyyy/MM/dd HH:mm" 形式の文字列に変換するヘルパー関数
    function formatRecordDate(dateVal) {
        const d = parseSafeDate(dateVal);
        if (!d || isNaN(d.getTime())) {
            return dateVal ? String(dateVal) : '----/--/-- --:--';
        }

        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');

        return `${yyyy}/${mm}/${dd} ${hh}:${min}`;
    }

    // 履歴データのロードおよび期間絞り込み検索
    async function loadHistoryData(startDateStr = '', endDateStr = '') {
        if (historyListLoader) historyListLoader.style.display = 'flex';
        if (historyListEmpty) historyListEmpty.style.display = 'none';
        if (historyListContainer) historyListContainer.innerHTML = '';

        let list = [];

        if (GAS_API_URL) {
            try {
                // スプレッドシートの「伝達事項」シート全件を一括GET
                const fetchUrl = `${GAS_API_URL}?sheetName=${encodeURIComponent('伝達事項')}`;
                const response = await fetch(fetchUrl);
                if (!response.ok) throw new Error('通信エラー');
                list = await response.json();
                
                if (!Array.isArray(list)) {
                    console.warn('伝達履歴のGASレスポンスが配列ではありません。ローカルにフォールバックします。', list);
                    list = loadHistoryLocal();
                }
            } catch (e) {
                console.error('伝達履歴のスプレッドシート取得に失敗しました。ローカルストレージを使用します。', e);
                list = loadHistoryLocal();
            }
        } else {
            list = loadHistoryLocal();
        }

        if (historyListLoader) historyListLoader.style.display = 'none';

        // カレンダー日付での期間フィルタリング判定
        let filteredList = list;
        
        if (startDateStr || endDateStr) {
            // カレンダーで選ばれる日付形式: "yyyy-mm-dd"
            // 時間を含めた厳密な Date 比較のための範囲設定
            let filterStart = null;
            let filterEnd = null;

            if (startDateStr) {
                // 開始日の 00:00:00.000 から
                filterStart = new Date(`${startDateStr}T00:00:00`);
            }
            if (endDateStr) {
                // 終了日の 23:59:59.999 まで
                filterEnd = new Date(`${endDateStr}T23:59:59`);
            }

            filteredList = list.filter(item => {
                const regTimeVal = item['登録日時'];
                if (!regTimeVal) return false;
                
                const recordDate = parseSafeDate(regTimeVal);
                // 有効な日付に変換できた場合のみ判定
                if (!recordDate || isNaN(recordDate.getTime())) return true; 

                if (filterStart && recordDate < filterStart) return false;
                if (filterEnd && recordDate > filterEnd) return false;
                
                return true;
            });
        }

        // リスト表示のレンダリング（最新順にソートして並べる）
        if (!filteredList || filteredList.length === 0) {
            if (historyListEmpty) historyListEmpty.style.display = 'flex';
        } else {
            // 登録日時でソート（新しい順）
            filteredList.sort((a, b) => {
                const dateA = parseSafeDate(a['登録日時']);
                const dateB = parseSafeDate(b['登録日時']);
                
                const timeA = dateA ? dateA.getTime() : 0;
                const timeB = dateB ? dateB.getTime() : 0;
                
                return timeB - timeA;
            });

            filteredList.forEach(item => {
                const card = createHistoryCard(item);
                if (historyListContainer) historyListContainer.appendChild(card);
            });
        }
    }

    // ローカルストレージから履歴全件ロード
    function loadHistoryLocal() {
        try {
            const dataStr = localStorage.getItem('arena_memo_list');
            if (dataStr) {
                return JSON.parse(dataStr);
            }
        } catch (e) {
            console.warn('ローカル伝達履歴の読み込みに失敗しました。', e);
        }
        return [];
    }

    // 履歴カードの動的生成
    function createHistoryCard(item) {
        const card = document.createElement('div');
        card.className = 'history-card';

        const regTimeRaw = item['登録日時'];
        const regTime = formatRecordDate(regTimeRaw);
        const content = item['内容'] || '';
        const category = item['区分'] || '通常';

        const isImportant = category.includes('重要');
        const badgeClass = isImportant ? 'important' : 'normal';
        const badgeLabel = isImportant ? '📌 重要' : '通常';

        card.innerHTML = `
            <div class="history-card-header" style="position: relative; padding-right: 32px;">
                <span class="history-time">${escapeHtml(regTime)}</span>
                <span class="history-badge ${badgeClass}">${escapeHtml(badgeLabel)}</span>
                <button class="btn-edit-memo" data-id="${item.id}" title="編集する" style="position: absolute; right: 0; top: 50%; transform: translateY(-50%); background: transparent; border: none; color: var(--neon-blue); cursor: pointer; display: flex; align-items: center; padding: 2px;">
                    <svg viewBox="0 0 24 24" style="width: 14px; height: 14px; fill: currentColor;"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                </button>
            </div>
            <div class="history-content">${escapeHtml(content).replace(/\n/g, '<br>')}</div>
        `;

        const editBtn = card.querySelector('.btn-edit-memo');
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            currentEditingMemoId = item.id;
            
            // モーダルに現在のデータをセット
            if (inputMemoDetail) inputMemoDetail.value = content || '';
            if (inputMemoPinned) inputMemoPinned.checked = isImportant;
            
            // モーダルの表示を「編集」用に更新
            const modalTitle = memoEditOverlay ? memoEditOverlay.querySelector('.modal-header h3') : null;
            if (modalTitle) modalTitle.textContent = '伝達事項の編集';
            if (memoEditSave) memoEditSave.textContent = '更新する';
            
            if (memoEditOverlay) memoEditOverlay.classList.add('active');
        });

        return card;
    }

});
