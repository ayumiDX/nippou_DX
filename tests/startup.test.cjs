const fs = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
    const server = http.createServer((req, res) => {
        const path = new URL(req.url, 'http://localhost').pathname;
        const file = path === '/' ? 'index.html' : path.slice(1);
        if (!['index.html', 'app.js', 'styles.css'].includes(file)) return res.writeHead(404).end();
        res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
        res.end(fs.readFileSync(file));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ channel: 'chrome', headless: true });
        for (const scenario of ['locked', 'slow-home', 'slow-memo', 'timeout', 'rejected']) {
            const context = await browser.newContext();
            const page = await context.newPage();
            const calls = [], errors = [];
            let release;
            const gate = new Promise(resolve => { release = resolve; });
            page.on('pageerror', error => errors.push(error.message));
            await context.route('https://fonts.**/**', route => route.abort());
            await page.addInitScript(({ unlocked, timeout }) => {
                if (unlocked) {
                    sessionStorage.setItem('arena_is_unlocked', 'true');
                    sessionStorage.setItem('arena_unlocked_at', String(Date.now()));
                    sessionStorage.setItem('arena_passcode', 'test');
                }
                if (timeout) {
                    const original = window.setTimeout;
                    window.setTimeout = (fn, ms, ...args) => original(fn, ms === 20000 ? 150 : ms, ...args);
                }
            }, { unlocked: scenario !== 'locked', timeout: scenario === 'timeout' });
            await page.route('https://script.google.com/**', async route => {
                const url = new URL(route.request().url());
                const action = url.searchParams.get('action') || 'memo';
                calls.push(action);
                if ((scenario === 'slow-home' && action === 'getHome') ||
                    (scenario === 'slow-memo' && action === 'memo') || scenario === 'timeout') await gate;
                let json = [];
                if (action === 'getHome') json = [{ currentMembers: 73, targetMembers: 100 }];
                if (action === 'memo') json = [{ '日時': new Date().toISOString(), '内容': '最新の伝達事項' }];
                if (scenario === 'rejected') json = { success: false, error: '認証が必要です' };
                await route.fulfill({ json }).catch(() => {});
            });
            await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' });
            if (scenario === 'locked') {
                await page.waitForTimeout(100);
                assert.deepEqual(calls, [], 'no requests before login');
                assert.equal(await page.locator('#btn-unlock').isEnabled(), true);
            } else if (scenario === 'timeout' || scenario === 'rejected') {
                await page.waitForFunction(() => document.getElementById('memo-save-status').textContent.includes('更新できません'));
                assert.notEqual(await page.locator('#member-current').textContent(), '45', 'failure must not display mock data');
            } else {
                if (scenario === 'slow-home') {
                    await page.waitForFunction(() => document.getElementById('memo-textarea').value === '最新の伝達事項');
                    assert.notEqual(await page.locator('#member-current').textContent(), '73');
                } else {
                    await page.waitForFunction(() => document.getElementById('member-current').textContent === '73');
                    assert.notEqual(await page.locator('#memo-textarea').inputValue(), '最新の伝達事項');
                }
                assert.ok(calls.includes('getTroubles') && calls.includes('getRequests'), 'alerts start before home completes');
                release();
                await page.waitForFunction(() => document.getElementById('memo-save-status').textContent === 'スプレッドシート同期済');
                assert.deepEqual(calls.sort(), ['getHome', 'getRequests', 'getTroubles', 'memo'].sort());
            }
            assert.deepEqual(errors, []);
            release();
            await context.close();
            console.log(`PASS startup: ${scenario}`);
        }
    } finally {
        if (browser) await browser.close();
        server.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
