const ss = SpreadsheetApp.getActiveSpreadsheet();
const LINE_TOKEN_PROPERTY = 'LINE_CHANNEL_ACCESS_TOKEN';
const CORRECT_PASSCODE_PROPERTY = 'APP_CORRECT_PASSCODE';
const IMPORTANT_RETENTION_DAYS = 7;
const PUBLIC_READ_SHEETS = ['曜日清掃・作業', '伝達事項'];
const TROUBLE_SCHEDULE_COLUMNS = [
  '書類作成日', '書類作成完了',
  '書類提出日', '書類提出完了',
  'メーカー検査日', 'メーカー検査完了',
  '警察検査日', '警察検査完了',
  '書類取り日', '書類取り完了'
];

function getLineToken() {
  const token = PropertiesService.getScriptProperties().getProperty(LINE_TOKEN_PROPERTY);
  if (!token) throw new Error('LINE channel access token is not configured in Script Properties.');
  return token;
}

function getCorrectPasscode() {
  return PropertiesService.getScriptProperties().getProperty(CORRECT_PASSCODE_PROPERTY) || '';
}

function isValidPasscode(code) {
  if (!code) return false;

  const commonPasscode = getCorrectPasscode();
  if (commonPasscode && code === commonPasscode) return true;

  try {
    const sheet = ss.getSheetByName('スタッフ名簿');
    if (!sheet) return false;
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return false;

    const values = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
    for (let i = 0; i < values.length; i++) {
      if (values[i][0] == code) return true;
    }
  } catch (err) {
    console.warn('パスコード検証エラー:', err);
  }
  return false;
}

function jsonResponse(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function isWithinLastCalendarDays(dateValue, days) {
  if (!dateValue) return false;
  const recordDate = new Date(dateValue);
  if (isNaN(recordDate.getTime())) return false;

  const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const threshold = new Date(today + 'T00:00:00+09:00');
  threshold.setDate(threshold.getDate() - (days - 1));
  return recordDate >= threshold;
}

function ensureTroubleScheduleColumns(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), 7);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  let nextColumn = headers.length + 1;

  TROUBLE_SCHEDULE_COLUMNS.forEach(function(header) {
    if (headers.indexOf(header) === -1) {
      sheet.getRange(1, nextColumn).setValue(header);
      headers.push(header);
      nextColumn++;
    }
  });
  return headers;
}

function getRowValueByHeader(row, headers, header) {
  const index = headers.indexOf(header);
  return index >= 0 ? row[index] : '';
}

function formatDateForInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (isNaN(date.getTime())) return value.toString();
  return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd');
}

function parseDoneValue(value) {
  return value === true || value === 1 || value === '1' || value === 'TRUE' || value === '済' || value === '完了';
}

function setValueByHeader(sheet, rowId, headers, header, value) {
  const index = headers.indexOf(header);
  if (index >= 0) sheet.getRange(rowId, index + 1).setValue(value);
}

/**
 * 【GET】ポータルアプリからのデータ読み込み処理
 */
function doGet(e) {
  const action = e.parameter.action;
  const sheetName = e.parameter.sheetName;
  let result = {};

  if (!isValidPasscode(e.parameter.passcode)) {
    return jsonResponse({ success: false, error: '認証が必要です。再度ログインしてください。' });
  }

  try {
    if (sheetName || (!action && sheetName)) {
      if (PUBLIC_READ_SHEETS.indexOf(sheetName) === -1) {
        throw new Error('このシートは公開APIから読み込めません。');
      }
      const targetSheet = sheetName || 'HOME';
      const sheet = ss.getSheetByName(targetSheet);
      if (!sheet) throw new Error('シートが見つかりません。');

      const lastRow = sheet.getLastRow();
      const lastColumn = sheet.getLastColumn();
      const list = [];

      if (lastRow > 0 && lastColumn > 0) {
        const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
        if (lastRow > 1) {
          const values = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
          for (let i = 0; i < values.length; i++) {
            const row = values[i];
            const obj = { id: i + 2 };
            for (let j = 0; j < headers.length; j++) {
              const header = headers[j] ? headers[j].toString().trim() : '';
              if (header) obj[header] = row[j];
            }
            list.push(obj);
          }
        }
      }
      result = list;

    } else if (action === 'getHome') {
      const homeSheet = ss.getSheetByName('HOME');
      const lastColumn = homeSheet.getLastColumn();
      const headers = homeSheet.getRange(1, 1, 1, Math.max(lastColumn, 2)).getValues()[0];
      const data = homeSheet.getRange(2, 1, 1, Math.max(lastColumn, 2)).getValues()[0];

      const obj = {};
      for (let j = 0; j < headers.length; j++) {
        const header = headers[j] ? headers[j].toString().trim() : '';
        if (header) obj[header] = data[j];
      }

      obj.targetMembers = obj['月間会員目標数'] || data[0] || 0;
      obj.currentMembers = obj['現在の会員数'] || data[1] || 0;

      // 🌟【新規追加】抽選人数と飛び込み人数の取得（「抽選人数」「飛び込み人数」にも対応）
      obj.lotteryCount = obj['抽選'] || obj['抽選人数'] || 0;
      obj.walkInCount = obj['飛び込み'] || obj['飛び込み人数'] || 0;

      // 伝達事項の読み込み
      let memoSheet = ss.getSheetByName('伝達事項');
      if (!memoSheet) {
        memoSheet = ss.insertSheet('伝達事項');
        memoSheet.appendRow(['日時', '内容', '重要度']);
      }

      const memoLastRow = memoSheet.getLastRow();
      const pinnedDetailList = [];
      const detailList = [];
      let lastTimestamp = '';

      if (memoLastRow > 1) {
        const values = memoSheet.getRange(2, 1, memoLastRow - 1, 3).getValues();
        for (let i = values.length - 1; i >= 0; i--) {
          const row = values[i];
          const regTime = row[0];
          const content = row[1] ? row[1].toString().trim() : '';
          const category = row[2] ? row[2].toString().trim() : '';

          if (!regTime || !content) continue;

          const isImportant = category.includes('重要');
          if (isImportant && isWithinLastCalendarDays(regTime, IMPORTANT_RETENTION_DAYS)) {
            pinnedDetailList.push(content);
            if (!lastTimestamp) {
              lastTimestamp = Utilities.formatDate(new Date(regTime), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
            }
          }
          if (!isImportant && detailList.length < 5 && isWithinLastCalendarDays(regTime, 1)) {
            detailList.push(content);
            if (!lastTimestamp && pinnedDetailList.length === 0) {
              lastTimestamp = Utilities.formatDate(new Date(regTime), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
            }
          }
        }
      }

      obj.title = '伝達事項';
      obj.pinnedDetail = pinnedDetailList.length > 0 ? pinnedDetailList.join('\n\n') : '現在、重要なピン留め連絡はありません。';
      obj.detail = detailList.length > 0 ? detailList.join('\n\n') : '現在、通常の伝達事項はありません。';
      obj.timestamp = lastTimestamp || '----/--/-- --:--';

      const staffList = [];
      const staffLastRow = homeSheet.getLastRow();
      if (staffLastRow >= 2 && lastColumn >= 7) {
        const staffValues = homeSheet.getRange(2, 7, staffLastRow - 1, 1).getValues();
        for (let i = 0; i < staffValues.length; i++) {
          const val = staffValues[i][0] ? staffValues[i][0].toString().trim() : '';
          if (val) staffList.push(val);
        }
      }
      obj.staffList = staffList;
      result = [obj];

    } else if (action === 'getRequests') {
      const sheet = ss.getSheetByName('お願いごと');
      const lastRow = sheet.getLastRow();
      const list = [];
      if (lastRow > 1) {
        const values = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
        for (let i = 0; i < values.length; i++) {
          const row = values[i];
          const status = row[5] ? row[5].toString().trim() : '';
          if (status === '未' || status === '') {
            list.push({
              id: i + 2,
              timestamp: row[0] ? Utilities.formatDate(new Date(row[0]), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') : '',
              sender: row[1] || '不明',
              content: row[2] || '',
              assignee: row[3] || '全員',
              deadline: row[4] || 'なし',
              status: '未'
            });
          }
        }
      }
      result = list;
    } else if (action === 'getTroubles') {
      const sheet = ss.getSheetByName('故障トラブル');
      const headers = ensureTroubleScheduleColumns(sheet);
      const lastRow = sheet.getLastRow();
      const list = [];
      if (lastRow > 1) {
        const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
        for (let i = 0; i < values.length; i++) {
          const row = values[i];
          const status = row[5] ? row[5].toString().trim() : '未対応';
          if (status !== '完了' && status !== '済') {
            list.push({
              id: i + 2,
              timestamp: row[0] ? Utilities.formatDate(new Date(row[0]), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') : '',
              reporter: row[1] || '',
              location: row[2] || '不明',
              title: row[3] || '設備故障',
              detail: row[4] || '',
              status: status,
              history: row[6] || '',
              documentCreationDate: formatDateForInput(getRowValueByHeader(row, headers, '書類作成日')),
              documentCreationDone: parseDoneValue(getRowValueByHeader(row, headers, '書類作成完了')),
              documentSubmissionDate: formatDateForInput(getRowValueByHeader(row, headers, '書類提出日')),
              documentSubmissionDone: parseDoneValue(getRowValueByHeader(row, headers, '書類提出完了')),
              makerInspectionDate: formatDateForInput(getRowValueByHeader(row, headers, 'メーカー検査日')),
              makerInspectionDone: parseDoneValue(getRowValueByHeader(row, headers, 'メーカー検査完了')),
              policeInspectionDate: formatDateForInput(getRowValueByHeader(row, headers, '警察検査日')),
              policeInspectionDone: parseDoneValue(getRowValueByHeader(row, headers, '警察検査完了')),
              documentPickupDate: formatDateForInput(getRowValueByHeader(row, headers, '書類取り日')),
              documentPickupDone: parseDoneValue(getRowValueByHeader(row, headers, '書類取り完了'))
            });
          }
        }
      }
      result = list;
    } else if (action === 'getCleanings') {
      const sheet = ss.getSheetByName('曜日清掃・作業');
      const lastRow = sheet.getLastRow();
      const list = [];
      if (lastRow > 1) {
        const values = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
        for (let i = 0; i < values.length; i++) {
          const row = values[i];
          const status = row[4] ? row[4].toString().trim() : '';
          list.push({
            id: i + 2,
            day: row[0] || '',
            shift: row[1] || '早番',
            category: row[2] || '',
            task: row[3] || '',
            status: status === '済' ? '済' : '未',
            executor: row[5] || ''
          });
        }
      }
      result = list;
    } else if (action === 'getCassetteCleanings') {
      let sheet = ss.getSheetByName('カセット清掃');

      // シートが存在しない場合は自動生成して1〜440台分の初期行を作成
      if (!sheet) {
        sheet = ss.insertSheet('カセット清掃');
        sheet.appendRow(['台番号', 'ステータス', '実施者', '日時']);
        const initialData = [];
        for (let i = 1; i <= 440; i++) {
          initialData.push([i, '未', '', '']);
        }
        sheet.getRange(2, 1, 440, 4).setValues(initialData);
      }

      const lastRow = sheet.getLastRow();
      const list = [];
      if (lastRow > 1) {
        const values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
        for (let i = 0; i < values.length; i++) {
          const row = values[i];
          list.push({
            machineId: parseInt(row[0]),
            status: row[1] || '未',
            executor: row[2] || '',
            timestamp: row[3] || ''
          });
        }
      }
      result = list;
    }

    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ error: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}
/**
 * 【POST】アプリからの書き込み ＆ LINEからの書き込み
 */
function doPost(e) {
  if (e.postData && e.postData.contents) {
    try {
      const json = JSON.parse(e.postData.contents);
      if (json.events && json.events.length > 0) {
        return handleLineWebhook(json.events[0]);
      }
    } catch (err) { }
  }
  const params = e.parameter || {};
  const passcode = params.passcode;
  const action = params.action;
  // loginアクションの場合は、個別ID/PW認証へ進むためここではスキップ
  if (action !== 'login' && !isValidPasscode(passcode)) {
    const result = {
      status: 'error',
      success: false,
      message: '不正なアクセスです（パスコードが違います）'
    };
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  }
  let result = { success: false };

  try {
    if (action === 'updateHome') {
      let memoSheet = ss.getSheetByName('伝達事項');
      if (!memoSheet) {
        memoSheet = ss.insertSheet('伝達事項');
        memoSheet.appendRow(['日時', '内容', '重要度']);
      }
      const timestamp = params.timestamp ? new Date(params.timestamp) : new Date();
      const content = params.detail || '';
      const category = (params.category && params.category.includes('重要')) ? '📌 重要' : '';

      if (content) {
        memoSheet.appendRow([timestamp, content, category]);
        result = { success: true, message: '伝達事項に追加しました。' };
      } else {
        throw new Error('内容が空です。');
      }
    } else if (action === 'updateRequestStatus') {
      const sheet = ss.getSheetByName('お願いごと');
      const rowId = parseInt(params.id);
      if (rowId >= 2 && rowId <= sheet.getLastRow()) {
        sheet.getRange(rowId, 6).setValue(params.status || '済');
        result = { success: true, message: '更新しました。' };
      } else { throw new Error('ID無効'); }
    } else if (action === 'addRequest') {
      ss.getSheetByName('お願いごと').appendRow([
        params.timestamp ? new Date(params.timestamp) : new Date(),
        params.sender, params.content, params.assignee || '全員', params.deadline || 'なし', '未'
      ]);
      result = { success: true, message: '追加しました。' };
    } else if (action === 'addTrouble') {
      const sheet = ss.getSheetByName('故障トラブル');
      const headers = ensureTroubleScheduleColumns(sheet);
      const row = new Array(headers.length).fill('');
      row[0] = params.timestamp ? new Date(params.timestamp) : new Date();
      row[1] = params.reporter || '';
      row[2] = params.location || '';
      row[3] = params.title || '';
      row[4] = params.detail || '';
      row[5] = '未対応';
      row[6] = '';
      sheet.appendRow(row);
      result = { success: true, message: '追加しました。' };
    } else if (action === 'updateTroubleStatus') {
      const sheet = ss.getSheetByName('故障トラブル');
      const headers = ensureTroubleScheduleColumns(sheet);
      const rowId = parseInt(params.id);
      if (rowId >= 2 && rowId <= sheet.getLastRow()) {
        if (params.location !== undefined) sheet.getRange(rowId, 3).setValue(params.location);
        if (params.title !== undefined) sheet.getRange(rowId, 4).setValue(params.title);
        if (params.detail !== undefined) sheet.getRange(rowId, 5).setValue(params.detail);
        sheet.getRange(rowId, 6).setValue(params.status || '未対応');
        sheet.getRange(rowId, 7).setValue(params.history || '');
        setValueByHeader(sheet, rowId, headers, '書類作成日', params.documentCreationDate || '');
        setValueByHeader(sheet, rowId, headers, '書類作成完了', params.documentCreationDone === 'true');
        setValueByHeader(sheet, rowId, headers, '書類提出日', params.documentSubmissionDate || '');
        setValueByHeader(sheet, rowId, headers, '書類提出完了', params.documentSubmissionDone === 'true');
        setValueByHeader(sheet, rowId, headers, 'メーカー検査日', params.makerInspectionDate || '');
        setValueByHeader(sheet, rowId, headers, 'メーカー検査完了', params.makerInspectionDone === 'true');
        setValueByHeader(sheet, rowId, headers, '警察検査日', params.policeInspectionDate || '');
        setValueByHeader(sheet, rowId, headers, '警察検査完了', params.policeInspectionDone === 'true');
        setValueByHeader(sheet, rowId, headers, '書類取り日', params.documentPickupDate || '');
        setValueByHeader(sheet, rowId, headers, '書類取り完了', params.documentPickupDone === 'true');
        result = { success: true, message: '更新しました。' };
      } else { throw new Error('ID無効'); }
    } else if (action === 'updateCleaningStatus') {
      const sheet = ss.getSheetByName('曜日清掃・作業');
      const rowId = parseInt(params.id);
      if (rowId >= 2 && rowId <= sheet.getLastRow()) {
        sheet.getRange(rowId, 5).setValue(params.status || '未');
        result = { success: true, message: '更新しました。' };
      } else { throw new Error('ID無効'); }
    } else if (action === 'updateCleaningExecutor') {
      const sheet = ss.getSheetByName('曜日清掃・作業');
      const rowId = parseInt(params.id);
      if (rowId >= 2 && rowId <= sheet.getLastRow()) {
        sheet.getRange(rowId, 6).setValue(params.executor || '');
        result = { success: true, message: '更新しました。' };
      } else { throw new Error('ID無効'); }
    } else if (action === 'updateMembers') {
      const sheet = ss.getSheetByName('HOME');
      const currentVal = parseInt(params.currentMembers);
      if (!isNaN(currentVal)) {
        sheet.getRange('B2').setValue(currentVal);
        result = { success: true, message: '更新しました。' };
      } else { throw new Error('数値が無効です。'); }

    // 🌟【新規追加】アプリからの「抽選・飛び込み人数」更新
    } else if (action === 'updateLotteryWalkIn') {
      const sheet = ss.getSheetByName('HOME');
      const lottery = parseInt(params.lotteryCount);
      const walkIn = parseInt(params.walkInCount);
      const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
      let lotteryCol = headers.indexOf('抽選') + 1;
      if (lotteryCol <= 0) lotteryCol = headers.indexOf('抽選人数') + 1;
      let walkInCol = headers.indexOf('飛び込み') + 1;
      if (walkInCol <= 0) walkInCol = headers.indexOf('飛び込み人数') + 1;

      if (lotteryCol > 0 && !isNaN(lottery)) sheet.getRange(2, lotteryCol).setValue(lottery);
      if (walkInCol > 0 && !isNaN(walkIn)) sheet.getRange(2, walkInCol).setValue(walkIn);
      result = { success: true, message: '人数を更新しました。' };
    } else if (action === 'updateCassetteCleaning') {
      const sheet = ss.getSheetByName('カセット清掃');
      if (!sheet) throw new Error('カセット清掃シートが見つかりません。');

      const machineId = parseInt(params.machineId);
      if (machineId >= 1 && machineId <= 440) {
        const rowId = machineId + 1;
        sheet.getRange(rowId, 2).setValue(params.status || '未');
        sheet.getRange(rowId, 3).setValue(params.executor || '');
        sheet.getRange(rowId, 4).setValue(params.timestamp || '');
        result = { success: true, message: '清掃状況を更新しました。' };
      } else {
        throw new Error('台番号が無効です。');
      }
    } else if (action === 'resetCassetteCleanings') {
      const sheet = ss.getSheetByName('カセット清掃');
      if (!sheet) throw new Error('カセット清掃シートが見つかりません。');

      const cleanData = [];
      for (let i = 0; i < 440; i++) {
        cleanData.push(['未', '', '']);
      }
      sheet.getRange(2, 2, 440, 3).setValues(cleanData);
      result = { success: true, message: '清掃状況をすべてリセットしました。' };
    } else if (action === 'login') {
      const loginId = params.loginId;
      const password = params.password;
      const sheet = ss.getSheetByName('スタッフ名簿');
      if (!sheet) throw new Error('スタッフ名簿シートが見つかりません。');

      const lastRow = sheet.getLastRow();
      let isSuccess = false;
      let userName = '';
      if (lastRow > 1) {
        const values = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
        for (let i = 0; i < values.length; i++) {
          if (values[i][0] == loginId && values[i][1] == password) {
            isSuccess = true;
            userName = values[i][2];
            break;
          }
        }
      }
      if (isSuccess) {
        result = { success: true, userName: userName, message: 'ログイン成功' };
      } else {
        result = { success: false, message: 'IDまたはパスワードが間違っています。' };
      }
    } else if (action === 'editRequest') {
      const sheet = ss.getSheetByName('お願いごと');
      const rowId = parseInt(params.id);
      if (rowId >= 2 && rowId <= sheet.getLastRow()) {
        if (params.sender) sheet.getRange(rowId, 2).setValue(params.sender);
        if (params.content) sheet.getRange(rowId, 3).setValue(params.content);
        if (params.assignee) sheet.getRange(rowId, 4).setValue(params.assignee);
        if (params.deadline) sheet.getRange(rowId, 5).setValue(params.deadline);
        result = { success: true, message: '更新しました。' };
      } else { throw new Error('ID無効'); }
    } else if (action === 'editMemo') {
      const sheet = ss.getSheetByName('伝達事項');
      const rowId = parseInt(params.id);
      if (rowId >= 2 && rowId <= sheet.getLastRow()) {
        if (params.detail) sheet.getRange(rowId, 2).setValue(params.detail);
        const category = (params.category && params.category.includes('重要')) ? '📌 重要' : '';
        sheet.getRange(rowId, 3).setValue(category);
        result = { success: true, message: '更新しました。' };
      } else { throw new Error('ID無効'); }
    } else if (action === 'addWeeklyCleaning') {
      const sheet = ss.getSheetByName('曜日清掃・作業');
      if (!sheet) throw new Error('曜日清掃・作業シートが見つかりません。');
      sheet.appendRow([
        params.day || '',
        params.shift || '早番',
        params.category || '',
        params.task || '',
        '未', // ステータス初期値
        '' // 実施者初期値
      ]);
      result = { success: true, message: '曜日タスクを追加しました。' };
    } else if (action === 'editWeeklyCleaning') {
      const sheet = ss.getSheetByName('曜日清掃・作業');
      if (!sheet) throw new Error('曜日清掃・作業シートが見つかりません。');
      const rowId = parseInt(params.id);
      if (rowId >= 2 && rowId <= sheet.getLastRow()) {
        if (params.day) sheet.getRange(rowId, 1).setValue(params.day);
        if (params.shift) sheet.getRange(rowId, 2).setValue(params.shift);
        if (params.category !== undefined) sheet.getRange(rowId, 3).setValue(params.category);
        if (params.task !== undefined) sheet.getRange(rowId, 4).setValue(params.task);
        result = { success: true, message: '曜日タスクを更新しました。' };
      } else { throw new Error('ID無効'); }
    } else if (action === 'deleteWeeklyCleaning') {
      const sheet = ss.getSheetByName('曜日清掃・作業');
      if (!sheet) throw new Error('曜日清掃・作業シートが見つかりません。');
      const rowId = parseInt(params.id);
      if (rowId >= 2 && rowId <= sheet.getLastRow()) {
        sheet.deleteRow(rowId);
        result = { success: true, message: '曜日タスクを削除しました。' };
      } else { throw new Error('ID無効'); }
    }

    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}
// ==========================================
// ここから下はLINE・定期実行の裏方システム
// ==========================================
function handleLineWebhook(event) {
  if (event.type === 'message' && event.message.type === 'text') {
    const userMessage = event.message.text;
    const replyToken = event.replyToken;
    const groupId = event.source.groupId;
    const userId = event.source.userId;
    const senderName = getLineUserName(userId, groupId);
    if (userMessage === 'ID教えて') {
      if (groupId) replyToLine(replyToken, 'このグループのIDは以下です！日曜日の配信設定で使います。\n\n' + groupId);
      else replyToLine(replyToken, 'ここはグループトークではないようです！');
      return ContentService.createTextOutput('Success');
    }

    const now = new Date();
    const timestamp = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');

    if (userMessage.startsWith('伝達') || userMessage.startsWith('重要')) {
      let isImportant = userMessage.startsWith('重要');
      let content = userMessage.replace(/^(伝達|重要)\s*/, '');
      const sheet = ss.getSheetByName('伝達事項');
      if (sheet) {
        sheet.appendRow([timestamp, content, isImportant ? '📌 重要' : '']);
        replyToLine(replyToken, isImportant ? '【重要】として伝達事項にピン留めしました！📌\nアプリを確認してください。' : '伝達事項に追加しました！\nアプリを確認してください。');
      }
    }
    else if (userMessage.startsWith('依頼') || userMessage.startsWith('お願い')) {
      const content = userMessage.replace(/^(依頼|お願い)\s*/, '');
      let deadline = 'なし';
      const deadlineMatch = content.match(/(明日|明後日|今日|今週中|来週中|\d{1,2}\/\d{1,2}|\d{1,2}月\d{1,2}日)(まで)/);
      if (deadlineMatch) deadline = deadlineMatch[0];
      const sheet = ss.getSheetByName('お願いごと');
      if (sheet) {
        sheet.appendRow([timestamp, senderName, content, '全員', deadline, '未']);
        replyToLine(replyToken, 'お願いごとリストに追加しました！📋\n期限：' + deadline + '\nアプリを確認してください。');
      }
    }
    else if (userMessage.startsWith('故障') || userMessage.startsWith('トラブル')) {
      const content = userMessage.replace(/^(故障|トラブル)\s*/, '');
      const sheet = ss.getSheetByName('故障トラブル');
      if (sheet) {
        const headers = ensureTroubleScheduleColumns(sheet);
        const row = new Array(headers.length).fill('');
        row[0] = timestamp;
        row[1] = senderName;
        row[2] = '不明';
        row[3] = '設備故障/トラブル';
        row[4] = content;
        row[5] = '未対応';
        row[6] = '';
        sheet.appendRow(row);
        replyToLine(replyToken, '故障・トラブル報告を受付しました！🛠️\nアプリを確認してください。');
      }
    }
    // 🌟【新規追加】LINEからの「抽選・飛び込み人数」更新
    else if (userMessage.startsWith('抽選') || userMessage.match(/^(飛び込み|飛込み)/)) {
      const sheet = ss.getSheetByName('HOME');
      if (sheet) {
        const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
        let lotteryCol = headers.indexOf('抽選') + 1;
        if (lotteryCol <= 0) lotteryCol = headers.indexOf('抽選人数') + 1;
        let walkInCol = headers.indexOf('飛び込み') + 1;
        if (walkInCol <= 0) walkInCol = headers.indexOf('飛び込み人数') + 1;
        let replyMsg = '';

        // 抽選の読み取り
        const lotteryMatch = userMessage.match(/抽選\s*(\d+)/);
        if (lotteryMatch && lotteryCol > 0) {
          sheet.getRange(2, lotteryCol).setValue(lotteryMatch[1]);
          replyMsg += `🎯 抽選人数を ${lotteryMatch[1]}名 に更新しました！\n`;
        }

        // 飛び込みの読み取り
        const walkInMatch = userMessage.match(/(飛び込み|飛込み)\s*(\d+)/);
        if (walkInMatch && walkInCol > 0) {
          sheet.getRange(2, walkInCol).setValue(walkInMatch[2]);
          replyMsg += `🏃 飛び込み人数を ${walkInMatch[2]}名 に更新しました！\n`;
        }
        if (replyMsg) {
          replyToLine(replyToken, replyMsg + 'アプリを確認してください。');
        } else {
          replyToLine(replyToken, '⚠️人数の読み取りに失敗しました。「抽選 50」や「飛び込み 10」のように数字を入れて送信してください。');
        }
      }
    }
    else {
      replyToLine(replyToken, '⚠️キーワードを認識できませんでした。\n送られた文字：「' + userMessage + '」');
    }
  }
  return ContentService.createTextOutput('Success');
}
function replyToLine(replyToken, text) {
  const url = 'https://api.line.me/v2/bot/message/reply';
  UrlFetchApp.fetch(url, {
    'headers': {
      'Content-Type': 'application/json; charset=UTF-8',
      'Authorization': 'Bearer ' + getLineToken(),
    },
    'method': 'post',
    'payload': JSON.stringify({
      'replyToken': replyToken,
      'messages': [{ 'type': 'text', 'text': text }]
    })
  });
}
function getLineUserName(userId, groupId) {
  if (!userId) return 'LINEからの送信';
  try {
    let url = groupId
      ? 'https://api.line.me/v2/bot/group/' + groupId + '/member/' + userId
      : 'https://api.line.me/v2/bot/profile/' + userId;

    let response = UrlFetchApp.fetch(url, {
      'headers': { 'Authorization': 'Bearer ' + getLineToken() }
    });
    return JSON.parse(response.getContentText()).displayName;
  } catch (e) {
    return 'LINEからの送信';
  }
}
/**
 * 毎週自動実行：曜日清掃・作業のチェックおよび実施者名をリセットする
 * （毎週月曜日早朝に実行される時間主導型トリガーを推奨）
 */
function resetWeeklyCleanings() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('曜日清掃・作業');
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const rangeStatus = sheet.getRange(2, 5, lastRow - 1, 1);     // E列: ステータス
    const rangeExecutor = sheet.getRange(2, 6, lastRow - 1, 1);   // F列: 実施者

    const statusValues = [];
    const executorValues = [];
    for (let i = 0; i < lastRow - 1; i++) {
      statusValues.push(['未']);
      executorValues.push(['']);
    }

    rangeStatus.setValues(statusValues);
    rangeExecutor.setValues(executorValues);
    console.log('曜日清掃・作業の週次リセットが完了しました。');
  }
}
/**
 * 毎日自動実行：HOMEの抽選・飛び込み人数を「来店履歴」シートに記録し、HOMEの値を0にリセットする
 * （毎日深夜 0:00〜1:00 の間に実行される時間主導型トリガーを推奨）
 */
function archiveDailyAttendance() {
  const homeSheet = ss.getSheetByName('HOME');
  if (!homeSheet) {
    console.error('HOMEシートが見つかりません。');
    return;
  }

  // 1. HOMEシートから列位置を特定し、現在の人数を取得する
  const lastColumn = homeSheet.getLastColumn();
  const headers = homeSheet.getRange(1, 1, 1, Math.max(lastColumn, 2)).getValues()[0];

  let lotteryCol = headers.indexOf('抽選') + 1;
  if (lotteryCol <= 0) lotteryCol = headers.indexOf('抽選人数') + 1;

  let walkInCol = headers.indexOf('飛び込み') + 1;
  if (walkInCol <= 0) walkInCol = headers.indexOf('飛び込み人数') + 1;

  let lotteryCount = 0;
  let walkInCount = 0;

  if (lotteryCol > 0) {
    lotteryCount = homeSheet.getRange(2, lotteryCol).getValue() || 0;
  }
  if (walkInCol > 0) {
    walkInCount = homeSheet.getRange(2, walkInCol).getValue() || 0;
  }

  // 2. 来店履歴シートを準備する（なければ作成）
  let historySheet = ss.getSheetByName('来店履歴');
  if (!historySheet) {
    historySheet = ss.insertSheet('来店履歴');
    historySheet.appendRow(['日付', '抽選人数', '飛び込み人数']);
  }

  // 3. 昨日の日付文字列（yyyy/MM/dd）を作成
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const dateStr = Utilities.formatDate(yesterday, 'Asia/Tokyo', 'yyyy/MM/dd');

  // 4. 来店履歴に昨日の数値を記録
  historySheet.appendRow([dateStr, lotteryCount, walkInCount]);
  console.log(`来店履歴を記録しました: 日付=${dateStr}, 抽選=${lotteryCount}, 飛び込み=${walkInCount}`);

  // 5. HOMEの数値を 0 にリセット
  if (lotteryCol > 0) {
    homeSheet.getRange(2, lotteryCol).setValue(0);
  }
  if (walkInCol > 0) {
    homeSheet.getRange(2, walkInCol).setValue(0);
  }
  console.log('HOMEの人数を 0 にリセットしました。');
}
