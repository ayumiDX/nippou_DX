const ss = SpreadsheetApp.getActiveSpreadsheet();
const LINE_TOKEN_PROPERTY = 'LINE_CHANNEL_ACCESS_TOKEN';

const IMPORTANT_RETENTION_DAYS = 7;
const TROUBLE_SCHEDULE_COLUMNS = [
  '書類作成日', '書類作成完了',
  '書類提出日', '書類提出完了',
  'メーカー検査日', 'メーカー検査完了',
  '警察検査日', '警察検査完了',
  '書類取り日', '書類取り完了'
];

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
  const lastColumn = Math.max(sheet.getLastColumn(), 6);
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
  
  try {
    if (sheetName || (!action && sheetName)) {
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
      // 🌟 HOMEシートと伝達事項シートの合体データ作成（完全版）
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
      
      // 伝達事項の読み込み
      let memoSheet = ss.getSheetByName('伝達事項');
      if (!memoSheet) {
        memoSheet = ss.insertSheet('伝達事項');
        memoSheet.appendRow(['日時', '内容', '重要度']);
      }
      
      const memoLastRow = memoSheet.getLastRow();
      let pinnedDetailList = [];
      let detailList = [];
      let lastTimestamp = '';
      
      if (memoLastRow > 1) {
        const values = memoSheet.getRange(2, 1, memoLastRow - 1, 3).getValues();
        for (let i = values.length - 1; i >= 0; i--) {
          const row = values[i];
          const regTime = row[0];
          const content = row[1] ? row[1].toString().trim() : '';
          const category = row[2] ? row[2].toString().trim() : '';
          
          // LINEからの「📌 重要」も、アプリからの「重要」も拾う設定
          const isImportant = category.includes('重要');
          
          if (isImportant && content && isWithinLastCalendarDays(regTime, IMPORTANT_RETENTION_DAYS)) {
            pinnedDetailList.push(content);
            if (!lastTimestamp && regTime) lastTimestamp = Utilities.formatDate(new Date(regTime), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
          }
          
          if (!isImportant && content) {
            if (detailList.length < 5) detailList.push(content);
            if (!lastTimestamp && regTime) lastTimestamp = Utilities.formatDate(new Date(regTime), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
          }
        }
      }
      
      obj.title = '伝達事項';
      obj.pinnedDetail = pinnedDetailList.length > 0 ? pinnedDetailList.join('\n\n') : '現在、重要なピン留め連絡はありません。';
      obj.detail = detailList.length > 0 ? detailList.join('\n\n') : '現在、通常の伝達事項はありません。';
      obj.timestamp = lastTimestamp || '----/--/-- --:--';
      
      // スタッフ名の取得
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
          const status = row[4] ? row[4].toString().trim() : '未対応';
          if (status !== '完了' && status !== '済') {
            list.push({
              id: i + 2,
              timestamp: row[0] ? Utilities.formatDate(new Date(row[0]), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') : '',
              location: row[1] || '不明',
              title: row[2] || '設備故障',
              detail: row[3] || '',
              status: status,
              history: row[5] || '',
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
    }
    
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ error: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 【POST】アプリからの書き込み ＆ LINEからの書き込みを「一つに統合」した処理
 */
function doPost(e) {
  // 🌟 [ルートA] LINEからのアクセスかどうかを判定
  if (e.postData && e.postData.contents) {
    try {
      const json = JSON.parse(e.postData.contents);
      if (json.events && json.events.length > 0) {
        return handleLineWebhook(json.events[0]); // LINE専用の処理へパス
      }
    } catch (err) {
      // エラーならアプリ側の処理へ進む
    }
  }

  // 🌟 [ルートB] ポータルアプリからのアクセス処理
  const params = e.parameter;
  const action = params.action;
  let result = { success: false };
  
  try {
    if (action === 'updateHome') {
      // アプリから伝達事項への書き込み
      let memoSheet = ss.getSheetByName('伝達事項');
      if (!memoSheet) {
        memoSheet = ss.insertSheet('伝達事項');
        memoSheet.appendRow(['日時', '内容', '重要度']);
      }
      const timestamp = params.timestamp ? new Date(params.timestamp) : new Date();
      const content = params.detail || '';
      // アプリからの「重要」をLINE側と合わせるため「📌 重要」に変換
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
      row[1] = params.location;
      row[2] = params.title;
      row[3] = params.detail;
      row[4] = '未対応';
      row[5] = '';
      sheet.appendRow(row);
      result = { success: true, message: '追加しました。' };
    } else if (action === 'updateTroubleStatus') {
      const sheet = ss.getSheetByName('故障トラブル');
      const headers = ensureTroubleScheduleColumns(sheet);
      const rowId = parseInt(params.id);
      if (rowId >= 2 && rowId <= sheet.getLastRow()) {
        sheet.getRange(rowId, 2).setValue(params.location || '');
        sheet.getRange(rowId, 3).setValue(params.title || '');
        sheet.getRange(rowId, 4).setValue(params.detail || '');
        sheet.getRange(rowId, 5).setValue(params.status);
        sheet.getRange(rowId, 6).setValue(params.history || '');
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
        sheet.getRange('B2').setValue(currentVal); // 会員数はB列に固定
        result = { success: true, message: '更新しました。' };
      } else { throw new Error('数値が無効です。'); }
    }
    
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ==========================================
// ここから下はLINE・定期実行の裏方システム
// ==========================================

/**
 * LINEからのメッセージを処理する専用関数
 */
function handleLineWebhook(event) {
  if (event.type === 'message' && event.message.type === 'text') {
    const userMessage = event.message.text;
    const replyToken = event.replyToken;
    const groupId = event.source.groupId;
    
    if (userMessage === 'ID教えて') {
      if (groupId) {
        replyToLine(replyToken, 'このグループのIDは以下です！日曜日の配信設定で使います。\n\n' + groupId);
      } else {
        replyToLine(replyToken, 'ここはグループトークではないようです！');
      }
      return ContentService.createTextOutput('Success');
    }
    
    if (userMessage.startsWith('伝達') || userMessage.startsWith('重要')) {
      let isImportant = false;
      let content = userMessage;
      
      if (userMessage.startsWith('重要')) {
        isImportant = true;
        content = userMessage.replace(/^重要\s*/, '');
      } else {
        content = userMessage.replace(/^伝達\s*/, '');
      }
      
      const sheet = ss.getSheetByName('伝達事項');
      if (sheet) {
        const now = new Date();
        const timestamp = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
        
        sheet.appendRow([timestamp, content, isImportant ? '📌 重要' : '']);
        
        let replyText = '伝達事項に追加しました！\nアプリを確認してください。';
        if (isImportant) replyText = '【重要】として伝達事項にピン留めしました！📌\nアプリを確認してください。';
        
        replyToLine(replyToken, replyText);
      }
    }
  }
  return ContentService.createTextOutput('Success');
}

/**
 * LINEに返信する関数
 */
function replyToLine(replyToken, text) {
  const lineToken = PropertiesService.getScriptProperties().getProperty(LINE_TOKEN_PROPERTY);
  if (!lineToken) {
    throw new Error('LINE channel access token is not configured in Script Properties.');
  }
  const url = 'https://api.line.me/v2/bot/message/reply';
  const options = {
    'method': 'post',
    'headers': {
      'Content-Type': 'application/json; charset=UTF-8',
      'Authorization': 'Bearer ' + lineToken
    },
    'payload': JSON.stringify({
      'replyToken': replyToken,
      'messages': [{'type': 'text', 'text': text}]
    })
  };
  UrlFetchApp.fetch(url, options);
}

/**
 * 【定期実行用】30日経過した古い伝達事項を自動削除
 */
function deleteOldRecords() {
  const sheet = ss.getSheetByName('伝達事項');
  if (!sheet) return;
  
  const KEEP_DAYS = 30; 
  const now = new Date();
  const thresholdDate = new Date(now.getTime() - (KEEP_DAYS * 24 * 60 * 60 * 1000));
  const data = sheet.getDataRange().getValues();
  
  for (let i = data.length - 1; i >= 1; i--) {
    const recordDate = new Date(data[i][0]);
    if (recordDate < thresholdDate) {
      sheet.deleteRow(i + 1);
    }
  }
}
