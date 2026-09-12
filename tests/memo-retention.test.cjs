const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const now = Date.parse('2026-09-12T00:30:00+09:00');
const hour = 60 * 60 * 1000;
const app = fs.readFileSync('app.js', 'utf8');
const gas = fs.readFileSync('gas_api_template.js', 'utf8');
const context = { Date, memoTitleDisplay: {}, memoPinnedTextarea: {}, memoTextarea: {}, memoTime: {} };
vm.createContext(context);
vm.runInContext(app.slice(app.indexOf('    function parseMemoDate'), app.indexOf('    function fitMemoDetailText')), context);
const gasContext = { SpreadsheetApp: { getActiveSpreadsheet: () => ({}) }, Date };
vm.createContext(gasContext);
vm.runInContext(gas, gasContext);
for (const target of [context, gasContext]) {
    const visible = target.isWithinRetentionHours;
    assert.equal(visible('2026/09/11 23:30', 24, now), true, 'midnight must not expire yesterday\'s memo');
    assert.equal(visible(new Date(now - 24 * hour + 1), 24, now), true);
    assert.equal(visible(new Date(now - 24 * hour), 24, now), false);
    assert.equal(visible(new Date(now - 168 * hour + 1), 168, now), true);
    assert.equal(visible(new Date(now - 168 * hour), 168, now), false);
    assert.equal(visible('2026/9/11 9:05:00', 24, now), true);
    assert.equal(visible('2026-09-11T14:30:00Z', 24, now), true);
    for (const invalid of ['', null, 'bad date', new Date(now + 1)]) {
        assert.equal(visible(invalid, 24, now), false);
    }
}
// Rendering must retain all in-window entries and support both server and local keys.
const realNow = Date.now();
const rows = Array.from({ length: 6 }, (_, i) => ({ '登録日時': new Date(realNow - (i + 1) * hour).toISOString(), '内容': `normal-${i}` }));
rows.push({ timestamp: new Date(realNow - 25 * hour).toISOString(), content: 'expired' });
rows.push({ '日時': new Date(realNow - 167 * hour).toISOString(), '内容': 'important', '重要度': '📌 重要' });
rows.push({ '日時': new Date(realNow - 169 * hour).toISOString(), '内容': 'expired-important', '重要度': '重要' });
context.renderMemoList(rows);
assert.equal(context.memoTextarea.value.split('\n\n').length, 6);
assert.equal(context.memoTextarea.value.includes('expired'), false);
assert.equal(context.memoPinnedTextarea.value, 'important');
context.renderMemoList([]);
assert.match(context.memoTextarea.value, /ありません/);
console.log('Memo retention: midnight, 24h/168h boundaries, timestamp formats, future/invalid dates, >5 records, and empty lists passed.');
