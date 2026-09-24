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
        for (const scenario of ['locked', 'login', 'slow-home', 'slow-memo', 'timeout', 'rejected', 'preview', 'expired-preview', 'previous-day', 'wrong-session', 'broken-preview']) {
            const context = await browser.newContext();
            const page = await context.newPage();
            const calls = [], errors = [];
            let release;
            const gate = new Promise(resolve => { release = resolve; });
            page.on('pageerror', error => errors.push(error.message));
            await context.route('https://fonts.**/**', route => route.abort());
            await page.addInitScript(({ unlocked, timeout }) => {
                if (unlocked && !sessionStorage.getItem('arena_unlocked_at')) {
                    sessionStorage.setItem('arena_is_unlocked', 'true');
                    sessionStorage.setItem('arena_unlocked_at', String(Date.now()));
                    sessionStorage.setItem('arena_passcode', 'test');
                }
                if (timeout) {
                    const original = window.setTimeout;
                    window.setTimeout = (fn, ms, ...args) => original(fn, ms === 20000 ? 150 : ms, ...args);
                }
            }, { unlocked: !['locked', 'login'].includes(scenario), timeout: scenario === 'timeout' });
            let holdAll = false;
            await page.route('https://script.google.com/**', async route => {
                const url = new URL(route.request().url());
                if (route.request().method() === 'POST') {
                    calls.push('login');
                    return route.fulfill({ json: { success: true, userName: 'test-user' } });
                }
                const action = url.searchParams.get('action') || 'memo';
                calls.push(action);
                if ((scenario === 'slow-home' && action === 'getHome') ||
                    (scenario === 'slow-memo' && action === 'memo') || scenario === 'timeout' || holdAll) await gate;
                let json = [];
                if (action === 'getHome') json = [{ currentMembers: holdAll ? 74 : 73, targetMembers: 100 }];
                if (action === 'memo') json = [{ '日時': new Date().toISOString(), '内容': holdAll ? '更新後の伝達事項' : '最新の伝達事項' }];
                if (scenario === 'rejected') json = { success: false, error: '認証が必要です' };
                await route.fulfill({ json }).catch(() => {});
            });
            await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' });
            if (scenario === 'locked') {
                await page.waitForTimeout(100);
                assert.deepEqual(calls, [], 'no requests before login');
                assert.equal(await page.locator('#btn-unlock').isEnabled(), true);
            } else if (scenario === 'login') {
                let navigations = 0;
                page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
                await page.locator('#login-id-input').fill('test');
                await page.locator('#passcode-input').fill('test');
                await page.locator('#btn-unlock').click();
                await page.waitForFunction(() => document.getElementById('member-current').textContent === '73');
                assert.equal(await page.locator('#lock-screen').count(), 1, 'data arrives during welcome');
                await page.locator('#lock-screen').waitFor({ state: 'detached' });
                assert.equal(navigations, 0, 'login must not reload the page');
                assert.deepEqual(calls.sort(), ['login', 'getHome', 'getRequests', 'getTroubles', 'memo'].sort());
                await page.locator('#btn-lock-manual').click();
                await page.locator('#lock-screen').waitFor();
                assert.equal(await page.evaluate(() => sessionStorage.getItem('arena_home_preview_v1')), null);
            } else if (['preview', 'expired-preview', 'previous-day', 'wrong-session', 'broken-preview'].includes(scenario)) {
                await page.waitForFunction(() => document.getElementById('memo-save-status').textContent === 'スプレッドシート同期済');
                await page.evaluate(scenario => {
                    const key = 'arena_home_preview_v1';
                    const data = JSON.parse(sessionStorage.getItem(key));
                    if (scenario === 'expired-preview') data.savedAt = Date.now() - 16 * 60000;
                    if (scenario === 'previous-day') data.day = '2000-01-01';
                    if (scenario === 'wrong-session') data.session = 'another-login';
                    sessionStorage.setItem(key, scenario === 'broken-preview' ? '{broken' : JSON.stringify(data));
                }, scenario);
                holdAll = true;
                calls.length = 0;
                await page.reload({ waitUntil: 'domcontentloaded' });
                await page.waitForFunction(() => document.getElementById('memo-save-status').textContent.includes('中'));
                if (scenario === 'preview') {
                    assert.equal(await page.locator('#member-current').textContent(), '73');
                    assert.equal(await page.locator('#memo-textarea').inputValue(), '最新の伝達事項');
                    assert.match(await page.locator('#memo-save-status').textContent(), /前回取得/);
                } else {
                    assert.notEqual(await page.locator('#member-current').textContent(), '73');
                }
                release();
                await page.waitForFunction(() => document.getElementById('memo-save-status').textContent === 'スプレッドシート同期済');
                assert.equal(await page.locator('#member-current').textContent(), '74');
                assert.equal(await page.locator('#memo-textarea').inputValue(), '更新後の伝達事項');
                assert.deepEqual(calls.sort(), ['getHome', 'getRequests', 'getTroubles', 'memo'].sort());
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
