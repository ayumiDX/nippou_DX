const fs = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
    const server = http.createServer((req, res) => {
        const path = new URL(req.url, 'http://localhost').pathname;
        const file = path === '/' ? 'index.html' : path.slice(1);
        if (!['index.html', 'app.js', 'styles.css'].includes(file)) { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html');
        res.end(fs.readFileSync(file));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        for (const [width, height] of [[390, 844], [320, 568], [844, 390], [1280, 1000]]) {
            const context = await browser.newContext({ viewport: { width, height }, isMobile: width !== 1280, hasTouch: width !== 1280 });
            const errors = [];
            const posts = [];
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(error.message));
            await page.addInitScript(() => {
                sessionStorage.setItem('arena_is_unlocked', 'true');
                sessionStorage.setItem('arena_unlocked_at', String(Date.now()));
                sessionStorage.setItem('arena_user_name', 'テスト担当');
                sessionStorage.setItem('arena_passcode', 'test-only');
            });
            await page.route('**/*', async route => {
                const request = route.request();
                const url = new URL(request.url());
                if (url.hostname === '127.0.0.1') return route.continue();
                if (url.hostname !== 'script.google.com') return route.abort();
                if (request.method() === 'POST') {
                    posts.push(new URLSearchParams(request.postData()));
                    return route.fulfill({ json: { success: true } });
                }
                let result = [];
                if (url.searchParams.get('action') === 'getHome') result = [{ detail: 'OLD SERVER RESULT', targetMembers: 23, currentMembers: 9 }];
                if (url.searchParams.get('sheetName') === '伝達事項') result = [
                    { id: 2, '登録日時': new Date(Date.now() - 23 * 3600000).toISOString(), '内容': '23時間前の通常伝達' },
                    { id: 3, '登録日時': new Date(Date.now() - 25 * 3600000).toISOString(), '内容': '期限切れの通常伝達' },
                    { id: 4, '登録日時': new Date(Date.now() - 167 * 3600000).toISOString(), '内容': '重要伝達', '区分': '重要' }
                ];
                if (url.searchParams.get('action') === 'getTroubles') result = [{ id: 2, timestamp: '2026/09/12 10:00', location: '101', title: '液晶の表示不良', detail: '画面が暗くなります。電源を確認し、メーカーへ連絡しました。', status: '未対応', history: '部品の到着待ち' }];
                return route.fulfill({ json: result });
            });
            await page.goto(`http://127.0.0.1:${server.address().port}`);
            await page.waitForFunction(() => document.getElementById('memo-textarea').value === '23時間前の通常伝達');
            assert.equal(await page.locator('#memo-pinned-textarea').count(), 1);
            // Use the real action/card handlers, keeping every API call mocked.
            await page.locator('#btn-trigger-troubles').click();
            await page.locator('.trouble-card').first().click();
            await page.locator('#trouble-edit-overlay.active').waitFor();
            await page.waitForTimeout(400);
            const geometry = await page.locator('#trouble-edit-overlay').evaluate(overlay => {
                const modal = overlay.querySelector('.cyber-modal');
                const body = overlay.querySelector('.modal-body');
                const field = overlay.querySelector('#edit-trb-detail');
                const footer = overlay.querySelector('.modal-footer');
                const rect = modal.getBoundingClientRect();
                return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, font: getComputedStyle(field).fontSize, textarea: field.clientHeight, body: body.clientHeight, scroll: body.scrollHeight, overflow: body.scrollWidth > body.clientWidth, footerBottom: footer.getBoundingClientRect().bottom };
            });
            assert.equal(geometry.font, '18px');
            assert.ok(geometry.textarea >= 170);
            assert.equal(geometry.overflow, false);
            if (width !== 1280) {
                assert.ok(Math.abs(geometry.width - width) < 2, JSON.stringify(geometry));
                assert.ok(Math.abs(geometry.height - height) < 2, JSON.stringify(geometry));
                assert.ok(geometry.footerBottom <= height);
            }
            if (width === 390) {
                fs.mkdirSync('artifacts', { recursive: true });
                await page.screenshot({ path: 'artifacts/trouble-edit-mobile.png' });
            }
            await page.locator('#edit-trb-detail').fill('確認済みのテスト入力');
            await page.locator('#trb-document-creation-date').fill('2026-09-13');
            await page.locator('#trb-document-creation-done').check();
            await page.locator('#trouble-edit-save').click();
            await page.waitForFunction(() => !document.getElementById('trouble-edit-overlay').classList.contains('active'));
            assert.ok(posts.some(p => p.get('detail') === '確認済みのテスト入力'));
            await page.locator('#fab-add-trouble').click();
            await page.waitForTimeout(400);
            await page.locator('#trb-location').fill('102');
            await page.locator('#trb-title').fill('テスト報告');
            await page.locator('#trb-detail').fill('詳しい症状を入力');
            if (width === 390) await page.screenshot({ path: 'artifacts/trouble-add-mobile.png' });
            await page.locator('#trouble-add-submit').click();
            await page.waitForFunction(() => !document.getElementById('trouble-add-overlay').classList.contains('active'));
            assert.ok(posts.some(p => p.get('detail') === '詳しい症状を入力'));
            for (const [overlayId, fieldId, imageName] of [
                ['request-add-overlay', 'req-content', 'request-input-mobile'],
                ['memo-edit-overlay', 'input-memo-detail', 'memo-input-mobile']
            ]) {
                await page.evaluate(id => document.getElementById(id).classList.add('active'), overlayId);
                await page.waitForTimeout(400);
                const box = await page.locator('#' + overlayId).boundingBox();
                if (width !== 1280) { assert.equal(Math.round(box.width), width); assert.equal(Math.round(box.height), height); }
                assert.equal(await page.locator('#' + fieldId).evaluate(el => getComputedStyle(el).fontSize), '18px');
                await page.locator('#' + fieldId).fill('入力欄の大きさを確認できます。\n長い文章も読みやすく入力できます。');
                if (width === 390) await page.screenshot({ path: 'artifacts/' + imageName + '.png' });
                await page.locator('#' + overlayId + ' .modal-close').click();
            }
            assert.deepEqual(errors, []);
            console.log(`${width}x${height}: modal geometry, scrolling, 18px text, edit/save, new report, request/memo inputs, and legacy API compatibility passed.`);
            await context.close();
        }
    } finally {
        await browser.close();
        server.close();
    }
})().catch(error => { console.error(error); process.exit(1); });
